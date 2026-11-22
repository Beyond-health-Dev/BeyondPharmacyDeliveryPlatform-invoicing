import { describe, expect, it } from "vitest";
import {
  AVERY_5160,
  LABEL_SHEETS,
  allocateLabelSlots,
  countLabelSheetPeople,
  draftLabelSheetChange,
  draftLabelSheets,
  fitLabelLine,
  formatLabelLines,
  formatPostalCode,
  isDraftLabelSheetMoved,
  isLabelSheetChanged,
  isLabelSheetMoved,
  labelBaselines,
  labelCopyCounts,
  labelPageCount,
  labelSheetAssignments,
  labelSheetChange,
  labelSheetChoice,
  labelSheetFileName,
  labelSheetForDays,
  labelSheetShortTitle,
  labelSheetsForProfile,
  labelSheetTitle,
  labelSlotRect,
  layoutLabelSheet,
  matchesLabelSearch,
  parseLabelSheet,
  parseLabelSheets,
  profilesForLabelSheet,
  resetDraftLabelSheets,
  setDraftLabelSheets,
  toWinAnsi,
  toggleDraftLabelSheet,
  type LabelSheetDraft,
  type LabelSheetProfile,
  type MeasureLabelText,
} from "@/lib/recurringLabels";

// Every character 0.01" wide per point of font size: easy to reason about.
const fakeMeasure: MeasureLabelText = (text, size) => text.length * size * 0.01;

function profile(
  id: string,
  patientName: string,
  activeDays: unknown,
  extra: Partial<LabelSheetProfile> = {}
): LabelSheetProfile {
  return { id, patientName, deliveryAddress: "14250 88 Ave", deliveryCity: "Surrey", activeDays, ...extra };
}

describe("label sheets", () => {
  it("names, parses and files each sheet", () => {
    expect(LABEL_SHEETS).toEqual([
      "daily",
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]);
    expect(labelSheetTitle("daily")).toBe("Daily Deliveries");
    expect(labelSheetTitle("monday")).toBe("Monday");
    expect(parseLabelSheet(" Monday ")).toBe("monday");
    expect(parseLabelSheet("daily")).toBe("daily");
    expect(parseLabelSheet("1")).toBeNull();
    expect(parseLabelSheet("funday")).toBeNull();
    expect(parseLabelSheet(null)).toBeNull();
    expect(labelSheetFileName("surrey", "tuesday")).toBe("labels-surrey-tuesday.pdf");
  });

  it("puts two or more weekdays on the daily sheet and one weekday on its own day", () => {
    expect(labelSheetForDays([1, 3, 5])).toBe("daily");
    expect(labelSheetForDays([0, 6])).toBe("daily");
    expect(labelSheetForDays([2])).toBe("tuesday");
    expect(labelSheetForDays("[0]")).toBe("sunday");
    expect(labelSheetForDays([3, 3])).toBe("wednesday");
  });

  it("puts profiles with no valid days on no sheet", () => {
    for (const days of [[], "bad", [9], null, "[1.5]"]) {
      expect(labelSheetForDays(days)).toBeNull();
    }
  });
});

describe("profilesForLabelSheet", () => {
  const profiles = [
    profile("p1", "Riley Chen", [1, 3, 5]),
    profile("p2", "avery sandhu", [2]),
    profile("p3", "Morgan Patel", [2], { isActive: false }),
    profile("p4", "Avery Sandhu", [2], { deliveryAddress: "100 Main St" }),
    profile("p5", "Casey Brar", [2, 4]),
    profile("p6", "Jordan Kaur", [2]),
  ];

  it("keeps multi-day profiles off the day sheets and inactive ones off every sheet", () => {
    expect(profilesForLabelSheet(profiles, "daily").map((p) => p.id)).toEqual(["p5", "p1"]);
    expect(profilesForLabelSheet(profiles, "tuesday").map((p) => p.id)).toEqual(["p4", "p2", "p6"]);
    expect(profilesForLabelSheet(profiles, "monday")).toEqual([]);
  });

  it("prints on-hold profiles (labels are presets)", () => {
    const held = [profile("h1", "Sam Gill", [1], { isActive: true }), { ...profile("h2", "Drew Sidhu", [1]), isOnHold: true }];
    expect(profilesForLabelSheet(held, "monday")).toHaveLength(2);
  });

  it("sorts by name ignoring case, then address, then id — whatever the input order", () => {
    const forward = profilesForLabelSheet(profiles, "tuesday").map((p) => p.id);
    const reversed = profilesForLabelSheet([...profiles].reverse(), "tuesday").map((p) => p.id);
    expect(reversed).toEqual(forward);
    const twins = [profile("b", "Sam Gill", [1]), profile("a", "Sam Gill", [1])];
    expect(profilesForLabelSheet(twins, "monday").map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("counts the same people the sheets print, for every sheet", () => {
    // Shaped like the Surrey store: 23 multi-day people; 11/15/10/13/16 Mon-Fri.
    const list: LabelSheetProfile[] = [];
    for (let i = 0; i < 23; i++) list.push(profile(`m${i}`, `Daily ${i}`, i % 2 ? [1, 3, 5] : [0, 2, 4, 6]));
    const perDay: Record<number, number> = { 1: 11, 2: 15, 3: 10, 4: 13, 5: 16 };
    for (const [day, n] of Object.entries(perDay)) {
      for (let i = 0; i < n; i++) list.push(profile(`d${day}-${i}`, `Weekly ${day} ${i}`, [Number(day)]));
    }
    list.push(profile("gone", "Inactive Person", [1], { isActive: false }));

    const counts = countLabelSheetPeople(list);
    expect(counts).toEqual({
      daily: 23,
      sunday: 0,
      monday: 11,
      tuesday: 15,
      wednesday: 10,
      thursday: 13,
      friday: 16,
      saturday: 0,
    });
    for (const sheet of LABEL_SHEETS) {
      expect(counts[sheet]).toBe(profilesForLabelSheet(list, sheet).length);
    }
  });
});

describe("sheets chosen by staff", () => {
  it("reads a stored or sent choice in sheet order, without repeats", () => {
    expect(parseLabelSheets('["thursday","monday"]')).toEqual(["monday", "thursday"]);
    expect(parseLabelSheets(["saturday", "daily", "saturday", "sunday"])).toEqual(["daily", "sunday", "saturday"]);
    expect(parseLabelSheets(["friday"])).toEqual(["friday"]);
  });

  it("treats empty, unreadable or unknown values as automatic (null)", () => {
    for (const value of [
      null,
      undefined,
      "",
      "[]",
      [],
      "not json",
      '["monday"',
      '"monday"',
      "monday",
      '{"0":"monday"}',
      { sheets: ["monday"] },
      42,
      // One unknown entry spoils the lot: names must match exactly.
      ["monday", "funday"],
      '["monday","Monday"]',
      [" monday"],
      ["monday", 1],
      ["monday", null],
    ]) {
      expect(parseLabelSheets(value)).toBeNull();
    }
  });

  it("stores nothing when the choice is just the sheet the days give", () => {
    expect(labelSheetChoice(["monday"], [1])).toBeNull();
    expect(labelSheetChoice(["daily"], "[1,3,5]")).toBeNull();
    expect(labelSheetChoice(["monday"], [1, 3, 5])).toEqual(["monday"]);
    expect(labelSheetChoice(["monday", "daily"], [1, 3])).toEqual(["daily", "monday"]);
    expect(labelSheetChoice(null, [1])).toBeNull();
  });

  it("gives short pill names and full titles", () => {
    expect(LABEL_SHEETS.map(labelSheetShortTitle)).toEqual(["Daily", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(labelSheetTitle("thursday")).toBe("Thursday");
  });

  it("moves a person off their automatic sheet and onto the chosen one", () => {
    const list = [
      profile("p1", "Avery Sandhu", [1], { labelSheets: '["friday"]' }),
      profile("p2", "Jordan Kaur", [1]),
    ];
    expect(labelSheetsForProfile(list[0])).toEqual(["friday"]);
    expect(isLabelSheetMoved(list[0])).toBe(true);
    expect(isLabelSheetMoved(list[1])).toBe(false);
    expect(profilesForLabelSheet(list, "monday").map((p) => p.id)).toEqual(["p2"]);
    expect(profilesForLabelSheet(list, "friday").map((p) => p.id)).toEqual(["p1"]);
    expect(countLabelSheetPeople(list)).toMatchObject({ monday: 1, friday: 1, daily: 0 });
  });

  it("puts one person on several sheets, each printing their own copies", () => {
    const list = [
      profile("p1", "Avery Sandhu", [2, 4], { labelSheets: ["tuesday", "thursday"] }),
      profile("p2", "Jordan Kaur", [2]),
    ];
    expect(profilesForLabelSheet(list, "daily")).toEqual([]);
    expect(profilesForLabelSheet(list, "tuesday").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(profilesForLabelSheet(list, "thursday").map((p) => p.id)).toEqual(["p1"]);
    // Copies are worked out per sheet: 15 each on Tuesday, all 30 on Thursday.
    expect(labelCopyCounts(profilesForLabelSheet(list, "tuesday").length)).toEqual(Array(2).fill(15));
    expect(labelCopyCounts(profilesForLabelSheet(list, "thursday").length)).toEqual([30]);
  });

  it("falls back to the automatic sheet when the stored value is unreadable", () => {
    for (const labelSheets of ["not json", "[]", '["funday"]', null, undefined]) {
      const p = profile("p1", "Avery Sandhu", [1], { labelSheets });
      expect(labelSheetsForProfile(p)).toEqual(["monday"]);
      expect(isLabelSheetMoved(p)).toBe(false);
    }
  });

  it("puts a profile with no valid delivery days on no sheet, whatever is stored", () => {
    const p = profile("p1", "Avery Sandhu", "bad", { labelSheets: '["monday"]' });
    expect(labelSheetsForProfile(p)).toEqual([]);
    expect(isLabelSheetMoved(p)).toBe(false);
    expect(LABEL_SHEETS.every((sheet) => profilesForLabelSheet([p], sheet).length === 0)).toBe(true);
    expect(Object.values(countLabelSheetPeople([p])).every((n) => n === 0)).toBe(true);
  });

  it("doesn't count a stored choice that has become the automatic sheet as moved", () => {
    // Moved to Tuesday, then the delivery day was edited to Tuesday too.
    const p = profile("p1", "Avery Sandhu", [2], { labelSheets: '["tuesday"]' });
    expect(labelSheetsForProfile(p)).toEqual(["tuesday"]);
    expect(isLabelSheetMoved(p)).toBe(false);
  });

  it("tells a person moved off their usual sheet from one given an extra sheet", () => {
    const cases: Array<[unknown, unknown, ReturnType<typeof labelSheetChange>]> = [
      // Off the usual sheet: moved, whether to one sheet or several.
      [[5], '["monday"]', "moved"],
      [[5], ["monday", "tuesday"], "moved"],
      [[1, 3], ["wednesday"], "moved"],
      // Still on the usual sheet, plus others: an extra sheet.
      [[5], ["monday", "friday"], "extra"],
      [[1, 3], '["daily","saturday"]', "extra"],
      // Just the usual sheet, nothing stored, unreadable, or no valid days.
      [[5], ["friday"], null],
      [[1, 3], ["daily"], null],
      [[5], null, null],
      [[5], "oops", null],
      ["bad", ["monday"], null],
    ];
    for (const [activeDays, labelSheets, change] of cases) {
      const p = profile("p1", "Avery Sandhu", activeDays, { labelSheets });
      expect(labelSheetChange(p)).toBe(change);
      // Moved and extra both differ from automatic.
      expect(isLabelSheetMoved(p)).toBe(change !== null);
    }
  });

  it("keeps the sheet's print order, whoever was moved onto it", () => {
    const list = [
      profile("p1", "Riley Chen", [2]),
      profile("p2", "avery sandhu", [5], { labelSheets: ["tuesday"] }),
      profile("p3", "Casey Brar", [1, 3], { labelSheets: ["daily", "tuesday"] }),
      profile("p4", "Avery Sandhu", [2], { deliveryAddress: "100 Main St" }),
    ];
    const order = profilesForLabelSheet(list, "tuesday").map((p) => p.id);
    expect(order).toEqual(["p4", "p2", "p3", "p1"]);
    expect(profilesForLabelSheet([...list].reverse(), "tuesday").map((p) => p.id)).toEqual(order);
  });

  it("counts the same people the sheets print, with moved people mixed in", () => {
    // The Surrey-shaped list from above, then staff rearrangements on top.
    const list: LabelSheetProfile[] = [];
    for (let i = 0; i < 23; i++) list.push(profile(`m${i}`, `Daily ${i}`, i % 2 ? [1, 3, 5] : [0, 2, 4, 6]));
    const perDay: Record<number, number> = { 1: 11, 2: 15, 3: 10, 4: 13, 5: 16 };
    for (const [day, n] of Object.entries(perDay)) {
      for (let i = 0; i < n; i++) list.push(profile(`d${day}-${i}`, `Weekly ${day} ${i}`, [Number(day)]));
    }
    list.push(profile("gone", "Inactive Person", [1], { isActive: false, labelSheets: '["saturday"]' }));
    list.push(profile("x1", "Moved Daily", [1, 3], { labelSheets: '["wednesday"]' }));
    list.push(profile("x2", "Two Sheets", [4], { labelSheets: ["daily", "thursday"] }));
    list.push(profile("x3", "Three Sheets", [0, 6], { labelSheets: '["sunday","saturday","daily"]' }));
    list.push(profile("x4", "Bad Value", [5], { labelSheets: "oops" }));
    list.push(profile("x5", "Bad Days", "[]", { labelSheets: '["monday"]' }));
    list.push(profile("x6", "Weekly Moved", [2], { labelSheets: ["sunday"] }));

    const counts = countLabelSheetPeople(list);
    expect(counts).toEqual({
      daily: 23 + 2,
      sunday: 1 + 1,
      monday: 11,
      tuesday: 15,
      wednesday: 10 + 1,
      thursday: 13 + 1,
      friday: 16 + 1,
      saturday: 1,
    });
    for (const sheet of LABEL_SHEETS) {
      expect(counts[sheet]).toBe(profilesForLabelSheet(list, sheet).length);
    }
  });
});

describe("rearranging (the panel's draft)", () => {
  const empty: LabelSheetDraft = new Map();
  const weekly = profile("w", "Sam Gill", [1]);
  const daily = profile("d", "Riley Chen", [1, 3, 5]);
  const moved = profile("m", "Jamie Thompson", [5], { labelSheets: ["monday"] });

  it("moves a single-day person: add the new sheet, then drop the old one", () => {
    // The only sheet can't be cleared: the person keeps at least one.
    expect(toggleDraftLabelSheet(empty, weekly, "monday")).toBeNull();

    const both = toggleDraftLabelSheet(empty, weekly, "thursday")!;
    expect(draftLabelSheets(both, weekly)).toEqual(["monday", "thursday"]);
    expect(isLabelSheetChanged(both, "w")).toBe(true);
    expect(isDraftLabelSheetMoved(both, weekly)).toBe(true);

    const thursday = toggleDraftLabelSheet(both, weekly, "monday")!;
    expect(draftLabelSheets(thursday, weekly)).toEqual(["thursday"]);
    expect(toggleDraftLabelSheet(thursday, weekly, "thursday")).toBeNull();
    expect(labelSheetAssignments(thursday)).toEqual([{ id: "w", sheets: ["thursday"] }]);
  });

  it("drops a row from the draft once it is back to what is saved", () => {
    const changed = toggleDraftLabelSheet(empty, daily, "friday")!;
    expect(changed.size).toBe(1);
    const back = toggleDraftLabelSheet(changed, daily, "friday")!;
    expect(back.size).toBe(0);
    expect(isLabelSheetChanged(back, "d")).toBe(false);
    expect(draftLabelSheets(back, daily)).toEqual(["daily"]);
    expect(labelSheetAssignments(back)).toEqual([]);
  });

  it("leaves the draft it was given alone", () => {
    const changed = toggleDraftLabelSheet(empty, daily, "friday")!;
    expect(empty.size).toBe(0);
    expect(changed).not.toBe(empty);
  });

  it("resets a saved move to automatic, sending null", () => {
    expect(draftLabelSheets(empty, moved)).toEqual(["monday"]);
    expect(isDraftLabelSheetMoved(empty, moved)).toBe(true);
    expect(isLabelSheetChanged(empty, "m")).toBe(false);

    const reset = resetDraftLabelSheets(empty, moved);
    expect(draftLabelSheets(reset, moved)).toEqual(["friday"]);
    expect(isDraftLabelSheetMoved(reset, moved)).toBe(false);
    expect(isLabelSheetChanged(reset, "m")).toBe(true);
    expect(labelSheetAssignments(reset)).toEqual([{ id: "m", sheets: null }]);

    // Resetting a person who isn't moved changes nothing.
    expect(resetDraftLabelSheets(empty, weekly).size).toBe(0);
  });

  it("sends null when the chosen sheets come back to just the automatic one", () => {
    // Saved on Monday; staff pick Friday (the delivery day) by hand.
    const both = toggleDraftLabelSheet(empty, moved, "friday")!;
    const friday = toggleDraftLabelSheet(both, moved, "monday")!;
    expect(draftLabelSheets(friday, moved)).toEqual(["friday"]);
    expect(isDraftLabelSheetMoved(friday, moved)).toBe(false);
    expect(labelSheetAssignments(friday)).toEqual([{ id: "m", sheets: null }]);
    expect(setDraftLabelSheets(empty, moved, ["friday"])).toEqual(friday);
  });

  it("builds one assignment per changed person, sheets in order", () => {
    let draft = toggleDraftLabelSheet(empty, weekly, "saturday")!;
    draft = toggleDraftLabelSheet(draft, weekly, "daily")!;
    draft = resetDraftLabelSheets(draft, moved);
    draft = toggleDraftLabelSheet(draft, daily, "tuesday")!;
    expect(labelSheetAssignments(draft)).toEqual([
      { id: "w", sheets: ["daily", "monday", "saturday"] },
      { id: "m", sheets: null },
      { id: "d", sheets: ["daily", "tuesday"] },
    ]);
  });

  it("sends nothing when a moved person is moved away and back", () => {
    // Saved on Monday (their days give Friday): over to Tuesday, then back.
    let draft = toggleDraftLabelSheet(empty, moved, "tuesday")!;
    draft = toggleDraftLabelSheet(draft, moved, "monday")!;
    expect(draftLabelSheets(draft, moved)).toEqual(["tuesday"]);
    expect(draft.size).toBe(1);
    draft = toggleDraftLabelSheet(draft, moved, "monday")!;
    draft = toggleDraftLabelSheet(draft, moved, "tuesday")!;
    expect(draftLabelSheets(draft, moved)).toEqual(["monday"]);
    expect(draft.size).toBe(0);
    expect(isLabelSheetChanged(draft, "m")).toBe(false);
    expect(labelSheetAssignments(draft)).toEqual([]);
  });

  it("tags a row Moved or Extra sheet, as saved and in the draft", () => {
    // Adding a sheet keeps the usual one: an extra sheet, not a move.
    const added = toggleDraftLabelSheet(empty, weekly, "thursday")!;
    expect(draftLabelSheetChange(empty, weekly)).toBeNull();
    expect(draftLabelSheetChange(added, weekly)).toBe("extra");
    // Dropping the usual sheet makes it a move.
    const off = toggleDraftLabelSheet(added, weekly, "monday")!;
    expect(draftLabelSheetChange(off, weekly)).toBe("moved");

    expect(draftLabelSheetChange(empty, moved)).toBe("moved");
    const withFriday = toggleDraftLabelSheet(empty, moved, "friday")!;
    expect(draftLabelSheetChange(withFriday, moved)).toBe("extra");
    expect(draftLabelSheetChange(resetDraftLabelSheets(empty, moved), moved)).toBeNull();
  });

  it("compares with the saved choice as it would be stored", () => {
    // Stored Tuesday on a Tuesday person: the same as automatic.
    const pinned = profile("p", "Drew Sidhu", [2], { labelSheets: ["tuesday"] });
    expect(resetDraftLabelSheets(empty, pinned).size).toBe(0);
    const both = toggleDraftLabelSheet(empty, pinned, "wednesday")!;
    expect(toggleDraftLabelSheet(both, pinned, "wednesday")!.size).toBe(0);
  });
});

describe("searching the panel", () => {
  const empty: LabelSheetDraft = new Map();
  const people = [
    profile("w", "Sam Gill", [1], { deliveryAddress: "5501 204 St", deliveryCity: "Langley" }),
    profile("d", "Riley Chen", [1, 3, 5]),
    profile("m", "Jamie Thompson", [5], { labelSheets: ["monday"] }),
    profile("x", "Casey Brar", [2], { labelSheets: ["daily", "tuesday"] }),
  ];
  const find = (query: string, draft: LabelSheetDraft = empty) =>
    people.filter((p) => matchesLabelSearch(draft, p, query)).map((p) => p.id);

  it("matches everyone on an empty search", () => {
    expect(find("")).toEqual(["w", "d", "m", "x"]);
    expect(find("   ")).toEqual(["w", "d", "m", "x"]);
  });

  it("matches name, address and city, ignoring case and spaces around", () => {
    expect(find("riley")).toEqual(["d"]);
    expect(find(" 204 st ")).toEqual(["w"]);
    expect(find("LANGLEY")).toEqual(["w"]);
    expect(find("surrey")).toEqual(["d", "m", "x"]);
    expect(find("nobody")).toEqual([]);
  });

  it("matches the sheets a person is on", () => {
    expect(find("monday")).toEqual(["w", "m"]);
    expect(find("Mon")).toEqual(["w", "m"]);
    expect(find("daily")).toEqual(["d", "x"]);
    expect(find("tuesday")).toEqual(["x"]);
    // Their delivery day alone doesn't count once they are moved off it.
    expect(find("friday")).toEqual([]);
  });

  it("keeps a row being changed in the list, and finds where it is going", () => {
    const sam = people[0];
    const moving = toggleDraftLabelSheet(toggleDraftLabelSheet(empty, sam, "saturday")!, sam, "monday")!;
    expect(draftLabelSheets(moving, sam)).toEqual(["saturday"]);
    expect(find("monday", moving)).toEqual(["w", "m"]);
    expect(find("saturday", moving)).toEqual(["w"]);
  });
});

describe("filling whole pages", () => {
  it("gives nobody labels when the sheet is empty", () => {
    expect(labelCopyCounts(0)).toEqual([]);
    expect(allocateLabelSlots([])).toEqual([]);
    expect(labelPageCount(0)).toBe(0);
  });

  it("11 people: the first 8 get 3, the last 3 get 2, grouped", () => {
    expect(labelCopyCounts(11)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2]);
    const slots = allocateLabelSlots("ABCDEFGHIJK".split(""));
    expect(slots.join("")).toBe("AAABBBCCCDDDEEEFFFGGGHHHIIJJKK");
  });

  it("splits evenly when it can", () => {
    expect(labelCopyCounts(15)).toEqual(Array(15).fill(2));
    expect(labelCopyCounts(30)).toEqual(Array(30).fill(1));
    expect(labelCopyCounts(1)).toEqual([30]);
  });

  it("23 people: 7 get 2, 16 get 1", () => {
    const counts = labelCopyCounts(23);
    expect(counts.filter((c) => c === 2)).toHaveLength(7);
    expect(counts.slice(0, 7)).toEqual(Array(7).fill(2));
    expect(counts.slice(7)).toEqual(Array(16).fill(1));
  });

  it("31 people fill two pages: 29 get 2, 2 get 1", () => {
    const counts = labelCopyCounts(31);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(60);
    expect(counts.slice(0, 29)).toEqual(Array(29).fill(2));
    expect(counts.slice(29)).toEqual([1, 1]);
    expect(labelPageCount(31)).toBe(2);
  });

  it("always fills whole pages, evenly, with each person's copies together", () => {
    for (let n = 1; n <= 95; n++) {
      const counts = labelCopyCounts(n);
      const total = counts.reduce((a, b) => a + b, 0);
      expect(total).toBe(30 * Math.ceil(n / 30));
      const base = Math.floor(total / n);
      expect(counts.every((c) => c === base || c === base + 1)).toBe(true);
      expect(counts.every((c, i) => i === 0 || c <= counts[i - 1])).toBe(true);

      const slots = allocateLabelSlots(Array.from({ length: n }, (_, i) => i));
      expect(slots).toHaveLength(total);
      // Contiguous groups in order: the person number never goes back down.
      expect(slots.every((p, i) => i === 0 || p >= slots[i - 1])).toBe(true);
    }
  });
});

describe("Avery 5160 geometry", () => {
  it("places the corners of the sheet", () => {
    const first = labelSlotRect(0);
    expect(first).toMatchObject({ page: 0, row: 0, column: 0 });
    expect(first.x).toBeCloseTo(0.1875);
    expect(first.y).toBeCloseTo(0.5);
    expect(first.width).toBeCloseTo(2.625);
    expect(first.height).toBeCloseTo(1);

    const topRight = labelSlotRect(2);
    expect(topRight.x).toBeCloseTo(5.6875);
    expect(topRight.x + topRight.width).toBeCloseTo(8.3125);

    const secondRow = labelSlotRect(3);
    expect(secondRow.x).toBeCloseTo(0.1875);
    expect(secondRow.y).toBeCloseTo(1.5);

    const last = labelSlotRect(29);
    expect(last).toMatchObject({ page: 0, row: 9, column: 2 });
    expect(last.x).toBeCloseTo(5.6875);
    expect(last.y + last.height).toBeCloseTo(10.5);

    const nextPage = labelSlotRect(30);
    expect(nextPage).toMatchObject({ page: 1, row: 0, column: 0 });
    expect(nextPage.y).toBeCloseTo(0.5);
  });

  it("keeps the side margins symmetric", () => {
    const right = AVERY_5160.pageWidth - (labelSlotRect(2).x + AVERY_5160.labelWidth);
    expect(right).toBeCloseTo(AVERY_5160.marginLeft);
  });
});

describe("label text", () => {
  it("formats name, street and city line", () => {
    expect(
      formatLabelLines({
        patientName: "Avery Sandhu",
        deliveryAddress: "14250 88 Ave",
        deliveryCity: "Surrey",
        deliveryPostalCode: "V3W 3L5",
      })
    ).toEqual(["Avery Sandhu", "14250 88 Ave", "Surrey, BC  V3W 3L5"]);
  });

  it("tidies postal codes, spacing and a city that already says BC", () => {
    expect(formatPostalCode("v3w3l5")).toBe("V3W 3L5");
    expect(formatPostalCode(" v3w 3l5 ")).toBe("V3W 3L5");
    expect(formatPostalCode("12345")).toBe("12345");
    // Pasted with a zero-width space, or in full-width letters.
    expect(formatPostalCode(`V3W${String.fromCharCode(0x200b)}3L5`)).toBe("V3W 3L5");
    expect(formatPostalCode("\uff36\uff13\uff37\uff13\uff2c\uff15")).toBe("V3W 3L5");
    expect(
      formatLabelLines({
        patientName: "  Jordan\n Kaur ",
        deliveryAddress: "6620  King George Blvd",
        deliveryCity: "Surrey, BC",
        deliveryPostalCode: "v3w3l5",
      })
    ).toEqual(["Jordan Kaur", "6620 King George Blvd", "Surrey, BC  V3W 3L5"]);
    expect(
      formatLabelLines({ patientName: "A", deliveryAddress: "B", deliveryCity: "Langley B.C.", deliveryPostalCode: "" })[2]
    ).toBe("Langley, BC");
    expect(
      formatLabelLines({ patientName: "A", deliveryAddress: "B", deliveryCity: "", deliveryPostalCode: "V3W 3L5" })[2]
    ).toBe("BC  V3W 3L5");
  });

  it("keeps only characters the PDF font can draw", () => {
    expect(toWinAnsi("Zoë Côté")).toBe("Zoë Côté");
    expect(toWinAnsi("O’Brien – Unit 4")).toBe("O’Brien – Unit 4");
    expect(toWinAnsi(String.fromCharCode(0x0141) + "ukasz")).toBe("Lukasz");
    expect(toWinAnsi("Erd" + String.fromCharCode(0x0151) + "s")).toBe("Erdos");
    expect(toWinAnsi(String.fromCharCode(0x0a38) + "x")).toBe("?x");
  });

  it("drops invisible characters and stray accents instead of printing ?", () => {
    const char = String.fromCharCode;
    // Zero-width space, soft hyphen, left-to-right mark, word joiner.
    expect(toWinAnsi(`Jo${char(0x200b)}hn ${char(0xad)}Smith ${char(0x200e)}Ali${char(0x2060)}`)).toBe("John Smith Ali");
    // An accent with nothing to sit on (q + combining tilde) and a decomposed é.
    expect(toWinAnsi(`q${char(0x303)}`)).toBe("q");
    expect(toWinAnsi(`Rene${char(0x301)}e`)).toBe("Renée");
    // Ligatures and full-width letters fold to plain letters.
    expect(toWinAnsi(`Gri${char(0xfb03)}n`)).toBe("Griffin");
    expect(toWinAnsi(`${char(0xff21)}${char(0xff42)}`)).toBe("Ab");
    // A trailing direction mark doesn't leave a trailing space on the label.
    expect(
      formatLabelLines({
        patientName: `John Smith ${char(0x200f)}`,
        deliveryAddress: `123 Main St${char(0x200b)}`,
        deliveryCity: "Surrey",
        deliveryPostalCode: "V3W 3L5",
      }).slice(0, 2)
    ).toEqual(["John Smith", "123 Main St"]);
  });
});

describe("fitLabelLine", () => {
  const opts = { maxWidth: 2, maxSize: 10, minSize: 7, bold: true };

  it("uses the largest size that fits", () => {
    expect(fitLabelLine("x".repeat(20), fakeMeasure, opts)).toEqual({ text: "x".repeat(20), fontSize: 10, bold: true });
    expect(fitLabelLine("x".repeat(25), fakeMeasure, opts).fontSize).toBe(8);
    expect(fitLabelLine("x".repeat(27), fakeMeasure, opts).fontSize).toBe(7);
  });

  it("cuts a line that can't fit even at the smallest size", () => {
    const fitted = fitLabelLine("x".repeat(40), fakeMeasure, opts);
    expect(fitted.fontSize).toBe(7);
    expect(fitted.text).toBe("x".repeat(25) + "...");
    expect(fakeMeasure(fitted.text, 7, true)).toBeLessThanOrEqual(2);
  });

  it("drops trailing spaces and commas before the ellipsis", () => {
    const fitted = fitLabelLine("x".repeat(24) + ", yyyyyyyy", fakeMeasure, opts);
    expect(fitted.text).toBe("x".repeat(24) + "...");
  });

  it("leaves empty text empty", () => {
    expect(fitLabelLine("", fakeMeasure, opts).text).toBe("");
  });
});

describe("layout", () => {
  it("centres the lines vertically", () => {
    const [b0, b1, b2] = labelBaselines([10, 9, 9], 0.5, 1);
    const top = b0 - (0.718 * 10) / 72;
    const bottom = b2 + (0.207 * 9) / 72;
    expect(top - 0.5).toBeCloseTo(1.5 - bottom, 9);
    expect(b1 - b0).toBeCloseTo((1.2 * 9) / 72, 9);
  });

  it("keeps every line inside its label, with copies grouped per person", () => {
    const people = Array.from({ length: 11 }, (_, i) => ({
      patientName: `Person ${String.fromCharCode(65 + i)} With A Fairly Long Name`,
      deliveryAddress: "10153 King George Boulevard West",
      deliveryCity: "Port Coquitlam",
      deliveryPostalCode: "V3W3L5",
    }));
    const { pageCount, labels } = layoutLabelSheet(people, fakeMeasure);
    expect(pageCount).toBe(1);
    expect(labels).toHaveLength(30);
    expect(labels.map((l) => l.personIndex)).toEqual(allocateLabelSlots(people.map((_, i) => i)));

    for (const label of labels) {
      expect(label.lines).toHaveLength(3);
      const { x, y, width, height } = label.rect;
      for (const line of label.lines) {
        expect(line.x).toBeCloseTo(x + AVERY_5160.insetX, 9);
        expect(line.x + fakeMeasure(line.text, line.fontSize, line.bold)).toBeLessThanOrEqual(
          x + width - AVERY_5160.insetX + 1e-9
        );
        expect(line.baseline - (0.718 * line.fontSize) / 72).toBeGreaterThanOrEqual(y);
        expect(line.baseline + (0.207 * line.fontSize) / 72).toBeLessThanOrEqual(y + height);
      }
      expect(label.lines[0].bold).toBe(true);
      expect(label.lines[2].text).toMatch(/, BC {2}V3W 3L5$/);
    }
  });

  it("lays out nothing for an empty sheet", () => {
    expect(layoutLabelSheet([], fakeMeasure)).toEqual({ pageCount: 0, labels: [] });
  });
});
