import {
  isVacationHoldActive, recurringSkipScope, sameUtcDay, WEEK_OVER_DAY, WEEK_SKIP_REASON, type RecurringSkipCandidate, type VacationHold,
} from "./recurringHolds";

export type CalendarHold = { type: "INSTANCE" | "WEEK" | "TEMPLATE"; reason: string | null };

// A week skip, a one-day note and a vacation can all apply to the same delivery.
// The first entry is the hold the existing quick view can act on.
export function holdsForCalendarDate(
  skips: readonly RecurringSkipCandidate[], vacation: VacationHold, day: Date, sunday: Date,
): CalendarHold[] {
  // Matched by calendar day, as the order generator does, so the two agree.
  const week = skips.find((skip) => sameUtcDay(skip.skipDate, sunday) && recurringSkipScope(skip) === "WEEK");
  const singleDay = skips.find((skip) => sameUtcDay(skip.skipDate, day) && (
    recurringSkipScope(skip) === "DAY" || skip.scope === WEEK_OVER_DAY
  ));
  const holds: CalendarHold[] = [];
  // A combined Sunday row stores only the one-day reason. Skip This Week
  // always saves WEEK_SKIP_REASON, and undoing the day puts it back, so the
  // week part shows that.
  if (week) holds.push({ type: "WEEK", reason: week.scope === WEEK_OVER_DAY ? WEEK_SKIP_REASON : week.reason?.trim() || null });
  if (singleDay) holds.push({ type: "INSTANCE", reason: singleDay.reason?.trim() || null });
  if (isVacationHoldActive(vacation, day)) holds.push({ type: "TEMPLATE", reason: null });
  return holds;
}

export interface WeeklyHoldInstance {
  patientId?: string | null;
  recurringOrderId: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  date: string;
  isHeld: boolean;
  holdType: CalendarHold["type"] | null;
  holdReason: string | null;
  holdDetails?: CalendarHold[];
}

/** How the Weekly holds panel and the quick view name each kind of hold. */
export const HOLD_TYPE_LABELS: Record<CalendarHold["type"], string> = {
  INSTANCE: "One-day hold", WEEK: "Week skipped", TEMPLATE: "Vacation hold",
};

/** The note shown with a hold. A vacation needs none; a skip without one says so. */
export function holdNote(hold: CalendarHold) {
  return hold.reason?.trim() || (hold.type === "TEMPLATE" ? null : "No reason recorded");
}

/** Every hold on one delivery, primary first, for rows with or without the full list. */
export function instanceHolds(row: WeeklyHoldInstance): CalendarHold[] {
  if (!row.isHeld) return [];
  return row.holdDetails?.length ? row.holdDetails : [{ type: row.holdType ?? "INSTANCE", reason: row.holdReason }];
}

type HoldDates = CalendarHold & { dates: string[] };

export function groupWeeklyHolds(instances: readonly WeeklyHoldInstance[]) {
  const patients = new Map<string, {
    name: string; address: string; reasons: Map<string, HoldDates>;
  }>();
  const nameCounts = new Map<string, number>();
  for (const row of instances) {
    if (!row.isHeld) continue;
    const id = row.patientId ? "patient:" + row.patientId : "profile:" + row.recurringOrderId;
    let patient = patients.get(id);
    if (!patient) {
      patient = {
        name: row.patientName,
        address: [row.deliveryAddress, row.deliveryCity].filter(Boolean).join(", "),
        reasons: new Map(),
      };
      patients.set(id, patient);
      nameCounts.set(patient.name, (nameCounts.get(patient.name) ?? 0) + 1);
    }
    for (const detail of instanceHolds(row)) {
      const reason = detail.reason?.trim() || null;
      const key = JSON.stringify([detail.type, reason]);
      let group = patient.reasons.get(key);
      if (!group) {
        group = { type: detail.type, reason, dates: [] };
        patient.reasons.set(key, group);
      }
      if (!group.dates.includes(row.date)) group.dates.push(row.date);
    }
  }
  return Array.from(patients, ([id, patient]) => ({
    id,
    name: patient.name,
    address: (nameCounts.get(patient.name) ?? 0) > 1 ? patient.address : null,
    holds: Array.from(patient.reasons.values(), (hold) => ({ ...hold, dates: hold.dates.sort() }))
      .sort((a, b) => a.dates[0].localeCompare(b.dates[0])),
  })).sort((a, b) => a.name.localeCompare(b.name, "en-CA") || a.id.localeCompare(b.id));
}
