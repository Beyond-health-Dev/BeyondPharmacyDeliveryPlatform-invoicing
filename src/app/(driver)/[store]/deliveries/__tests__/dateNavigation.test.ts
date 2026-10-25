import { describe, expect, it } from "vitest";
import { dateNavigation } from "../dateNavigation";

describe("dateNavigation (driver date bar)", () => {
  it("steps a day either way, across month ends", () => {
    expect(dateNavigation("2026-10-31", "2026-10-31")).toMatchObject({
      prevDate: "2026-10-30",
      nextDate: "2026-11-01",
      isPrevDisabled: false,
      isNextDisabled: false,
    });
  });

  it("allows 30 days back and 7 ahead of Vancouver's today", () => {
    expect(dateNavigation("2026-09-22", "2026-10-21").isPrevDisabled).toBe(false); // prev is 30 days back
    expect(dateNavigation("2026-09-21", "2026-10-21").isPrevDisabled).toBe(true);
    expect(dateNavigation("2026-10-27", "2026-10-21").isNextDisabled).toBe(false); // next is 7 days ahead
    expect(dateNavigation("2026-10-28", "2026-10-21").isNextDisabled).toBe(true);
  });
});
