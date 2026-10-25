import jsPDF from "jspdf";
import { describe, expect, it } from "vitest";
import { AVERY_5160, layoutLabelSheet, type LabelAddressInput } from "@/lib/recurringLabels";
import { buildLabelSheetDoc, renderLabelSheetPdf } from "@/lib/recurringLabelsPdf";

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

describe("label sheet PDF", () => {
  it("fits the widest real-world text inside the label with the real font", () => {
    const doc = new jsPDF({ unit: "in", format: "letter" });
    const measure = (text: string, size: number, bold: boolean) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      return doc.getTextWidth(text);
    };
    const { labels } = layoutLabelSheet([widest], measure);
    const maxWidth = AVERY_5160.labelWidth - 2 * AVERY_5160.insetX;
    for (const line of labels[0].lines) {
      expect(line.fontSize).toBeGreaterThanOrEqual(7);
      expect(measure(line.text, line.fontSize, line.bold)).toBeLessThanOrEqual(maxWidth + 1e-9);
    }
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
