import jsPDF from "jspdf";
import { layoutLabelSheet, type LabelAddressInput, type MeasureLabelText } from "./recurringLabels";

// Draws an Avery 5160 label sheet (see recurringLabels.ts for the layout).
// Server-only: jsPDF stays out of the client bundle. Text is the default
// black — no outlines, so only the address prints on each sticker.

/**
 * Measures text the way doc.text() draws it: with no kerning. getTextWidth
 * subtracts Helvetica's kerning pairs, so all-caps names would print wider
 * than measured. jsPDF's width table also leaves out a few WinAnsi letters
 * (Š, Ž, Œ, ½...) and guesses half an em for them; count those as a full em,
 * the widest they get, so a guess can only shrink the text.
 */
export function labelTextMeasure(doc: jsPDF): MeasureLabelText {
  const widthTables = new Map<boolean, Record<number, number>>();
  return (text, fontSizePt, bold) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSizePt);
    let widths = widthTables.get(bold);
    if (!widths) {
      const table: Record<number, number> & { fof: number } = doc.getFont().metadata.Unicode.widths;
      widths = { ...table, 0: table.fof };
      widthTables.set(bold, widths);
    }
    const ems = doc.getStringUnitWidth(text, { doKerning: false, widths });
    return (ems * fontSizePt) / doc.internal.scaleFactor;
  };
}

export function buildLabelSheetDoc(
  people: readonly LabelAddressInput[],
  meta: { title: string }
): jsPDF {
  const doc = new jsPDF({ unit: "in", format: "letter", orientation: "portrait" });
  doc.setProperties({
    title: meta.title,
    subject: "Avery 5160 address labels",
    creator: "Beyond Pharmacy",
  });
  // Ask PDF viewers to print at actual size rather than shrink-to-fit, which
  // would slide every label off its sticker.
  doc.viewerPreferences({ PrintScaling: "None" });

  const { pageCount, labels } = layoutLabelSheet(people, labelTextMeasure(doc));
  for (let page = 1; page < pageCount; page++) doc.addPage("letter", "portrait");

  for (const label of labels) {
    doc.setPage(label.page + 1);
    for (const line of label.lines) {
      doc.setFont("helvetica", line.bold ? "bold" : "normal");
      doc.setFontSize(line.fontSize);
      doc.text(line.text, line.x, line.baseline);
    }
  }
  return doc;
}

export function renderLabelSheetPdf(
  people: readonly LabelAddressInput[],
  meta: { title: string }
): ArrayBuffer {
  return buildLabelSheetDoc(people, meta).output("arraybuffer");
}
