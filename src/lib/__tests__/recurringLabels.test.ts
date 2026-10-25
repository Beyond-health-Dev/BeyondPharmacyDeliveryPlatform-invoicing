import { describe, expect, it } from "vitest";
import {
  AVERY_5160,
  LABEL_SHEETS,
  allocateLabelSlots,
  countLabelSheetPeople,
  fitLabelLine,
  formatLabelLines,
  formatPostalCode,
  labelBaselines,
  labelCopyCounts,
  labelPageCount,
  labelSheetFileName,
  labelSheetForDays,
  labelSheetTitle,
  labelSlotRect,
  layoutLabelSheet,
  parseLabelSheet,
  profilesForLabelSheet,
  toWinAnsi,
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
