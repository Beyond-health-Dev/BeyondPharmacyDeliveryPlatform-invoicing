import { isVacationHoldActive, recurringSkipScope, WEEK_OVER_DAY, type RecurringSkipCandidate, type VacationHold } from "./recurringHolds";

export type CalendarHold = { type: "INSTANCE" | "WEEK" | "TEMPLATE"; reason: string | null };

// A week skip, a one-day note and a vacation can all apply to the same delivery.
// The first entry is the hold the existing quick view can act on.
export function holdsForCalendarDate(
  skips: readonly RecurringSkipCandidate[], vacation: VacationHold, day: Date, sunday: Date,
): CalendarHold[] {
  const week = skips.find((skip) => skip.skipDate.getTime() === sunday.getTime() && recurringSkipScope(skip) === "WEEK");
  const singleDay = skips.find((skip) => skip.skipDate.getTime() === day.getTime() && (
    recurringSkipScope(skip) === "DAY" || skip.scope === WEEK_OVER_DAY
  ));
  const holds: CalendarHold[] = [];
  // A combined Sunday row stores only the one-day reason.
  if (week) holds.push({ type: "WEEK", reason: week.scope === WEEK_OVER_DAY ? null : week.reason?.trim() || null });
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
    const details = row.holdDetails?.length ? row.holdDetails : [{ type: row.holdType ?? "INSTANCE", reason: row.holdReason }];
    for (const detail of details) {
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
