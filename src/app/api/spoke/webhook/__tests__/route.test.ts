import crypto from "crypto";
import { NextRequest } from "next/server";
import type { ExternalDispatch } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as table from "@/lib/__tests__/fakeDispatchTable";

const spoke = vi.hoisted(() => ({ createStop: vi.fn(), deleteStop: vi.fn() }));

vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
// Only the calls to Spoke are replaced; the webhook's own helpers are real.
vi.mock("@/lib/spoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spoke")>()),
  createSpokeUnassignedStop: spoke.createStop,
  deleteSpokeUnassignedStop: spoke.deleteStop,
}));

import { externalDispatchRowView } from "@/lib/externalDispatchStatus";
import { SpokeDispatchError } from "@/lib/spoke";
import { dispatchOrderToSpoke } from "@/lib/spokeDispatch";
import { POST } from "../route";

const SECRET = "test-webhook-secret";
const STOP = "unassignedStops/u1";

// Signed with the test secret, so the route's real signature check runs.
function post(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return POST(
    new NextRequest("http://localhost/api/spoke/webhook", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "spoke-signature": `sha256=${signature}` },
    })
  );
}

const attempted = (succeeded: boolean) => ({
  type: "stop.attempted_delivery",
  data: { id: STOP, deliveryInfo: { succeeded }, orderInfo: { sellerOrderId: "order-1" } },
});

beforeEach(() => {
  vi.stubEnv("SPOKE_WEBHOOK_SECRET", SECRET);
  table.resetTable();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Spoke webhook failed-delivery alert", () => {
  it("alerts the store once when Anchor reports a failed delivery", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    const res = await post(attempted(false));

    expect(res.status).toBe(200);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
    expect(table.notifications).toEqual([
      {
        type: "DELIVERY_FAILED",
        message: "Anchor could not deliver to Riley Chen at 7380 120 St, Surrey.",
        storeId: table.STORE.id,
      },
    ]);
  });

  it("doesn't alert again for a replay of the same event", async () => {
    table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    await post(attempted(false));
    await post(attempted(false));

    expect(table.notifications).toHaveLength(1);
  });

  it("doesn't alert for a successful delivery", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    await post(attempted(true));

    expect(table.row(sent.id).status).toBe("DELIVERED");
    expect(table.notifications).toEqual([]);
  });

  it("alerts when the failure lands on the second try, after another update raced it", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "SUBMITTED", spokeStopId: STOP });
    table.externalDispatch.findFirst.mockImplementationOnce(async (args) => {
      const read = await table.impl.findFirst(args);
      table.row(sent.id).status = "IN_TRANSIT";
      return read;
    });

    await post(attempted(false));

    expect(table.externalDispatch.updateMany).toHaveBeenCalledTimes(2);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
    expect(table.notifications).toHaveLength(1);
  });

  it("still answers Spoke when the alert can't be saved", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });
    table.notification.create.mockRejectedValueOnce(new Error("database is busy"));

    const res = await post(attempted(false));

    expect(res.status).toBe(200);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
  });

  it("rejects a body signed with another secret", async () => {
    table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    expect((await post(attempted(false), "wrong-secret")).status).toBe(401);
    expect(table.notifications).toEqual([]);
  });
});

describe("Spoke webhook tracking link", () => {
  const EARLIER = "https://track.example.test/stops/earlier";
  const event = (type: string, data: Record<string, unknown> = {}) => ({
    type,
    data: { id: STOP, orderInfo: { sellerOrderId: "order-1" }, ...data },
  });
  const sentRow = (trackingLink: string | null = EARLIER) =>
    table.addRow({ idempotencyKey: "order-1", status: "SUBMITTED", spokeStopId: STOP, trackingLink });

  it("stores a valid HTTPS link from Anchor", async () => {
    const sent = sentRow(null);
    const link = "https://track.example.test/stops/s1?key=a%2Bb";

    await post(event("stop.tracking_link_added", { trackingLink: link }));

    expect(table.row(sent.id)).toMatchObject({ trackingLink: link, status: "SUBMITTED" });
  });

  it.each([
    ["an http: link", "http://track.example.test/stops/s1"],
    ["a javascript: link", "javascript:alert(document.cookie)"],
    ["a link with a username and password", "https://user:secret@track.example.test/stops/s1"],
  ])("keeps the earlier link instead of %s", async (_label, link) => {
    const sent = sentRow();

    await post(event("stop.tracking_link_added", { trackingLink: link }));

    expect(table.row(sent.id).trackingLink).toBe(EARLIER);
  });

  it("keeps the earlier link when an event has none", async () => {
    const sent = sentRow();

    await post(event("stop.allocated"));

    expect(table.row(sent.id)).toMatchObject({ trackingLink: EARLIER, lastWebhookEventType: "stop.allocated" });
  });
});

describe("Spoke webhook for an order cancelled here", () => {
  const PLAN_STOP = "plans/p1/stops/s1";
  // Anchor moved the stop onto a route, so its events carry the route's stop
  // id; the order is found by its key (sellerOrderId).
  const event = (type: string, data: Record<string, unknown> = {}) => ({
    type,
    data: { id: PLAN_STOP, orderInfo: { sellerOrderId: "order-1" }, ...data },
  });

  function cancelledRow() {
    return table.addRow({
      idempotencyKey: "order-1",
      status: "CANCELLED",
      workflowStep: "CANCEL_UNASSIGNED_STOP",
      spokeStopId: STOP,
      externalReference: STOP,
    });
  }

  it("keeps it cancelled, records the event and alerts staff once", async () => {
    const cancelled = cancelledRow();

    const res = await post(event("stop.allocated"));

    expect(res.status).toBe(200);
    expect(table.row(cancelled.id)).toMatchObject({
      status: "CANCELLED",
      workflowStep: "CANCELLED_BUT_ACTIVE",
      lastWebhookEventType: "stop.allocated",
      webhookPayload: expect.objectContaining({ type: "stop.allocated" }),
      spokeStopId: STOP,
    });
    expect(table.notifications).toEqual([
      {
        type: "SPOKE_CANCEL_INCOMPLETE",
        message:
          "Anchor has started handling an order that was cancelled here (Riley Chen, 7380 120 St, Surrey). Contact Anchor so it isn't delivered.",
        storeId: table.STORE.id,
      },
    ]);

    await post(event("stop.out_for_delivery"));

    expect(table.notifications).toHaveLength(1);
    expect(table.row(cancelled.id)).toMatchObject({
      status: "CANCELLED",
      workflowStep: "CANCELLED_BUT_ACTIVE",
      lastWebhookEventType: "stop.out_for_delivery",
      spokeStopId: STOP,
    });
  });

  it("alerts for a cancelled row whose step was never set", async () => {
    const cancelled = cancelledRow();
    table.row(cancelled.id).workflowStep = null;

    await post(event("stop.attempted_delivery", { deliveryInfo: { succeeded: true } }));

    expect(table.row(cancelled.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" });
    expect(table.notifications).toHaveLength(1);
  });

  describe("one alert per order, with the sender", () => {
    const stopCreated = { stopId: STOP, pending: false, requestPayload: {}, responsePayload: { id: STOP } };
    const removeFails = () =>
      spoke.deleteStop.mockRejectedValue(
        new SpokeDispatchError("Spoke CANCEL_UNASSIGNED_STOP failed with status 500.", 502, null, "CANCEL_UNASSIGNED_STOP", 500)
      );
    // The release of a waiting order, with the details saved on its row.
    const send = (row: ExternalDispatch) =>
      dispatchOrderToSpoke({
        ...row,
        store: table.STORE,
        selectedProviderUser: table.ANCHOR,
        scheduledDateKey: row.scheduledDate.toISOString().slice(0, 10),
      });
    const cancelHere = (id: string) =>
      Object.assign(table.row(id), { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });

    beforeEach(() => {
      vi.stubEnv("SPOKE_API_KEY", "test-key");
      spoke.createStop.mockReset();
      spoke.deleteStop.mockReset();
    });

    it.each([
      ["couldn't remove the stop it made", () => stopCreated],
      [
        "may have left a stop behind (its call timed out)",
        () => {
          throw new SpokeDispatchError("Spoke CREATE_UNASSIGNED_STOP request timed out.", 502, null, "CREATE_UNASSIGNED_STOP", null);
        },
      ],
    ])("tells staff to contact Anchor, once, when the sender %s and Anchor then starts on it", async (_label, answer) => {
      const waiting = table.addRow({ idempotencyKey: "order-1", status: "SCHEDULED" });
      spoke.createStop.mockImplementation(async () => {
        cancelHere(waiting.id);
        return answer();
      });
      removeFails();

      await send(waiting);
      expect(table.row(waiting.id).workflowStep).toBe("CANCEL_CLEANUP_FAILED");
      expect(table.notifications).toHaveLength(1);
      expect(table.notifications[0].message).toMatch(/Remove it in Spoke/);

      await post(event("stop.allocated"));

      const row = table.row(waiting.id);
      expect(row).toMatchObject({
        status: "CANCELLED",
        workflowStep: "CANCELLED_BUT_ACTIVE",
        lastWebhookEventType: "stop.allocated",
      });
      expect(table.notifications).toHaveLength(2);
      expect(table.notifications[1]).toEqual({
        type: "SPOKE_CANCEL_INCOMPLETE",
        message:
          "Anchor has started handling an order that was cancelled here (Riley Chen, 7380 120 St, Surrey). Contact Anchor so it isn't delivered.",
        storeId: table.STORE.id,
      });
      expect(externalDispatchRowView(row, { todayKey: "2026-11-22", vancouverHour: 11 }).statusNote).toBe(
        "Cancelled here, but Anchor has started on it. Contact Anchor so it isn't delivered."
      );

      await post(event("stop.out_for_delivery"));

      expect(table.notifications).toHaveLength(2);
      expect(table.row(waiting.id)).toMatchObject({
        status: "CANCELLED",
        workflowStep: "CANCELLED_BUT_ACTIVE",
        lastWebhookEventType: "stop.out_for_delivery",
      });
    });

    it("tells staff to contact Anchor once when two of Anchor's events arrive together", async () => {
      const left = table.addRow({
        idempotencyKey: "order-1",
        status: "CANCELLED",
        workflowStep: "CANCEL_CLEANUP_FAILED",
        spokeStopId: STOP,
      });

      await Promise.all([post(event("stop.allocated")), post(event("stop.out_for_delivery"))]);

      expect(table.row(left.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE", spokeStopId: STOP });
      expect(table.notifications).toHaveLength(1);
      expect(table.notifications[0].message).toMatch(/Contact Anchor so it isn't delivered\.$/);
    });

    it("doesn't alert again when Anchor reports the order during the send and the stop then can't be removed", async () => {
      const waiting = table.addRow({ idempotencyKey: "order-1", status: "SCHEDULED" });
      spoke.createStop.mockImplementation(async () => {
        cancelHere(waiting.id);
        await post(event("stop.allocated"));
        return stopCreated;
      });
      removeFails();

      await send(waiting);

      expect(spoke.deleteStop).toHaveBeenCalledTimes(1);
      expect(table.row(waiting.id)).toMatchObject({
        status: "CANCELLED",
        workflowStep: "CANCELLED_BUT_ACTIVE",
        spokeStopId: STOP,
      });
      expect(table.notifications).toHaveLength(1);
      expect(table.notifications[0].message).toMatch(/^Anchor has started handling an order that was cancelled here/);
    });
  });

  it("ignores unknown events and tracking links", async () => {
    const cancelled = cancelledRow();
    const before = { ...cancelled };

    await post(event("stop.something_new"));
    await post(event("stop.tracking_link_added", { trackingLink: "https://track.example/s1" }));

    expect(table.notifications).toEqual([]);
    expect(table.row(cancelled.id)).toEqual(before);
  });

  it("still ignores everything for a delivered order", async () => {
    const delivered = table.addRow({ idempotencyKey: "order-1", status: "DELIVERED", spokeStopId: STOP });
    const before = { ...delivered };

    await post(event("stop.attempted_delivery", { deliveryInfo: { succeeded: false } }));

    expect(table.row(delivered.id)).toEqual(before);
    expect(table.notifications).toEqual([]);
  });
});
