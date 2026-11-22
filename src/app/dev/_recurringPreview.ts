// The localhost fixture keeps edits in this browser tab until it reloads.
import {
  WEEK_SKIP_REASON, dayHoldUpdate, recurringSkipScope, undoDayHold, undoWeekSkip, weekSkipUpdate, type RecurringSkipCandidate,
} from "@/lib/recurringHolds";
import { addDaysToDateKey, vancouverWeekStartKey } from "@/lib/vancouverDate";
import { holdsForCalendarDate } from "@/lib/weeklyHolds";
import { recurringOrders, TODAY } from "./_fixtures";

const weekKey = vancouverWeekStartKey();
const asDate = (key: string) => new Date(key + "T00:00:00Z");
const skips = new Map<string, RecurringSkipCandidate[]>([
  ["r5", [{ skipDate: asDate(weekKey), scope: "WEEK", reason: WEEK_SKIP_REASON }]],
  ["r6", [{ skipDate: asDate(addDaysToDateKey(weekKey, 1)), scope: "DAY", reason: "Family will collect this delivery." }]],
]);
let profiles = recurringOrders;
const listeners = new Set<() => void>();
export const previewProfiles = () => profiles;
export function subscribeToPreview(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

export function updatePreviewHold(path: string, method: string, raw: unknown) {
  const match = /^recurring\/([^/]+)(?:\/(skip|unskip))?$/.exec(path);
  if (!match || !(match[2] ? method === "POST" : method === "PATCH")) return false;
  const profile = profiles.find((p) => p.id === match[1]);
  if (!profile) return false;
  const body = typeof raw === "string" ? JSON.parse(raw) : {};
  let updated = { ...profile };
  if (match[2]) {
    const date = asDate(body.skipDate ?? weekKey);
    const rows = skips.get(profile.id) ?? [];
    const current = rows.find((row) => +row.skipDate === +date) ?? null;
    const rest = rows.filter((row) => row !== current);
    const weekly = !body.skipDate || body.scope === "WEEK";
    if (match[2] === "skip") {
      const reason = body.reason || (weekly ? WEEK_SKIP_REASON : "Held from recurring calendar");
      const change = weekly ? weekSkipUpdate(current, reason) : dayHoldUpdate(current, reason);
      rest.push({ skipDate: date, ...current, ...change });
    } else {
      const action = weekly ? undoWeekSkip(current) : undoDayHold(current);
      if (current && action === "restoreDay") rest.push({ ...current, scope: "DAY" });
      if (current && action === "keepWeek") rest.push({ ...current, scope: "WEEK", reason: WEEK_SKIP_REASON });
      if (current && action === "none") rest.push(current);
    }
    skips.set(profile.id, rest);
    const thisWeek = rest.filter((row) => row.skipDate >= asDate(weekKey) && row.skipDate < asDate(addDaysToDateKey(weekKey, 7)));
    updated.isSkippedThisWeek = thisWeek.some((row) => recurringSkipScope(row) === "WEEK");
    updated.heldDaysThisWeek = thisWeek.filter((row) => recurringSkipScope(row) === "DAY").length;
  } else if (typeof body.isOnHold === "boolean") {
    updated = { ...updated, isOnHold: body.isOnHold, holdStart: body.holdStart ?? null, holdEnd: body.holdEnd ?? null,
      holdUpcoming: !!body.holdStart && body.holdStart > TODAY };
  } else {
    return false;
  }
  profiles = profiles.map((p) => p.id === updated.id ? updated : p);
  for (const listener of listeners) listener();
  return true;
}

export function calendarInstances(start: string, end: string) {
  const rows = [];
  for (let key = start; key < end; key = addDaysToDateKey(key, 1)) {
    const day = asDate(key);
    const sundayKey = addDaysToDateKey(key, -day.getUTCDay());
    const sunday = asDate(sundayKey);
    for (const p of profiles) {
      if (!p.isActive || !p.activeDays.includes(day.getUTCDay())) continue;
      const anchor = new Date(p.recurrenceAnchorDate);
      anchor.setUTCDate(anchor.getUTCDate() - anchor.getUTCDay());
      const weeks = Math.round((sunday.getTime() - anchor.getTime()) / 604800000);
      if (p.recurrenceIntervalWeeks > 1 && (weeks < 0 || weeks % p.recurrenceIntervalWeeks !== 0)) continue;
      const holdDetails = holdsForCalendarDate(skips.get(p.id) ?? [], {
        isOnHold: p.isOnHold, holdStart: p.holdStart ? new Date(p.holdStart) : null, holdEnd: p.holdEnd ? new Date(p.holdEnd) : null,
      }, day, sunday);
      const hold = holdDetails[0];
      rows.push({
        id: p.id + ":" + key, recurringOrderId: p.id, patientId: null, date: key, patientName: p.patientName,
        deliveryAddress: p.deliveryAddress, deliveryCity: p.deliveryCity, zoneName: p.zoneName,
        assignedDriverName: p.assignedDriverName, assignedDriverId: p.assignedDriverId,
        isHeld: !!hold, holdType: hold?.type ?? null, holdReason: hold?.reason ?? null, holdDetails,
        skipDate: hold?.type === "WEEK" ? sundayKey : hold?.type === "INSTANCE" ? key : null,
        generatedOrderStatus: null,
      });
    }
  }
  return rows;
}
