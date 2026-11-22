// Client-safe (no server-only imports) status rules for Anchor handoffs
// (ExternalDispatch rows). The sender, the cancel route and the screens all
// read these lists, so a status can't be cancellable on one and not another.

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

// workflowStep while the sender is talking to Spoke. The status is left as it
// was, so a send cut short is picked up again by the next release run.
export const IN_FLIGHT_STEP = "SENDING";

const SENDABLE = new Set(SENDABLE_EXTERNAL_STATUSES);
const CANCELLABLE = new Set(CANCELLABLE_EXTERNAL_STATUSES);

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
