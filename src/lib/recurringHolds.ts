// What pauses a recurring delivery on a given day: a vacation hold on the
// profile, a one-day hold from the calendar, or a week-long "Skip This Week".
// Pure, so the order generator, the daily CSV, the calendar and the Recurring
// page all read holds and skips the same way. Dates are UTC midnights standing
// for Vancouver calendar dates, so they are compared with UTC getters.

/** The reason "Skip This Week" stores when staff don't give one. */
export const WEEK_SKIP_REASON = "Patient picked up in-store";

export type RecurringSkipScope = "DAY" | "WEEK";

export interface RecurringSkipCandidate {
  skipDate: Date;
  scope?: string | null;
  reason?: string | null;
}

/**
 * DAY skips hold one calendar day; WEEK skips ("Skip This Week") hold the
 * whole week starting on their date, a Sunday. Rows saved before the scope
 * was recorded (or by older code during a deploy) have no scope: back then
 * Skip This Week always saved the week's Sunday with WEEK_SKIP_REASON.
 */
export function recurringSkipScope(skip: RecurringSkipCandidate): RecurringSkipScope {
  if (skip.scope === "WEEK" || skip.scope === "DAY") return skip.scope;
  return skip.skipDate.getUTCDay() === 0 && skip.reason === WEEK_SKIP_REASON ? "WEEK" : "DAY";
}

function sameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** The skip that holds this delivery day, if any. */
export function findRecurringSkipForDate<T extends RecurringSkipCandidate>(
  skips: readonly T[],
  deliveryDate: { dayStart: Date; weekStart: Date }
): T | undefined {
  return skips.find((skip) =>
    recurringSkipScope(skip) === "WEEK"
      ? sameUtcDay(skip.skipDate, deliveryDate.weekStart)
      : sameUtcDay(skip.skipDate, deliveryDate.dayStart)
  );
}

export function hasRecurringSkipForDate(
  skips: readonly RecurringSkipCandidate[],
  deliveryDate: { dayStart: Date; weekStart: Date }
) {
  return findRecurringSkipForDate(skips, deliveryDate) !== undefined;
}

export interface VacationHold {
  isOnHold: boolean;
  holdStart: Date | null;
  holdEnd: Date | null;
}

/**
 * Whether the profile's vacation hold covers this day. Both ends are
 * included; a hold without dates runs until it is removed. A hold set ahead
 * of time doesn't stop deliveries before its start.
 */
export function isVacationHoldActive(hold: VacationHold, dayStart: Date) {
  if (!hold.isOnHold) return false;
  if (!hold.holdStart || !hold.holdEnd) return true;
  return dayStart >= hold.holdStart && dayStart <= hold.holdEnd;
}
