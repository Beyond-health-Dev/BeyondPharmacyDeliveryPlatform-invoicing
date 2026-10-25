import jsPDF from "jspdf";
import { describe, expect, it } from "vitest";
import { AVERY_5160, layoutLabelSheet, type LabelAddressInput } from "@/lib/recurringLabels";
import { buildLabelSheetDoc, labelTextMeasure, renderLabelSheetPdf } from "@/lib/recurringLabelsPdf";

// The longest values in the live data (32-character name, 31-character street,
// 16-character city), in capitals — the widest they can get.
const widest: LabelAddressInput = {
  patientName: "WWWWWWWWWWWWWWW MMMMMMMMMMMMMMMM",
  deliveryAddress: "10153 KING GEORGE BOULEVARD WWW",
  deliveryCity: "MMMMMMMMMMMMMMMM",
  deliveryPostalCode: "V3W 3L5",
};

function people(n: number): LabelAddressInput[] {
  return Array.from({ length: n }, (_, i) => ({
    patientName: `Person ${i + 1}`,
    deliveryAddress: `${100 + i} Main St`,
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W3L5",
  }));
}

// Names whose letter pairs Helvetica kerns tightly (AV, TA, WA, YA...): kerned
// measuring makes them look narrower than they print.
const kerned: LabelAddressInput = {
  patientName: "TATYANA WYATT YATES-LOVATO",
  deliveryAddress: "AVAVAVAVAVAVAVAVAVAVAVAVAVAVAVAVAVAVAVAV",
  deliveryCity: "WAYNE TAYLOR-LAWTON AVERY",
  deliveryPostalCode: "V3W 3L5",
};

// Letters missing from jsPDF's width table, which Helvetica draws wide.
const missingWidths: LabelAddressInput = {
  patientName: "ŒŠŒŠŒŠŒŠŒŠŒŠŒŠŒŠŒŠŒŠŒŠ",
  deliveryAddress: "12½ ŒUVRE ŠTREET",
  deliveryCity: "Surrey",
  deliveryPostalCode: "V3W 3L5",
};

// What a viewer actually draws for doc.text(): each glyph's own width, with no
// kerning, using Adobe's Helvetica widths for the letters jsPDF leaves out.
const ADOBE_WIDTHS: Record<string, number> = { "Œ": 1000, "Š": 667, "½": 834 };
function drawnWidth(doc: jsPDF, text: string, size: number, bold: boolean) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(size);
  const widths = { ...doc.getFont().metadata.Unicode.widths };
  for (const [char, width] of Object.entries(ADOBE_WIDTHS)) widths[char.charCodeAt(0)] = (width / 1000) * widths.fof;
  return (doc.getStringUnitWidth(text, { doKerning: false, widths }) * size) / doc.internal.scaleFactor;
}

describe("label sheet PDF", () => {
  const maxWidth = AVERY_5160.labelWidth - 2 * AVERY_5160.insetX;

  it.each([
    ["the widest real-world text", widest],
    ["tightly kerned capitals", kerned],
    ["letters jsPDF has no width for", missingWidths],
  ])("fits %s inside the label as drawn", (_label, person) => {
    const doc = new jsPDF({ unit: "in", format: "letter" });
    const { labels } = layoutLabelSheet([person], labelTextMeasure(doc));
    expect(labels[0].lines).toHaveLength(3);
    for (const line of labels[0].lines) {
      expect(line.fontSize).toBeGreaterThanOrEqual(7);
      expect(drawnWidth(doc, line.text, line.fontSize, line.bold)).toBeLessThanOrEqual(maxWidth + 1e-9);
    }
  });

  it("would overflow if it measured with kerning, so the kerned case really tests something", () => {
    const doc = new jsPDF({ unit: "in", format: "letter" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    expect(drawnWidth(doc, kerned.patientName, 11, true)).toBeGreaterThan(maxWidth);
    expect(doc.getTextWidth(kerned.patientName)).toBeLessThanOrEqual(maxWidth);
  });

  it("makes one page per 30 labels", () => {
    expect(buildLabelSheetDoc(people(11), { title: "t" }).getNumberOfPages()).toBe(1);
    expect(buildLabelSheetDoc(people(30), { title: "t" }).getNumberOfPages()).toBe(1);
    expect(buildLabelSheetDoc(people(31), { title: "t" }).getNumberOfPages()).toBe(2);
  });

  it("is a Letter-size PDF that asks viewers to print at actual size", () => {
    const pdf = Buffer.from(renderLabelSheetPdf(people(3), { title: "Surrey: Monday labels" })).toString("latin1");
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("/PrintScaling /None");
    // 8.5" x 11" in points (jsPDF writes "612. 792.").
    expect(pdf).toMatch(/\/MediaBox \[0 0 612\.?\d* 792\.?\d*\]/);
  });
});
