import { describe, expect, it } from "vitest";
import { groupWeeklyHolds, holdsForCalendarDate, type WeeklyHoldInstance } from "@/lib/weeklyHolds";
import { findRecurringSkipForDate, WEEK_OVER_DAY, WEEK_SKIP_REASON } from "@/lib/recurringHolds";

const date = (key: string) => new Date(key + "T00:00:00Z");
const sunday = date("2026-11-22");
const tuesday = date("2026-11-24");
const vacation = { isOnHold: true, holdStart: tuesday, holdEnd: tuesday };
const entry = (data: Partial<WeeklyHoldInstance> = {}): WeeklyHoldInstance => ({
  recurringOrderId: "first", patientId: "patient-1", patientName: "Sample Patient", deliveryAddress: "1 Sample Rd",
  deliveryCity: "Surrey", date: "2026-11-24", isHeld: true, holdType: "INSTANCE", holdReason: "Collecting in store", ...data,
});

describe("weekly calendar holds", () => {
  it("keeps each active reason and the same primary action in either database row order", () => {
    const week = { scope: "WEEK", skipDate: sunday, reason: "Away this week" };
    const day = { scope: "DAY", skipDate: tuesday, reason: "One-day note" };
    for (const rows of [[day, week], [week, day]]) {
      expect(holdsForCalendarDate(rows, vacation, tuesday, sunday)).toEqual([
        { type: "WEEK", reason: "Away this week" }, { type: "INSTANCE", reason: "One-day note" }, { type: "TEMPLATE", reason: null },
      ]);
    }
    expect(holdsForCalendarDate([day], vacation, date("2026-11-25"), sunday)).toEqual([]);
  });
  it("shows the stored Sunday reason only on Sunday when a week skip shares that row", () => {
    const combined = [{ scope: WEEK_OVER_DAY, skipDate: sunday, reason: "Sunday note" }];
    // The week part reads like any other Skip This Week.
    expect(holdsForCalendarDate(combined, vacation, sunday, sunday)).toEqual([
      { type: "WEEK", reason: WEEK_SKIP_REASON }, { type: "INSTANCE", reason: "Sunday note" },
    ]);
    expect(holdsForCalendarDate(combined, vacation, date("2026-11-25"), sunday)).toEqual([
      { type: "WEEK", reason: WEEK_SKIP_REASON },
    ]);
  });
  it("matches skips by calendar day, like the order generator, even when the time isn't midnight", () => {
    const noVacation = { isOnHold: false, holdStart: null, holdEnd: null };
    const week = { scope: "WEEK", skipDate: new Date("2026-11-22T08:00:00Z"), reason: WEEK_SKIP_REASON };
    const day = { scope: "DAY", skipDate: new Date("2026-11-24T17:30:00Z"), reason: "One-day note" };
    expect(holdsForCalendarDate([week, day], noVacation, tuesday, sunday)).toEqual([
      { type: "WEEK", reason: WEEK_SKIP_REASON }, { type: "INSTANCE", reason: "One-day note" },
    ]);
    for (const skip of [week, day]) {
      const generator = findRecurringSkipForDate([skip], { dayStart: tuesday, weekStart: sunday });
      expect(generator).toBe(skip);
    }
    // Another day of that week isn't held by the one-day row.
    expect(holdsForCalendarDate([day], noVacation, date("2026-11-25"), sunday)).toEqual([]);
    expect(findRecurringSkipForDate([day], { dayStart: date("2026-11-25"), weekStart: sunday })).toBeUndefined();
  });
  it("counts a linked patient once across profiles and groups each reason's affected dates in order", () => {
    const details = [{ type: "INSTANCE" as const, reason: "Collecting in store" }, { type: "WEEK" as const, reason: "Away" }];
    const result = groupWeeklyHolds([entry({ date: "2026-11-27", recurringOrderId: "second" }), entry({ holdDetails: details }), entry()]);
    expect(result).toHaveLength(1);
    expect(result[0].holds).toEqual([
      { type: "INSTANCE", reason: "Collecting in store", dates: ["2026-11-24", "2026-11-27"] },
      { type: "WEEK", reason: "Away", dates: ["2026-11-24"] },
    ]);
  });
  it("keeps namesakes and unlinked profiles distinct and omits resumed deliveries", () => {
    const records = [
      entry(), entry({ patientId: "patient-2", recurringOrderId: "second", deliveryAddress: "2 Sample Rd" }),
      entry({ patientId: null, recurringOrderId: "legacy", holdReason: "  " }),
      entry({ patientId: null, recurringOrderId: "legacy", date: "2026-11-27", holdReason: null }),
      entry({ patientId: "resumed", isHeld: false }),
    ];
    const result = groupWeeklyHolds(records);
    expect(result).toHaveLength(3);
    expect(result.map((patient) => patient.address)).toContain("2 Sample Rd, Surrey");
    expect(result.find((patient) => patient.id === "profile:legacy")?.holds).toEqual([
      { type: "INSTANCE", reason: null, dates: ["2026-11-24", "2026-11-27"] },
    ]);
    expect(groupWeeklyHolds([])).toEqual([]);
  });
});
