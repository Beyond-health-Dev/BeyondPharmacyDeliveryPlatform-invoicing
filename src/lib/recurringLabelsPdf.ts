import jsPDF from "jspdf";
import { layoutLabelSheet, type LabelAddressInput } from "./recurringLabels";

// Draws an Avery 5160 label sheet (see recurringLabels.ts for the layout).
// Server-only: jsPDF stays out of the client bundle. Text is the default
// black — no outlines, so only the address prints on each sticker.

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

  const measure = (text: string, fontSizePt: number, bold: boolean) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(fontSizePt);
    return doc.getTextWidth(text);
  };

  const { pageCount, labels } = layoutLabelSheet(people, measure);
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
