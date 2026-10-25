import { describe, expect, it } from "vitest";
import {
  formatGenerationMessage,
  getVancouverDeliveryDateInfo,
  hasRecurringSkipForDate,
  isRecurringScheduleDue,
  isVancouverSixAmWindow,
} from "@/lib/cron";
import { vancouverWeekRange } from "@/lib/vancouverDate";

describe("getVancouverDeliveryDateInfo", () => {
  it("keeps Vancouver's date across the UTC midnight boundary", () => {
    // 2026-07-16T00:30Z is still 5:30 PM on Jul 15 in Vancouver (PDT, UTC-7) —
    // the exact boundary where server-UTC 'today' used to roll a day early.
    expect(getVancouverDeliveryDateInfo(new Date("2026-07-16T00:30:00Z")).dateKey).toBe("2026-07-15");
    expect(getVancouverDeliveryDateInfo(new Date("2026-07-15T13:01:00Z")).dateKey).toBe("2026-07-15");
  });

  it("computes UTC-midnight day bounds for the Vancouver date", () => {
    const info = getVancouverDeliveryDateInfo(new Date("2026-07-16T00:30:00Z"));
    expect(info.dayStart.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(info.nextDayStart.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("vancouverWeekRange matches the week the cron generates for", () => {
  // Hourly is enough: Vancouver is always a whole number of hours off UTC, so
  // every Vancouver midnight falls on the hour.
  it("agrees every hour through 2026, DST changes included", () => {
    const end = Date.parse("2027-01-01T00:00:00Z");
    for (let t = Date.parse("2026-01-01T00:00:00Z"); t < end; t += 60 * 60 * 1000) {
      const now = new Date(t);
      const cronWeek = getVancouverDeliveryDateInfo(now);
      const week = vancouverWeekRange(now);
      if (
        week.weekStart.getTime() !== cronWeek.weekStart.getTime() ||
        week.weekEnd.getTime() !== cronWeek.weekEnd.getTime()
      ) {
        throw new Error(`Weeks differ at ${now.toISOString()}`);
      }
    }
  }, 30_000);
});

describe("isVancouverSixAmWindow", () => {
  it("matches only the 6 AM Vancouver hour across DST", () => {
    expect(isVancouverSixAmWindow(new Date("2026-07-15T13:05:00Z"))).toBe(true); // 6:05 AM PDT
    expect(isVancouverSixAmWindow(new Date("2026-07-15T14:05:00Z"))).toBe(false); // 7:05 AM PDT
    expect(isVancouverSixAmWindow(new Date("2026-01-15T14:05:00Z"))).toBe(true); // 6:05 AM PST
  });
});

describe("isRecurringScheduleDue", () => {
  const week = (iso: string) => ({ weekStart: new Date(iso) });

  it("weekly profiles are always due", () => {
    expect(
      isRecurringScheduleDue(
        { recurrenceIntervalWeeks: 1, recurrenceAnchorDate: new Date("2026-01-04T00:00:00Z") },
        week("2026-07-12T00:00:00Z")
      )
    ).toBe(true);
  });

  it("biweekly profiles alternate weeks from the anchor", () => {
    const profile = { recurrenceIntervalWeeks: 2, recurrenceAnchorDate: new Date("2026-07-05T00:00:00Z") };
    expect(isRecurringScheduleDue(profile, week("2026-07-05T00:00:00Z"))).toBe(true);
    expect(isRecurringScheduleDue(profile, week("2026-07-12T00:00:00Z"))).toBe(false);
    expect(isRecurringScheduleDue(profile, week("2026-07-19T00:00:00Z"))).toBe(true);
  });

  it("a future anchor is never due (silent no-generation trap)", () => {
    expect(
      isRecurringScheduleDue(
        { recurrenceIntervalWeeks: 2, recurrenceAnchorDate: new Date("2026-12-06T00:00:00Z") },
        week("2026-07-12T00:00:00Z")
      )
    ).toBe(false);
  });
});

describe("hasRecurringSkipForDate", () => {
  const deliveryDate = {
    dayStart: new Date("2026-07-16T00:00:00Z"),
    weekStart: new Date("2026-07-12T00:00:00Z"),
  };

  it("matches a day-specific skip and a week-level skip", () => {
    expect(hasRecurringSkipForDate([{ skipDate: new Date("2026-07-16T00:00:00Z") }], deliveryDate)).toBe(true);
    expect(hasRecurringSkipForDate([{ skipDate: new Date("2026-07-12T00:00:00Z") }], deliveryDate)).toBe(true);
  });

  it("ignores skips for other days", () => {
    expect(hasRecurringSkipForDate([{ skipDate: new Date("2026-07-15T00:00:00Z") }], deliveryDate)).toBe(false);
    expect(hasRecurringSkipForDate([], deliveryDate)).toBe(false);
  });
});

describe("formatGenerationMessage", () => {
  const base = { dateKey: "2026-07-15", total: 10, due: 5, created: 0, existing: 0, skipped: 0, unprocessed: 0 };

  it("prioritizes the time-limit continuation message", () => {
    expect(formatGenerationMessage({ ...base, created: 3, unprocessed: 7 })).toContain("7 profile(s) remaining");
  });

  it("reports created, already-generated, and idle states", () => {
    expect(formatGenerationMessage({ ...base, created: 2 })).toContain("2 orders generated");
    expect(formatGenerationMessage({ ...base, existing: 4 })).toContain("already been generated");
    expect(formatGenerationMessage(base)).toContain("No recurring orders");
  });
});
