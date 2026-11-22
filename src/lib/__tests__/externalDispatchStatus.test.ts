import { describe, expect, it } from "vitest";
import {
  canCancelExternalDispatch,
  cancelConfirmMessage,
  CANCELLABLE_EXTERNAL_STATUSES,
  externalStatusLabel,
  externalStatusNote,
  heldOrderHint,
  heldOrderSavedMessage,
  isCancellableExternalStatus,
  isHeldForRelease,
  isHeldUntilDeliveryDay,
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

describe("externalStatusLabel", () => {
  it("reads 'Waiting to send' while an order is held", () => {
    expect(externalStatusLabel("SCHEDULED")).toBe("Waiting to send");
  });

  it("shows every other status as the screens always have", () => {
    expect(externalStatusLabel("SUBMITTED")).toBe("SUBMITTED");
    expect(externalStatusLabel("DISPATCH_FAILED")).toBe("DISPATCH FAILED");
    expect(externalStatusLabel("TRACKING_LINK_ADDED")).toBe("TRACKING LINK ADDED");
  });
});

describe("externalStatusNote", () => {
  // Sun Nov 22 2026 in Vancouver.
  const todayKey = "2026-11-22";
  const note = (status: string, scheduledDateKey: string, vancouverHour = 11) =>
    externalStatusNote({ status, scheduledDateKey, todayKey, vancouverHour });

  it("says when a held order goes to Anchor", () => {
    expect(note("SCHEDULED", "2026-11-23")).toBe("Goes to Anchor about 6 AM tomorrow");
    expect(note("SCHEDULED", "2026-11-26")).toBe("Goes to Anchor about 6 AM on Thu, Nov 26");
    expect(note("SCHEDULED", "2027-01-04")).toBe("Goes to Anchor about 6 AM on Mon, Jan 4, 2027");
  });

  it("says 'today' for a held order before the 6 AM run has finished", () => {
    expect(note("SCHEDULED", todayKey, 0)).toBe("Goes to Anchor about 6 AM today");
    expect(note("SCHEDULED", todayKey, 5)).toBe("Goes to Anchor about 6 AM today");
    expect(note("SCHEDULED", todayKey, 6)).toBe("Goes to Anchor about 6 AM today");
  });

  it("flags a held order the run missed: today from 7 AM, or a past day", () => {
    expect(note("SCHEDULED", todayKey, 7)).toBe("Not sent to Anchor yet");
    expect(note("SCHEDULED", todayKey, 15)).toBe("Not sent to Anchor yet");
    expect(note("SCHEDULED", "2026-11-21", 3)).toBe("Not sent to Anchor yet");
  });

  it("flags a past order Anchor never confirmed", () => {
    for (const status of UNCONFIRMED_EXTERNAL_STATUSES) {
      expect(note(status, "2026-11-21")).toBe("No confirmation from Anchor");
    }
  });

  it("says nothing for today's unconfirmed orders or finished ones", () => {
    expect(note("SUBMITTED", todayKey)).toBeNull();
    expect(note("ALLOCATED", todayKey, 23)).toBeNull();
    expect(note("DELIVERED", "2026-11-20")).toBeNull();
    expect(note("DELIVERY_FAILED", "2026-11-20")).toBeNull();
    expect(note("DISPATCH_FAILED", "2026-11-20")).toBeNull();
    expect(note("CANCELLED", "2026-11-20")).toBeNull();
  });
});

describe("cancelConfirmMessage", () => {
  it("tells staff a held order never reached Anchor", () => {
    expect(cancelConfirmMessage("SCHEDULED")).toBe(
      "Cancel this order? It hasn't been sent to Anchor yet, so cancelling just removes it here."
    );
  });

  it("warns that a failed send may still have reached Anchor", () => {
    const message = cancelConfirmMessage("DISPATCH_FAILED");
    expect(message).toMatch(/^Cancel this order\? Sending it to Anchor failed/);
    expect(message).toContain("check Anchor's list in Spoke");
  });

  it("removes anything else from Anchor's unassigned list", () => {
    for (const status of ["PENDING", "STOP_CREATED", "SUBMITTED"]) {
      expect(cancelConfirmMessage(status)).toBe(
        "Cancel this order? This removes it from Anchor's unassigned list."
      );
    }
  });
});

describe("held new orders (New Order hint and saved toast)", () => {
  it("holds an order dated after today, and sends one for today at once", () => {
    expect(isHeldUntilDeliveryDay("2026-11-23", "2026-11-22")).toBe(true);
    expect(isHeldUntilDeliveryDay("2026-12-01", "2026-11-22")).toBe(true);
    expect(isHeldUntilDeliveryDay("2026-11-22", "2026-11-22")).toBe(false);
    expect(isHeldUntilDeliveryDay("2026-11-21", "2026-11-22")).toBe(false);
    // A cleared date field.
    expect(isHeldUntilDeliveryDay("", "2026-11-22")).toBe(false);
  });

  it("says when Anchor gets it and that it can be cancelled", () => {
    expect(heldOrderHint("2026-11-23", "2026-11-22")).toBe(
      "Anchor gets this order about 6 AM tomorrow. You can cancel it before then."
    );
    expect(heldOrderHint("2026-11-24", "2026-11-22")).toBe(
      "Anchor gets this order about 6 AM on Tue, Nov 24. You can cancel it before then."
    );
  });

  it("starts the toast with Saved.", () => {
    expect(heldOrderSavedMessage("2026-11-23", "2026-11-22")).toBe(
      "Saved. Anchor gets this order about 6 AM tomorrow. You can cancel it before then."
    );
  });
});
