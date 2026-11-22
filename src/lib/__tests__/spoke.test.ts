import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canAdvanceDispatchStatus,
  getSpokeTrackingUrl,
  mapSpokeWebhookStatus,
  parseScheduledDateKey,
  shouldRouteToSpoke,
  verifySpokeSignature,
} from "@/lib/spoke";

describe("getSpokeTrackingUrl", () => {
  it("preserves a provider's absolute HTTPS tracking link and query", () => {
    const link = "https://tracking.example.test/stop/sample?key=a%2Bb&view=map";
    expect(getSpokeTrackingUrl(`  ${link}  `)).toBe(link);
  });

  it("treats missing or unusable tracking data as unavailable", () => {
    for (const value of [null, undefined, "", "/stops/sample", {}, "http://tracking.example.test/sample"]) {
      expect(getSpokeTrackingUrl(value)).toBeNull();
    }
  });
});

describe("shouldRouteToSpoke", () => {
  beforeEach(() => {
    delete process.env.SPOKE_PROVIDER_USER_IDS;
  });

  it("routes when the driver is a configured Spoke provider", () => {
    process.env.SPOKE_PROVIDER_USER_IDS = "anchor-1, anchor-2";
    expect(
      shouldRouteToSpoke({ assignedDriverId: "anchor-1", isExternalProvider: false, deliveryCompany: null })
    ).toBe(true);
  });

  it("does not route an ordinary driver", () => {
    process.env.SPOKE_PROVIDER_USER_IDS = "anchor-1";
    expect(
      shouldRouteToSpoke({ assignedDriverId: "derek", isExternalProvider: false, deliveryCompany: null })
    ).toBe(false);
  });

  it("does not route when the provider list is missing (the config-loss case)", () => {
    expect(
      shouldRouteToSpoke({ assignedDriverId: "anchor-1", isExternalProvider: false, deliveryCompany: null })
    ).toBe(false);
  });

  it("routes on the explicit external-provider flag and partner company", () => {
    expect(
      shouldRouteToSpoke({ assignedDriverId: null, isExternalProvider: true, deliveryCompany: null })
    ).toBe(true);
    expect(
      shouldRouteToSpoke({ assignedDriverId: null, isExternalProvider: false, deliveryCompany: "Spoke_Partner" })
    ).toBe(true);
  });
});

describe("mapSpokeWebhookStatus", () => {
  it("maps lifecycle events", () => {
    expect(mapSpokeWebhookStatus("stop.allocated", {}).status).toBe("ALLOCATED");
    expect(mapSpokeWebhookStatus("stop.out_for_delivery", {}).status).toBe("IN_TRANSIT");
    expect(mapSpokeWebhookStatus("stop.departed", {}).status).toBe("DEPARTED");
  });

  it("maps attempted delivery by its success flag", () => {
    expect(
      mapSpokeWebhookStatus("stop.attempted_delivery", { deliveryInfo: { succeeded: true } }).status
    ).toBe("DELIVERED");
    expect(
      mapSpokeWebhookStatus("stop.attempted_delivery", { deliveryInfo: { succeeded: false } }).status
    ).toBe("DELIVERY_FAILED");
  });

  it("treats unknown events as WEBHOOK_RECEIVED and tracking links as their own type", () => {
    expect(mapSpokeWebhookStatus("stop.mystery", {}).status).toBe("WEBHOOK_RECEIVED");
    expect(mapSpokeWebhookStatus("stop.tracking_link_added", {}).status).toBe("TRACKING_LINK_ADDED");
  });
});

describe("canAdvanceDispatchStatus", () => {
  it("moves forward and re-applies duplicates idempotently", () => {
    expect(canAdvanceDispatchStatus("SUBMITTED", "ALLOCATED")).toBe(true);
    expect(canAdvanceDispatchStatus("ALLOCATED", "ALLOCATED")).toBe(true);
    expect(canAdvanceDispatchStatus("DELIVERY_FAILED", "DELIVERED")).toBe(true);
    expect(canAdvanceDispatchStatus("PENDING", "SUBMITTED")).toBe(true);
  });

  it("never regresses an advanced status", () => {
    expect(canAdvanceDispatchStatus("DEPARTED", "ALLOCATED")).toBe(false);
    expect(canAdvanceDispatchStatus("IN_TRANSIT", "SUBMITTED")).toBe(false);
    expect(canAdvanceDispatchStatus("DELIVERED", "ALLOCATED")).toBe(false);
  });

  it("never leaves a settled state", () => {
    expect(canAdvanceDispatchStatus("DELIVERED", "DELIVERED")).toBe(false);
    expect(canAdvanceDispatchStatus("CANCELLED", "SUBMITTED")).toBe(false);
    expect(canAdvanceDispatchStatus("CANCELLED", "DELIVERED")).toBe(false);
  });
});

describe("verifySpokeSignature", () => {
  const secret = "test-webhook-secret";
  const rawBody = JSON.stringify({ type: "stop.allocated", data: { id: "unassignedStops/x" } });
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  it("accepts a valid signature with or without the sha256= prefix", () => {
    expect(verifySpokeSignature({ rawBody, signature, secret })).toBe(true);
    expect(verifySpokeSignature({ rawBody, signature: `sha256=${signature}`, secret })).toBe(true);
  });

  it("rejects tampered bodies and malformed signatures", () => {
    expect(verifySpokeSignature({ rawBody: rawBody + "x", signature, secret })).toBe(false);
    expect(verifySpokeSignature({ rawBody, signature: "nonsense", secret })).toBe(false);
    expect(verifySpokeSignature({ rawBody, signature: null, secret })).toBe(false);
  });
});

describe("parseScheduledDateKey", () => {
  it("extracts the date key and falls back cleanly", () => {
    expect(parseScheduledDateKey("2026-07-15T10:00:00.000Z", new Date("2026-01-01T00:00:00Z"))).toBe("2026-07-15");
    expect(parseScheduledDateKey("garbage", new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
  });
});
