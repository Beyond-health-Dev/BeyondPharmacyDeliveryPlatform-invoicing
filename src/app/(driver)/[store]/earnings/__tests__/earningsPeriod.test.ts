import { describe, expect, it } from "vitest";
import { earningsPeriod } from "../earningsPeriod";

describe("earningsPeriod (driver earnings)", () => {
  it("keeps Saturday evening in this week", () => {
    // Sat Oct 24, 6 PM PDT: UTC is already Sunday the 25th.
    const week = earningsPeriod("week", new Date("2026-10-25T01:00:00Z"));
    expect(week.startKey).toBe("2026-10-18");
    expect(week.endKey).toBe("2026-10-24");
    expect(week.start.toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("starts a new week at Vancouver midnight on Sunday", () => {
    expect(earningsPeriod("week", new Date("2026-10-25T07:30:00Z")).startKey).toBe("2026-10-25"); // Sun 12:30 AM PDT
    expect(earningsPeriod("week", new Date("2026-11-29T00:30:00Z")).startKey).toBe("2026-11-22"); // Sat 4:30 PM PST
  });

  it("keeps a month's last evening in that month", () => {
    const october = earningsPeriod("month", new Date("2026-11-01T01:00:00Z")); // Oct 31, 6 PM PDT
    expect(october).toMatchObject({ startKey: "2026-10-01", endKey: "2026-10-31" });
    const december = earningsPeriod("month", new Date("2027-01-01T02:00:00Z")); // Dec 31, 6 PM PST
    expect(december).toMatchObject({ startKey: "2026-12-01", endKey: "2026-12-31" });
    expect(december.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});
