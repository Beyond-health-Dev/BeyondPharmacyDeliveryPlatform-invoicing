import { describe, expect, it } from "vitest";
import {
  alreadySavedMessage,
  canCancelExternalDispatch,
  cancelConfirmMessage,
  CANCELLABLE_EXTERNAL_STATUSES,
  externalDispatchActions,
  externalDispatchRowView,
  externalNeedsAttention,
  externalStatusLabel,
  externalStatusNote,
  heldOrderHint,
  heldOrderSavedMessage,
  heldOrderToastMessage,
  isCancellableExternalStatus,
  isHeldForRelease,
  isHeldUntilDeliveryDay,
  isSendableExternalStatus,
  mayStillBeWithAnchorAfterCancel,
  newOrderAnchorHint,
  SENDABLE_EXTERNAL_STATUSES,
  UNCONFIRMED_EXTERNAL_STATUSES,
} from "@/lib/externalDispatchStatus";
import { statusBadgeClasses, statusTone } from "@/lib/statusTheme";

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
  it("reads 'WAITING TO SEND' while an order is held, in capitals like the other badges", () => {
    expect(externalStatusLabel("SCHEDULED")).toBe("WAITING TO SEND");
  });

  it("colours a held order as waiting, not like one Anchor has", () => {
    expect(statusTone("SCHEDULED")).toBe("butter");
    expect(statusBadgeClasses("SCHEDULED")).toBe(statusBadgeClasses("PENDING"));
    expect(statusBadgeClasses("SCHEDULED")).not.toBe(statusBadgeClasses("SUBMITTED"));
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

  it("tells staff how to send a held order the 6 AM run missed today", () => {
    const missed =
      "Missed the 6 AM send. Anchor doesn't have it yet. Press Generate Today's Orders on Recurring to send it.";
    expect(note("SCHEDULED", todayKey, 7)).toBe(missed);
    expect(note("SCHEDULED", todayKey, 15)).toBe(missed);
    expect(note("SCHEDULED", todayKey, 23)).toBe(missed);
  });

  it("says when an overdue held order was due, whatever the hour", () => {
    expect(note("SCHEDULED", "2026-11-21", 3)).toBe(
      "Was due Sat, Nov 21. Anchor doesn't have it. Send it with Generate Today's Orders on Recurring, or cancel it."
    );
    expect(note("SCHEDULED", "2026-11-14", 11)).toBe(
      "Was due Sat, Nov 14. Anchor doesn't have it. Send it with Generate Today's Orders on Recurring, or cancel it."
    );
    expect(note("SCHEDULED", "2025-12-31", 11)).toContain("Was due Wed, Dec 31, 2025.");
  });

  it("says what to do about a failed send or delivery", () => {
    expect(note("DISPATCH_FAILED", todayKey)).toBe("Didn't reach Anchor. Press Retry to send it again.");
    expect(note("DISPATCH_FAILED", "2026-11-20")).toBe("Didn't reach Anchor. Press Retry to send it again.");
    expect(note("DELIVERY_FAILED", todayKey)).toBe("Anchor couldn't deliver it.");
    expect(note("DELIVERY_FAILED", "2026-11-20")).toBe("Anchor couldn't deliver it.");
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
    expect(note("CANCELLED", "2026-11-20")).toBeNull();
  });
});

describe("externalNeedsAttention (a held order that missed its send)", () => {
  const todayKey = "2026-11-22";
  const attention = (status: string, scheduledDateKey: string, vancouverHour: number) =>
    externalNeedsAttention({ status, scheduledDateKey, todayKey, vancouverHour });

  it("flags a held order still here after the 6 o'clock hour, or dated a past day", () => {
    expect(attention("SCHEDULED", todayKey, 7)).toBe(true);
    expect(attention("SCHEDULED", todayKey, 18)).toBe(true);
    expect(attention("SCHEDULED", "2026-11-21", 2)).toBe(true);
  });

  it("leaves a held order alone until the 6 AM run has had its hour", () => {
    expect(attention("SCHEDULED", todayKey, 0)).toBe(false);
    expect(attention("SCHEDULED", todayKey, 6)).toBe(false);
    expect(attention("SCHEDULED", "2026-11-23", 23)).toBe(false);
  });

  it("is only for held orders (failed ones are already shown as failed)", () => {
    for (const status of ["SUBMITTED", "DISPATCH_FAILED", "DELIVERY_FAILED", "CANCELLED", "ALLOCATED"]) {
      expect(attention(status, "2026-11-20", 11)).toBe(false);
    }
  });
});

describe("externalDispatchRowView (an Anchor row on Orders and the dashboard)", () => {
  const clock = { todayKey: "2026-11-22", vancouverHour: 11 };
  const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);

  it("offers Cancel on a held order with no stop, and says when Anchor gets it", () => {
    expect(
      externalDispatchRowView({ status: "SCHEDULED", spokeStopId: null, scheduledDate: midnight("2026-11-23") }, clock)
    ).toEqual({
      canCancelExternal: true,
      statusLabel: "WAITING TO SEND",
      statusNote: "Goes to Anchor about 6 AM tomorrow",
      needsAttention: false,
    });
  });

  it("doesn't offer Cancel once the stop is on one of Anchor's routes", () => {
    expect(
      externalDispatchRowView(
        { status: "SUBMITTED", spokeStopId: "plans/p1/stops/s1", scheduledDate: midnight("2026-11-22") },
        clock
      )
    ).toEqual({ canCancelExternal: false, statusLabel: "SUBMITTED", statusNote: null, needsAttention: false });
  });

  it("flags an overdue held order for attention", () => {
    const row = externalDispatchRowView(
      { status: "SCHEDULED", spokeStopId: null, scheduledDate: midnight("2026-11-21") },
      clock
    );
    expect(row).toMatchObject({ canCancelExternal: true, statusLabel: "WAITING TO SEND", needsAttention: true });
    expect(row.statusNote).toMatch(/^Was due Sat, Nov 21\./);
  });

  it("flags a held order for today that missed the 6 AM send", () => {
    expect(
      externalDispatchRowView({ status: "SCHEDULED", spokeStopId: null, scheduledDate: midnight("2026-11-22") }, clock)
    ).toMatchObject({ needsAttention: true, statusNote: expect.stringMatching(/^Missed the 6 AM send/) });
  });
});

describe("externalDispatchActions", () => {
  it("offers Retry and Cancel on a failed send", () => {
    expect(externalDispatchActions({ dispatchId: "d1", status: "DISPATCH_FAILED", canCancel: true })).toEqual({
      retry: true,
      cancel: true,
    });
  });

  it("offers only Cancel on a held order, and nothing once Anchor has it", () => {
    expect(externalDispatchActions({ dispatchId: "d1", status: "SCHEDULED", canCancel: true })).toEqual({
      retry: false,
      cancel: true,
    });
    expect(externalDispatchActions({ dispatchId: "d1", status: "ALLOCATED", canCancel: true })).toEqual({
      retry: false,
      cancel: false,
    });
    expect(externalDispatchActions({ dispatchId: null, status: "DISPATCH_FAILED", canCancel: true })).toEqual({
      retry: false,
      cancel: false,
    });
  });
});

describe("mayStillBeWithAnchorAfterCancel", () => {
  it("is true for a cancelled order whose stop may be left at Anchor", () => {
    expect(mayStillBeWithAnchorAfterCancel({ status: "CANCELLED", workflowStep: "CANCEL_CLEANUP_FAILED" })).toBe(true);
    expect(mayStillBeWithAnchorAfterCancel({ status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" })).toBe(true);
  });

  it("is false for a clean cancel, or an order that isn't cancelled", () => {
    expect(mayStillBeWithAnchorAfterCancel({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" })).toBe(false);
    expect(mayStillBeWithAnchorAfterCancel({ status: "CANCELLED", workflowStep: null })).toBe(false);
    expect(mayStillBeWithAnchorAfterCancel({ status: "SUBMITTED", workflowStep: "CANCEL_CLEANUP_FAILED" })).toBe(false);
  });
});

describe("alreadySavedMessage (same request saved before)", () => {
  it("names the day it was saved for and what happened to it", () => {
    expect(alreadySavedMessage({ status: "DISPATCH_FAILED", scheduledDateKey: "2026-11-22" }, "2026-11-22")).toBe(
      "This order was already saved for Sun, Nov 22 and didn't reach Anchor. Cancel that one on Orders first (and check Anchor's list if it may have been sent), then save it again for the new day."
    );
    expect(alreadySavedMessage({ status: "SCHEDULED", scheduledDateKey: "2026-11-23" }, "2026-11-22")).toContain(
      "already saved for Mon, Nov 23 and is waiting to go to Anchor."
    );
    expect(alreadySavedMessage({ status: "PENDING", scheduledDateKey: "2026-11-22" }, "2026-11-22")).toContain(
      "and is being sent to Anchor."
    );
  });

  it("tells staff to just save again when the earlier one was cancelled", () => {
    expect(alreadySavedMessage({ status: "CANCELLED", scheduledDateKey: "2026-11-23" }, "2026-11-22")).toBe(
      "This order was already saved for Mon, Nov 23 and then cancelled. Save it again to make a new order."
    );
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

  it("shows the hint on New Order only for an Anchor order dated after today", () => {
    expect(newOrderAnchorHint({ isAnchor: true, scheduledDateKey: "2026-11-23", todayKey: "2026-11-22" })).toBe(
      "Anchor gets this order about 6 AM tomorrow. You can cancel it before then."
    );
    expect(newOrderAnchorHint({ isAnchor: true, scheduledDateKey: "2026-11-22", todayKey: "2026-11-22" })).toBeNull();
    expect(newOrderAnchorHint({ isAnchor: false, scheduledDateKey: "2026-11-23", todayKey: "2026-11-22" })).toBeNull();
    // The form refreshed its today after midnight: tomorrow's order is now today's.
    expect(newOrderAnchorHint({ isAnchor: true, scheduledDateKey: "2026-11-23", todayKey: "2026-11-23" })).toBeNull();
  });

  it("toasts after saving only when the server held an Anchor order", () => {
    const summary = (status: string) => ({ external: true, provider: "SPOKE", dispatchId: "d1", status });
    expect(heldOrderToastMessage(summary("SCHEDULED"), "2026-11-24", "2026-11-22")).toBe(
      "Saved. Anchor gets this order about 6 AM on Tue, Nov 24. You can cancel it before then."
    );
    // Sent at once, an in-house order, or no body.
    expect(heldOrderToastMessage(summary("SUBMITTED"), "2026-11-22", "2026-11-22")).toBeNull();
    expect(heldOrderToastMessage({ id: "o1", status: "PENDING" }, "2026-11-23", "2026-11-22")).toBeNull();
    expect(heldOrderToastMessage({ id: "o1", status: "SCHEDULED" }, "2026-11-23", "2026-11-22")).toBeNull();
    expect(heldOrderToastMessage(null, "2026-11-23", "2026-11-22")).toBeNull();
  });
});
