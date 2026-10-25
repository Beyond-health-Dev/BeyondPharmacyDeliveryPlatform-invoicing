import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  defaultDeliveryDateKey,
  deliveryDateDefault,
  deliveryDayRange,
  describeDeliveryDay,
  vancouverTodayKey,
  vancouverWeekRange,
  vancouverWeekStartKey,
} from "@/lib/vancouverDate";

describe("vancouverTodayKey", () => {
  it("stays on Vancouver's date after UTC midnight in summer (PDT, UTC-7)", () => {
    expect(vancouverTodayKey(new Date("2026-07-16T00:30:00Z"))).toBe("2026-07-15");
    expect(vancouverTodayKey(new Date("2026-07-16T07:01:00Z"))).toBe("2026-07-16");
  });

  it("handles the PST offset in winter (UTC-8)", () => {
    expect(vancouverTodayKey(new Date("2026-01-16T07:59:00Z"))).toBe("2026-01-15");
    expect(vancouverTodayKey(new Date("2026-01-16T08:00:00Z"))).toBe("2026-01-16");
  });
});

describe("addDaysToDateKey", () => {
  it("rolls over months and years", () => {
    expect(addDaysToDateKey("2026-10-07", 1)).toBe("2026-10-08");
    expect(addDaysToDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("is unaffected by daylight-saving changes", () => {
    expect(addDaysToDateKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToDateKey("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysToDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToDateKey("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("defaultDeliveryDateKey (orders entered from noon go out tomorrow)", () => {
  // Summer (PDT, UTC-7): noon in Vancouver is 19:00 UTC.
  it("keeps today in the morning", () => {
    expect(defaultDeliveryDateKey(new Date("2026-07-15T15:00:00Z"))).toBe("2026-07-15"); // 08:00
    expect(defaultDeliveryDateKey(new Date("2026-07-15T18:59:59Z"))).toBe("2026-07-15"); // 11:59:59
  });

  it("switches to tomorrow from 12:00 PM", () => {
    expect(defaultDeliveryDateKey(new Date("2026-07-15T19:00:00Z"))).toBe("2026-07-16"); // 12:00
    expect(defaultDeliveryDateKey(new Date("2026-07-15T23:30:00Z"))).toBe("2026-07-16"); // 16:30
  });

  it("uses Vancouver's date, not UTC's, late in the evening", () => {
    // 23:30 PDT on Jul 15 is already Jul 16 in UTC — still delivers Jul 16.
    expect(defaultDeliveryDateKey(new Date("2026-07-16T06:30:00Z"))).toBe("2026-07-16");
    // 00:30 PDT on Jul 16 — a new morning, so Jul 16 itself.
    expect(defaultDeliveryDateKey(new Date("2026-07-16T07:30:00Z"))).toBe("2026-07-16");
  });

  it("handles winter time (PST, UTC-8)", () => {
    expect(defaultDeliveryDateKey(new Date("2026-01-15T19:59:00Z"))).toBe("2026-01-15"); // 11:59
    expect(defaultDeliveryDateKey(new Date("2026-01-15T20:00:00Z"))).toBe("2026-01-16"); // 12:00
  });

  it("rolls over the month and year", () => {
    expect(defaultDeliveryDateKey(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01"); // 1 PM PST
  });

  it("does it on daylight-saving change days too", () => {
    // Nov 1 2026: clocks fall back at 2 AM; noon PST is 20:00 UTC.
    expect(defaultDeliveryDateKey(new Date("2026-11-01T19:59:00Z"))).toBe("2026-11-01");
    expect(defaultDeliveryDateKey(new Date("2026-11-01T20:00:00Z"))).toBe("2026-11-02");
    // Mar 8 2026: clocks spring forward; noon PDT is 19:00 UTC.
    expect(defaultDeliveryDateKey(new Date("2026-03-08T18:59:00Z"))).toBe("2026-03-08");
    expect(defaultDeliveryDateKey(new Date("2026-03-08T19:00:00Z"))).toBe("2026-03-09");
  });
});

describe("describeDeliveryDay", () => {
  const now = new Date("2026-10-07T20:00:00Z"); // Wed Oct 7, 1 PM PDT

  it("says today and tomorrow in Vancouver terms", () => {
    expect(describeDeliveryDay("2026-10-07", now)).toBe("today");
    expect(describeDeliveryDay("2026-10-08", now)).toBe("tomorrow");
  });

  it("names any other day without shifting it a day", () => {
    expect(describeDeliveryDay("2026-10-12", now)).toBe("on Mon, Oct 12");
    expect(describeDeliveryDay("2026-10-06", now)).toBe("on Tue, Oct 6");
  });
});

describe("deliveryDateDefault (handed from the server to the order form)", () => {
  it("flags when the noon rule moved the date", () => {
    expect(deliveryDateDefault(new Date("2026-10-07T18:00:00Z"))).toEqual({ dateKey: "2026-10-07", nextDay: false });
    expect(deliveryDateDefault(new Date("2026-10-07T19:00:00Z"))).toEqual({ dateKey: "2026-10-08", nextDay: true });
  });
});

describe("describeDeliveryDay across a year end", () => {
  it("adds the year only when it differs", () => {
    const newYearsEve = new Date("2026-12-31T20:00:00Z"); // Dec 31, 12 PM PST
    expect(describeDeliveryDay("2027-01-01", newYearsEve)).toBe("tomorrow");
    expect(describeDeliveryDay("2027-01-04", newYearsEve)).toBe("on Mon, Jan 4, 2027");
    expect(describeDeliveryDay("2026-12-28", newYearsEve)).toBe("on Mon, Dec 28");
  });
});

describe("deliveryDayRange (driver delivery list)", () => {
  // 8 PM PDT on Oct 6 — already Oct 7 in UTC, where the server runs.
  const evening = new Date("2026-10-07T03:00:00Z");

  it("keeps Vancouver's today in the evening", () => {
    const range = deliveryDayRange(undefined, evening);
    expect(range.selectedKey).toBe("2026-10-06");
    expect(range.isToday).toBe(true);
    expect(range.dayStart.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(range.nextDayStart.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(range.todayStart.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });

  it("shows a requested day, which isn't today", () => {
    const range = deliveryDayRange("2026-10-07", evening);
    expect(range.selectedKey).toBe("2026-10-07");
    expect(range.isToday).toBe(false);
    expect(range.dayStart.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(range.nextDayStart.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("falls back to today for malformed or impossible dates", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "tomorrow", "2026-1-5", ""]) {
      expect(deliveryDayRange(bad, evening).selectedKey).toBe("2026-10-06");
    }
  });
});

describe("vancouverWeekStartKey (recurring calendar and skips)", () => {
  it("keeps Saturday evening in the current week (PDT)", () => {
    // Sat Oct 24, 5:30 PM and 11 PM PDT. The UTC date is already Sunday the 25th.
    expect(vancouverWeekStartKey(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-18");
    expect(vancouverWeekStartKey(new Date("2026-10-25T06:00:00Z"))).toBe("2026-10-18");
    // Sun Oct 25, 12:30 AM PDT starts the next week.
    expect(vancouverWeekStartKey(new Date("2026-10-25T07:30:00Z"))).toBe("2026-10-25");
  });

  it("keeps Saturday evening in the current week (PST)", () => {
    // Sat Nov 28, 4:30 PM and 11 PM PST; Sun Nov 29, 12:30 AM PST.
    expect(vancouverWeekStartKey(new Date("2026-11-29T00:30:00Z"))).toBe("2026-11-22");
    expect(vancouverWeekStartKey(new Date("2026-11-29T07:00:00Z"))).toBe("2026-11-22");
    expect(vancouverWeekStartKey(new Date("2026-11-29T08:30:00Z"))).toBe("2026-11-29");
  });

  it("turns over at Vancouver midnight on the daylight-saving Sundays", () => {
    // Clocks go back on Sun Nov 1: Sat 11:30 PM PDT, then 1:30 AM PDT and PST.
    expect(vancouverWeekStartKey(new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-25");
    expect(vancouverWeekStartKey(new Date("2026-11-01T08:30:00Z"))).toBe("2026-11-01");
    expect(vancouverWeekStartKey(new Date("2026-11-01T09:30:00Z"))).toBe("2026-11-01");
    // Clocks go forward on Sun Mar 8: Sat 11:30 PM PST, then 3:30 AM PDT.
    expect(vancouverWeekStartKey(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-01");
    expect(vancouverWeekStartKey(new Date("2026-03-08T10:30:00Z"))).toBe("2026-03-08");
  });

  it("handles weekday evenings and a week spanning the new year", () => {
    expect(vancouverWeekStartKey(new Date("2026-10-22T03:00:00Z"))).toBe("2026-10-18"); // Wed 8 PM PDT
    expect(vancouverWeekStartKey(new Date("2027-01-03T07:00:00Z"))).toBe("2026-12-27"); // Sat Jan 2, 11 PM PST
  });
});

describe("vancouverWeekRange", () => {
  it("gives UTC-midnight bounds of the Vancouver week", () => {
    const range = vancouverWeekRange(new Date("2026-10-25T02:00:00Z")); // Sat Oct 24, 7 PM PDT
    expect(range.startKey).toBe("2026-10-18");
    expect(range.weekStart.toISOString()).toBe("2026-10-18T00:00:00.000Z");
    expect(range.weekEnd.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});
