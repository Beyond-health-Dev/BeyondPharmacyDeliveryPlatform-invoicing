// Client-safe (no server-only imports) status rules for Anchor handoffs
// (ExternalDispatch rows). The sender, the cancel route and the screens all
// read these lists, so a status can't be cancellable on one and not another.
import { describeDeliveryDayFrom } from "./vancouverDate";

// A send may still go ahead from these. Every write the sender makes is
// guarded by this list, so a cancel or Anchor's own update always wins.
export const SENDABLE_EXTERNAL_STATUSES: string[] = [
  "SCHEDULED",
  "PENDING",
  "STOP_CREATED",
  "DISPATCH_FAILED",
];

// Staff may cancel from the pharmacy portal: anything not yet sent, plus a
// stop still sitting in Anchor's unassigned list.
export const CANCELLABLE_EXTERNAL_STATUSES: string[] = [
  ...SENDABLE_EXTERNAL_STATUSES,
  "SUBMITTED",
];

// Handed to Anchor with no final result (delivered, failed or cancelled) back.
export const UNCONFIRMED_EXTERNAL_STATUSES: string[] = [
  "PENDING",
  "STOP_CREATED",
  "SUBMITTED",
  "ALLOCATED",
  "IN_TRANSIT",
  "DEPARTED",
  "TRACKING_LINK_ADDED",
  "WEBHOOK_RECEIVED",
];

// Anchor couldn't deliver it, or it never reached Anchor. Shown like an
// in-house FAILED order.
export const FAILED_EXTERNAL_STATUSES: string[] = ["DELIVERY_FAILED", "DISPATCH_FAILED"];

// workflowStep while the sender is talking to Spoke (the release run sets it
// as it takes a row). The status is left as it was, so a send cut short is
// picked up again by a later release run.
export const IN_FLIGHT_STEP = "SENDING";

// workflowStep on a CANCELLED row whose stop may still be in Anchor's list:
// the sender couldn't remove the stop it made, or a send that failed may have
// left one behind. Staff were alerted to remove it in Spoke.
export const CANCEL_CLEANUP_FAILED_STEP = "CANCEL_CLEANUP_FAILED";

// workflowStep on a CANCELLED row that Anchor went on to allocate, route or
// deliver anyway (its webhook says so). Staff were alerted to contact Anchor.
// Nothing else overwrites it; a CANCEL_CLEANUP_FAILED row moves on to it.
export const CANCELLED_BUT_ACTIVE_STEP = "CANCELLED_BUT_ACTIVE";

// Rows no "cancelled but may still be with Anchor" alert has been raised for
// yet. Every path that raises one sets either marker above in the same
// statement as this check, so an order gets one alert. workflowStep is
// nullable, and Prisma's notIn leaves NULL rows out, hence the OR.
export const CANCEL_ALERT_NOT_RAISED = {
  OR: [
    { workflowStep: null },
    { workflowStep: { notIn: [CANCEL_CLEANUP_FAILED_STEP, CANCELLED_BUT_ACTIVE_STEP] } },
  ],
};

// A cancelled order that may still reach the patient through Anchor.
export function mayStillBeWithAnchorAfterCancel(dispatch: {
  status: string;
  workflowStep?: string | null;
}) {
  return (
    dispatch.status === "CANCELLED" &&
    (dispatch.workflowStep === CANCEL_CLEANUP_FAILED_STEP ||
      dispatch.workflowStep === CANCELLED_BUT_ACTIVE_STEP)
  );
}

const SENDABLE = new Set(SENDABLE_EXTERNAL_STATUSES);
const CANCELLABLE = new Set(CANCELLABLE_EXTERNAL_STATUSES);
const UNCONFIRMED = new Set(UNCONFIRMED_EXTERNAL_STATUSES);

export function isSendableExternalStatus(status: string) {
  return SENDABLE.has(status);
}

export function isCancellableExternalStatus(status: string) {
  return CANCELLABLE.has(status);
}

// Held here until the 6 AM run on its delivery day.
export function isHeldForRelease(status: string) {
  return status === "SCHEDULED";
}

// Only stops still in Anchor's unassigned list can be withdrawn; once a stop
// is on a plan, Anchor has it.
export function canCancelExternalDispatch(dispatch: {
  status: string;
  spokeStopId: string | null;
}) {
  return (
    isCancellableExternalStatus(dispatch.status) &&
    (!dispatch.spokeStopId || dispatch.spokeStopId.startsWith("unassignedStops/"))
  );
}

// ---- Staff wording ----

// The release run starts at 6 AM; a waiting order still here at 7 missed it.
const RELEASE_HOUR = 6;

// A new Anchor order dated after Vancouver's today is held for the release
// run (the same test the order POST makes); one for today goes at once.
export function isHeldUntilDeliveryDay(scheduledDateKey: string, todayKey: string) {
  return scheduledDateKey > todayKey;
}

// The status badge text, in capitals like every other badge.
export function externalStatusLabel(status: string) {
  if (isHeldForRelease(status)) return "WAITING TO SEND";
  return status.replace(/_/g, " ");
}

interface StatusClock {
  status: string;
  scheduledDateKey: string;
  todayKey: string;
  vancouverHour: number;
  // Left out: no stop at Anchor, and no cancel marker.
  spokeStopId?: string | null;
  workflowStep?: string | null;
}

// A held order the 6 AM run should already have sent: dated today from 7 AM
// on, or dated a day that has passed. Anchor doesn't have it.
function missedRelease({ status, scheduledDateKey, todayKey, vancouverHour }: StatusClock) {
  if (!isHeldForRelease(status)) return null;
  if (scheduledDateKey < todayKey) return "overdue";
  if (scheduledDateKey === todayKey && vancouverHour > RELEASE_HOUR) return "today";
  return null;
}

// "Sun, Nov 22" (with the year when it isn't this one) for a YYYY-MM-DD key.
function shortDayLabel(dateKey: string, todayKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(dateKey.slice(0, 4) !== todayKey.slice(0, 4) && { year: "numeric" }),
  });
}

// A short line under the badge, or null. The clock parts come from the server
// (the screens must not read the browser's clock).
export function externalStatusNote(clock: StatusClock): string | null {
  const { status, scheduledDateKey, todayKey } = clock;
  const missed = missedRelease(clock);
  if (missed === "today") {
    return "Missed the 6 AM send. Anchor doesn't have it yet. Press Generate Today's Orders on Recurring to send it.";
  }
  if (missed === "overdue") {
    return `Was due ${shortDayLabel(scheduledDateKey, todayKey)}. Anchor doesn't have it. Send it with Generate Today's Orders on Recurring, or cancel it.`;
  }
  if (isHeldForRelease(status)) {
    return `Goes to Anchor about 6 AM ${describeDeliveryDayFrom(scheduledDateKey, todayKey)}`;
  }
  if (mayStillBeWithAnchorAfterCancel(clock)) {
    return "Cancelled here, but Anchor may still have it. Remove it in Spoke.";
  }
  // With a stop id, Anchor has the stop; saving the send here didn't finish.
  if (status === "DISPATCH_FAILED") {
    return clock.spokeStopId
      ? "Reached Anchor, but wasn't finished here. Press Retry to finish it."
      : "Didn't reach Anchor. Press Retry to send it again.";
  }
  if (status === "DELIVERY_FAILED") return "Anchor couldn't deliver it.";
  if (UNCONFIRMED.has(status) && scheduledDateKey < todayKey) {
    return "No confirmation from Anchor";
  }
  return null;
}

// Shown like a failed one: a held order that missed its send, so it doesn't
// look as if it is still on its way, or a cancelled one Anchor may still have.
export function externalNeedsAttention(clock: StatusClock) {
  return missedRelease(clock) !== null || mayStillBeWithAnchorAfterCancel(clock);
}

// What the Orders page and the dashboard show for an Anchor row, worked out
// on the server (clock: Vancouver's today and hour).
export function externalDispatchRowView(
  dispatch: {
    status: string;
    spokeStopId: string | null;
    workflowStep: string | null;
    scheduledDate: Date;
  },
  clock: { todayKey: string; vancouverHour: number }
) {
  const statusClock = {
    status: dispatch.status,
    scheduledDateKey: dispatch.scheduledDate.toISOString().slice(0, 10),
    spokeStopId: dispatch.spokeStopId,
    workflowStep: dispatch.workflowStep,
    ...clock,
  };
  return {
    canCancelExternal: canCancelExternalDispatch(dispatch),
    // For the cancel confirmation (a stop at Anchor is removed).
    hasAnchorStop: !!dispatch.spokeStopId,
    statusLabel: externalStatusLabel(dispatch.status),
    statusNote: externalStatusNote(statusClock),
    needsAttention: externalNeedsAttention(statusClock),
  };
}

// The Retry and Cancel links an Anchor row offers. canCancel comes from the
// server (canCancelExternalDispatch); the status check keeps a stale row from
// offering it.
export function externalDispatchActions({
  dispatchId,
  status,
  canCancel,
}: {
  dispatchId: string | null;
  status: string;
  canCancel: boolean;
}) {
  return {
    retry: status === "DISPATCH_FAILED" && !!dispatchId,
    cancel: canCancel && !!dispatchId && isCancellableExternalStatus(status),
  };
}

// hasAnchorStop: a stop id is recorded, so the cancel removes it at Anchor.
export function cancelConfirmMessage(status: string, hasAnchorStop = false) {
  if (isHeldForRelease(status)) {
    return "Cancel this order? It hasn't been sent to Anchor yet, so cancelling just removes it here.";
  }
  if (status === "DISPATCH_FAILED" && hasAnchorStop) {
    return "Cancel this order? It reached Anchor but wasn't finished here, so cancelling removes it from Anchor's list.";
  }
  if (status === "DISPATCH_FAILED") {
    return "Cancel this order? Sending it to Anchor failed, so cancelling withdraws it here. If it did reach Anchor, check Anchor's list in Spoke and remove it there.";
  }
  return "Cancel this order? This removes it from Anchor's unassigned list.";
}

// Under the date on New Order, and (after "Saved.") in the toast once a held
// order is saved.
export function heldOrderHint(scheduledDateKey: string, todayKey: string) {
  return `Anchor gets this order about 6 AM ${describeDeliveryDayFrom(scheduledDateKey, todayKey)}. You can cancel it before then.`;
}

export function heldOrderSavedMessage(scheduledDateKey: string, todayKey: string) {
  return `Saved. ${heldOrderHint(scheduledDateKey, todayKey)}`;
}

// New Order: the hint under the date, or null. Only an Anchor order dated
// after today is held.
export function newOrderAnchorHint({
  isAnchor,
  scheduledDateKey,
  todayKey,
}: {
  isAnchor: boolean;
  scheduledDateKey: string;
  todayKey: string;
}) {
  return isAnchor && isHeldUntilDeliveryDay(scheduledDateKey, todayKey)
    ? heldOrderHint(scheduledDateKey, todayKey)
    : null;
}

// The toast after a save, or null: only when the server says it held an
// Anchor order (the order POST's dispatch summary with status SCHEDULED).
export function heldOrderToastMessage(saved: unknown, scheduledDateKey: string, todayKey: string) {
  const body = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : null;
  return body?.external === true && typeof body.status === "string" && isHeldForRelease(body.status)
    ? heldOrderSavedMessage(scheduledDateKey, todayKey)
    : null;
}

// What happened to an earlier save, for the "already saved for another day"
// message.
function savedOrderOutcome(status: string) {
  if (isHeldForRelease(status)) return "is waiting to go to Anchor";
  if (status === "PENDING" || status === "STOP_CREATED") return "is being sent to Anchor";
  if (status === "DISPATCH_FAILED") return "didn't reach Anchor";
  if (status === "DELIVERED") return "was delivered by Anchor";
  if (status === "DELIVERY_FAILED") return "Anchor couldn't deliver it";
  return "is with Anchor";
}

// The order form saved this order before (same request) for another day, or
// the earlier save can't simply be returned. Nothing is changed; staff sort
// out the earlier one first. The form then starts a new request, so saving
// again makes a new order.
export function alreadySavedMessage(dispatch: { status: string; scheduledDateKey: string }, todayKey: string) {
  const day = shortDayLabel(dispatch.scheduledDateKey, todayKey);
  if (dispatch.status === "CANCELLED") {
    return `This order was already saved for ${day} and then cancelled. Save it again to make a new order.`;
  }
  return `This order was already saved for ${day} and ${savedOrderOutcome(dispatch.status)}. Cancel that one on Orders first (and check Anchor's list if it may have been sent), then save it again for the new day.`;
}
