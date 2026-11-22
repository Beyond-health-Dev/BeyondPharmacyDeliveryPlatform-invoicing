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

// workflowStep while the sender is talking to Spoke. The status is left as it
// was, so a send cut short is picked up again by the next release run.
export const IN_FLIGHT_STEP = "SENDING";

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

// The status badge text. Every other status reads as it always has.
export function externalStatusLabel(status: string) {
  if (isHeldForRelease(status)) return "Waiting to send";
  return status.replace(/_/g, " ");
}

// A short line under the badge, or null. The clock parts come from the server
// (the screens must not read the browser's clock).
export function externalStatusNote({
  status,
  scheduledDateKey,
  todayKey,
  vancouverHour,
}: {
  status: string;
  scheduledDateKey: string;
  todayKey: string;
  vancouverHour: number;
}): string | null {
  if (isHeldForRelease(status)) {
    const stillDue =
      scheduledDateKey > todayKey ||
      (scheduledDateKey === todayKey && vancouverHour <= RELEASE_HOUR);
    return stillDue
      ? `Goes to Anchor about 6 AM ${describeDeliveryDayFrom(scheduledDateKey, todayKey)}`
      : "Not sent to Anchor yet";
  }
  if (UNCONFIRMED.has(status) && scheduledDateKey < todayKey) {
    return "No confirmation from Anchor";
  }
  return null;
}

export function cancelConfirmMessage(status: string) {
  if (isHeldForRelease(status)) {
    return "Cancel this order? It hasn't been sent to Anchor yet, so cancelling just removes it here.";
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
