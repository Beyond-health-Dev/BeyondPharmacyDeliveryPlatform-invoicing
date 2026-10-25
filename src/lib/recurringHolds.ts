// What pauses a recurring delivery on a given day: a vacation hold on the
// profile, a one-day hold from the calendar, or a week-long "Skip This Week".
// Pure, so the order generator, the daily CSV, the calendar and the Recurring
// page all read holds and skips the same way. Dates are UTC midnights standing
// for Vancouver calendar dates, so they are compared with UTC getters.

/** The reason "Skip This Week" stores when staff don't give one. */
export const WEEK_SKIP_REASON = "Patient picked up in-store";

// A Sunday has one skip row, so a one-day hold and a week skip on the same
// Sunday share it. The row is then stored as WEEK_OVER_DAY: a week skip that
// keeps the one-day hold's reason, and gives the hold back when the week is
// undone.
export const WEEK_OVER_DAY = "WEEK_OVER_DAY";

export type RecurringSkipScope = "DAY" | "WEEK";

export interface RecurringSkipCandidate {
  skipDate: Date;
  scope?: string | null;
  reason?: string | null;
}

/**
 * DAY skips hold one calendar day; WEEK skips ("Skip This Week") hold the
 * whole week starting on their date, a Sunday, and so do WEEK_OVER_DAY rows
 * (below). Rows saved before the scope was recorded (or by older code during
 * a deploy) have no scope: back then Skip This Week always saved the week's
 * Sunday with WEEK_SKIP_REASON.
 */
export function recurringSkipScope(skip: RecurringSkipCandidate): RecurringSkipScope {
  if (skip.scope === "WEEK" || skip.scope === WEEK_OVER_DAY) return "WEEK";
  if (skip.scope === "DAY") return "DAY";
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

/** The update for Skip This Week on a Sunday that may already have a row. */
export function weekSkipUpdate(existing: RecurringSkipCandidate | null, reason: string) {
  if (existing?.scope === WEEK_OVER_DAY) return {};
  if (existing && recurringSkipScope(existing) === "DAY") return { scope: WEEK_OVER_DAY };
  return { scope: "WEEK", reason };
}

/** The update for a one-day hold on a date that may already have a row. */
export function dayHoldUpdate(existing: RecurringSkipCandidate | null, reason: string) {
  return existing && recurringSkipScope(existing) === "WEEK"
    ? { scope: WEEK_OVER_DAY, reason }
    : { scope: "DAY", reason };
}

/** What undoing Skip This Week does to the row on the week's Sunday. */
export function undoWeekSkip(row: RecurringSkipCandidate | null): "none" | "delete" | "restoreDay" {
  if (!row || recurringSkipScope(row) !== "WEEK") return "none";
  return row.scope === WEEK_OVER_DAY ? "restoreDay" : "delete";
}

/**
 * What the calendar's Resume on a one-day hold does to the row on that date:
 * on a Sunday shared with a week skip, only the one-day hold goes.
 */
export function undoDayHold(row: RecurringSkipCandidate | null): "none" | "delete" | "keepWeek" {
  if (!row) return "none";
  return row.scope === WEEK_OVER_DAY ? "keepWeek" : "delete";
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
