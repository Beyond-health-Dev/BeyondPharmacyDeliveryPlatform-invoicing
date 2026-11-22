import { describe, expect, it } from "vitest";
import {
  canCancelExternalDispatch,
  CANCELLABLE_EXTERNAL_STATUSES,
  isCancellableExternalStatus,
  isHeldForRelease,
  isSendableExternalStatus,
  SENDABLE_EXTERNAL_STATUSES,
  UNCONFIRMED_EXTERNAL_STATUSES,
} from "@/lib/externalDispatchStatus";

describe("external dispatch status lists", () => {
  it("can still send from waiting, pending, stop-created and failed rows", () => {
    expect([...SENDABLE_EXTERNAL_STATUSES].sort()).toEqual(
      ["DISPATCH_FAILED", "PENDING", "SCHEDULED", "STOP_CREATED"]
    );
    for (const status of ["SUBMITTED", "ALLOCATED", "WEBHOOK_RECEIVED", "DELIVERED", "DELIVERY_FAILED", "CANCELLED"]) {
      expect(isSendableExternalStatus(status)).toBe(false);
    }
  });

  it("cancels anything still sendable, plus a stop sitting in Anchor's unassigned list", () => {
    expect([...CANCELLABLE_EXTERNAL_STATUSES].sort()).toEqual(
      ["DISPATCH_FAILED", "PENDING", "SCHEDULED", "STOP_CREATED", "SUBMITTED"]
    );
    for (const status of SENDABLE_EXTERNAL_STATUSES) expect(isCancellableExternalStatus(status)).toBe(true);
    for (const status of ["ALLOCATED", "WEBHOOK_RECEIVED", "IN_TRANSIT", "DELIVERED", "CANCELLED"]) {
      expect(isCancellableExternalStatus(status)).toBe(false);
    }
  });

  it("counts as unconfirmed only what was handed to Anchor without a final result", () => {
    for (const status of ["PENDING", "SUBMITTED", "ALLOCATED", "IN_TRANSIT", "DEPARTED", "WEBHOOK_RECEIVED"]) {
      expect(UNCONFIRMED_EXTERNAL_STATUSES).toContain(status);
    }
    for (const status of ["DELIVERED", "DELIVERY_FAILED", "CANCELLED", "SCHEDULED", "DISPATCH_FAILED"]) {
      expect(UNCONFIRMED_EXTERNAL_STATUSES).not.toContain(status);
    }
  });

  it("holds only SCHEDULED rows for the release run", () => {
    expect(isHeldForRelease("SCHEDULED")).toBe(true);
    expect(isHeldForRelease("PENDING")).toBe(false);
    expect(isHeldForRelease("DISPATCH_FAILED")).toBe(false);
  });
});

describe("canCancelExternalDispatch", () => {
  it("allows a waiting or failed order with no stop yet", () => {
    expect(canCancelExternalDispatch({ status: "SCHEDULED", spokeStopId: null })).toBe(true);
    expect(canCancelExternalDispatch({ status: "DISPATCH_FAILED", spokeStopId: null })).toBe(true);
  });

  it("allows a stop still in Anchor's unassigned list", () => {
    expect(canCancelExternalDispatch({ status: "SUBMITTED", spokeStopId: "unassignedStops/u1" })).toBe(true);
  });

  it("refuses a stop already on one of Anchor's routes", () => {
    expect(canCancelExternalDispatch({ status: "SUBMITTED", spokeStopId: "plans/p1/stops/s1" })).toBe(false);
  });

  it("refuses an order Anchor has started on", () => {
    expect(canCancelExternalDispatch({ status: "ALLOCATED", spokeStopId: "unassignedStops/u1" })).toBe(false);
    expect(canCancelExternalDispatch({ status: "CANCELLED", spokeStopId: null })).toBe(false);
  });
});
