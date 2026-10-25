import { describe, expect, it } from "vitest";
import {
  WEEK_SKIP_REASON,
  findRecurringSkipForDate,
  hasRecurringSkipForDate,
  isVacationHoldActive,
  recurringSkipScope,
} from "@/lib/recurringHolds";

const date = (key: string) => new Date(`${key}T00:00:00.000Z`);
// The week of Sun Oct 18 to Sat Oct 24, 2026.
const day = (key: string) => ({ dayStart: date(key), weekStart: date("2026-10-18") });

describe("recurringSkipScope", () => {
  it("uses the recorded scope", () => {
    expect(recurringSkipScope({ skipDate: date("2026-10-18"), scope: "DAY", reason: WEEK_SKIP_REASON })).toBe("DAY");
    expect(recurringSkipScope({ skipDate: date("2026-10-18"), scope: "WEEK", reason: "Away" })).toBe("WEEK");
  });

  it("reads rows without a scope the way Skip This Week used to save them", () => {
    expect(recurringSkipScope({ skipDate: date("2026-10-18"), scope: null, reason: WEEK_SKIP_REASON })).toBe("WEEK");
    // A one-day hold on a Sunday, or on any other day.
    expect(recurringSkipScope({ skipDate: date("2026-10-18"), scope: null, reason: "In hospital" })).toBe("DAY");
    expect(recurringSkipScope({ skipDate: date("2026-10-21"), scope: null, reason: WEEK_SKIP_REASON })).toBe("DAY");
    expect(recurringSkipScope({ skipDate: date("2026-10-21") })).toBe("DAY");
  });
});

describe("hasRecurringSkipForDate", () => {
  const sundayHold = { skipDate: date("2026-10-18"), scope: "DAY", reason: "In hospital" };
  const weekSkip = { skipDate: date("2026-10-18"), scope: "WEEK", reason: WEEK_SKIP_REASON };
  const wednesdayHold = { skipDate: date("2026-10-21"), scope: "DAY", reason: "Family visiting" };

  it("holds only the Sunday for a one-day Sunday hold", () => {
    expect(hasRecurringSkipForDate([sundayHold], day("2026-10-18"))).toBe(true);
    expect(hasRecurringSkipForDate([sundayHold], day("2026-10-21"))).toBe(false);
  });

  it("holds every day of the week for Skip This Week", () => {
    for (const key of ["2026-10-18", "2026-10-21", "2026-10-24"]) {
      expect(hasRecurringSkipForDate([weekSkip], day(key))).toBe(true);
    }
    // Rows saved before the scope was recorded, too.
    expect(hasRecurringSkipForDate([{ skipDate: date("2026-10-18"), reason: WEEK_SKIP_REASON }], day("2026-10-23"))).toBe(true);
  });

  it("holds a one-day hold's own day only", () => {
    expect(hasRecurringSkipForDate([wednesdayHold], day("2026-10-21"))).toBe(true);
    expect(hasRecurringSkipForDate([wednesdayHold], day("2026-10-22"))).toBe(false);
    expect(hasRecurringSkipForDate([], day("2026-10-21"))).toBe(false);
  });

  it("returns the matching skip so callers can tell the kinds apart", () => {
    expect(findRecurringSkipForDate([sundayHold, wednesdayHold], day("2026-10-21"))).toBe(wednesdayHold);
    expect(findRecurringSkipForDate([weekSkip], day("2026-10-22"))).toBe(weekSkip);
  });
});

describe("isVacationHoldActive", () => {
  const hold = { isOnHold: true, holdStart: date("2026-10-30"), holdEnd: date("2026-11-08") };

  it("covers the hold's days, both ends included", () => {
    expect(isVacationHoldActive(hold, date("2026-10-29"))).toBe(false);
    expect(isVacationHoldActive(hold, date("2026-10-30"))).toBe(true);
    expect(isVacationHoldActive(hold, date("2026-11-03"))).toBe(true);
    expect(isVacationHoldActive(hold, date("2026-11-08"))).toBe(true);
    expect(isVacationHoldActive(hold, date("2026-11-09"))).toBe(false);
  });

  it("covers a one-day hold's day", () => {
    const oneDay = { isOnHold: true, holdStart: date("2026-10-30"), holdEnd: date("2026-10-30") };
    expect(isVacationHoldActive(oneDay, date("2026-10-30"))).toBe(true);
    expect(isVacationHoldActive(oneDay, date("2026-10-31"))).toBe(false);
  });

  it("treats a hold without dates as ongoing, and no hold as none", () => {
    expect(isVacationHoldActive({ isOnHold: true, holdStart: null, holdEnd: null }, date("2026-10-30"))).toBe(true);
    expect(isVacationHoldActive({ ...hold, isOnHold: false }, date("2026-11-03"))).toBe(false);
  });
});
