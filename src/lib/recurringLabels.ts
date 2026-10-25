// Preset delivery labels for recurring deliveries, printed on Avery 5160
// sheets (US Letter, 3 x 10 labels of 2 5/8" x 1"). Pure and client-safe: the
// Recurring page uses it for the per-sheet counts, the labels API route for
// the PDF (drawn by recurringLabelsPdf.ts), so the two always agree.
//
// Sheets:
// - "daily": every profile that goes out on two or more weekdays.
// - "sunday".."saturday": profiles whose only weekday is that day (weekly or
//   every other week). A multi-day profile never lands on a day sheet.
// Every sheet fills whole pages of 30 so no stickers are left blank: each
// person's copies sit together (A, A, A, B, B, B ...).

import { RECURRING_DAY_NAMES, parseRecurringActiveDays } from "./recurringDuplicateGuard";

// ---- Sheets ----

export type LabelSheet =
  | "daily"
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

// Index = weekday number (0 = Sunday), as stored in RecurringOrder.activeDays.
export const WEEKDAY_SHEETS: readonly LabelSheet[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const LABEL_SHEETS: readonly LabelSheet[] = ["daily", ...WEEKDAY_SHEETS];

export function labelSheetTitle(sheet: LabelSheet) {
  if (sheet === "daily") return "Daily Deliveries";
  return RECURRING_DAY_NAMES[WEEKDAY_SHEETS.indexOf(sheet)];
}

export function parseLabelSheet(value: string | null | undefined): LabelSheet | null {
  const sheet = (value ?? "").trim().toLowerCase();
  return (LABEL_SHEETS as readonly string[]).includes(sheet) ? (sheet as LabelSheet) : null;
}

export function labelSheetFileName(storeSlug: string, sheet: LabelSheet) {
  return `labels-${storeSlug}-${sheet}.pdf`;
}

// ---- Which profiles go on which sheet ----

export interface LabelSheetProfile {
  id: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity?: string;
  // number[] or the stored JSON string ("[1,3,5]"); 0 = Sunday.
  activeDays: unknown;
  isActive?: boolean;
}

/** The one sheet a profile with these weekdays prints on, or null if none. */
export function labelSheetForDays(activeDays: unknown): LabelSheet | null {
  const days = parseRecurringActiveDays(activeDays);
  if (!days) return null;
  return days.length > 1 ? "daily" : WEEKDAY_SHEETS[days[0]];
}

const collator = new Intl.Collator("en-CA", { sensitivity: "base", numeric: true });

// Name, then address, then city, then id — so the order (and which people get
// the extra copies) never depends on the order the profiles were loaded in.
export function compareLabelProfiles(a: LabelSheetProfile, b: LabelSheetProfile) {
  return (
    collator.compare(a.patientName.trim(), b.patientName.trim()) ||
    collator.compare(a.deliveryAddress.trim(), b.deliveryAddress.trim()) ||
    collator.compare((a.deliveryCity ?? "").trim(), (b.deliveryCity ?? "").trim()) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The people on a sheet, in print order. Inactive profiles never print; on-hold
 * profiles do (labels are presets, a hold is temporary).
 */
export function profilesForLabelSheet<T extends LabelSheetProfile>(
  profiles: readonly T[],
  sheet: LabelSheet
): T[] {
  return profiles
    .filter((profile) => profile.isActive !== false && labelSheetForDays(profile.activeDays) === sheet)
    .sort(compareLabelProfiles);
}

export function countLabelSheetPeople(
  profiles: ReadonlyArray<Pick<LabelSheetProfile, "activeDays" | "isActive">>
): Record<LabelSheet, number> {
  const counts = Object.fromEntries(LABEL_SHEETS.map((sheet) => [sheet, 0])) as Record<
    LabelSheet,
    number
  >;
  for (const profile of profiles) {
    if (profile.isActive === false) continue;
    const sheet = labelSheetForDays(profile.activeDays);
    if (sheet) counts[sheet] += 1;
  }
  return counts;
}

// ---- Filling whole pages ----

export const LABELS_PER_PAGE = 30;

export function labelPageCount(people: number, perPage = LABELS_PER_PAGE) {
  return people > 0 ? Math.ceil(people / perPage) : 0;
}

/**
 * Copies per person so the sheet fills whole pages: everyone gets the same
 * number, and the first few (in print order) one extra to use up the rest.
 * 11 people -> 8 x 3 + 3 x 2 = 30; 31 people -> 29 x 2 + 2 x 1 = 60.
 */
export function labelCopyCounts(people: number, perPage = LABELS_PER_PAGE): number[] {
  if (people <= 0) return [];
  const slots = perPage * labelPageCount(people, perPage);
  const base = Math.floor(slots / people);
  const extra = slots % people;
  return Array.from({ length: people }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Every label in reading order, each person's copies side by side. */
export function allocateLabelSlots<T>(people: readonly T[], perPage = LABELS_PER_PAGE): T[] {
  const counts = labelCopyCounts(people.length, perPage);
  return people.flatMap((person, i) => Array.from({ length: counts[i] }, () => person));
}

// ---- Avery 5160 geometry (inches, origin at the page's top-left) ----

export interface LabelLayout {
  pageWidth: number;
  pageHeight: number;
  columns: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  marginTop: number;
  marginLeft: number;
  pitchX: number;
  pitchY: number;
  // Text keeps this far from a label's left and right edges.
  insetX: number;
}

export const AVERY_5160: LabelLayout = {
  pageWidth: 8.5,
  pageHeight: 11,
  columns: 3,
  rows: 10,
  labelWidth: 2.625,
  labelHeight: 1,
  marginTop: 0.5,
  marginLeft: 0.1875,
  pitchX: 2.75,
  pitchY: 1,
  insetX: 0.12,
};

export interface LabelRect {
  page: number;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function labelSlotRect(slot: number, layout: LabelLayout = AVERY_5160): LabelRect {
  const perPage = layout.columns * layout.rows;
  const page = Math.floor(slot / perPage);
  const index = slot % perPage;
  const row = Math.floor(index / layout.columns);
  const column = index % layout.columns;
  return {
    page,
    row,
    column,
    x: layout.marginLeft + column * layout.pitchX,
    y: layout.marginTop + row * layout.pitchY,
    width: layout.labelWidth,
    height: layout.labelHeight,
  };
}

// ---- Label text ----

export const LABEL_PROVINCE = "BC";

export interface LabelAddressInput {
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPostalCode: string;
}

// The PDF uses the built-in Helvetica, which only has the Windows-1252
// (WinAnsi) characters: Latin-1 plus these extras (curly quotes, dashes,
// ellipsis, euro...). Anything else would print as garbage.
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// Letters that don't decompose into a base letter plus accent.
const WIN_ANSI_FALLBACKS: Record<string, string> = Object.fromEntries(
  [
    [0x0141, "L"], // L with stroke
    [0x0142, "l"],
    [0x0110, "D"], // D with stroke
    [0x0111, "d"],
    [0x0131, "i"], // dotless i
  ].map(([codePoint, letter]) => [String.fromCharCode(codePoint as number), letter as string])
);

function isWinAnsi(codePoint: number) {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    WIN_ANSI_EXTRAS.has(codePoint)
  );
}

// Invisible characters pasted in with names and addresses (zero-width spaces,
// direction marks, soft hyphens...) and accents left over on their own.
const INVISIBLE = /\p{Cf}/u;
const MARK = /\p{M}/u;

/** Text the PDF font can draw: accents kept where possible, else stripped; "?" otherwise. */
export function toWinAnsi(text: string) {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (INVISIBLE.test(char) || MARK.test(char)) continue;
    if (isWinAnsi(codePoint)) {
      out += char;
      continue;
    }
    if (/\s/.test(char)) {
      out += " ";
      continue;
    }
    // NFKD also folds ligatures and full-width letters ("ﬁ" -> "fi").
    const base = [...char.normalize("NFKD")].filter((part) => !MARK.test(part)).join("");
    if (base && [...base].every((part) => isWinAnsi(part.codePointAt(0) ?? 0))) {
      out += base;
    } else {
      out += WIN_ANSI_FALLBACKS[char] ?? "?";
    }
  }
  return out;
}

function cleanText(value: string | null | undefined) {
  return toWinAnsi(value ?? "").replace(/\s+/g, " ").trim();
}

/** "v3w3l5" -> "V3W 3L5"; anything that isn't a Canadian postal code is just tidied. */
export function formatPostalCode(value: string | null | undefined) {
  const compact = (value ?? "").toUpperCase().replace(/\s+/g, "");
  if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  return cleanText(value).toUpperCase();
}

/** [name, street, "City, BC  V3W 3L5"] */
export function formatLabelLines(person: LabelAddressInput): [string, string, string] {
  const name = cleanText(person.patientName);
  const street = cleanText(person.deliveryAddress);
  // A city typed as "Surrey, BC" mustn't become "Surrey, BC, BC".
  const city = cleanText(person.deliveryCity)
    .replace(/[,\s]+(?:b\.?\s*c\.?|british columbia)$/i, "")
    .trim();
  const postal = formatPostalCode(person.deliveryPostalCode);

  const region = city ? `${city}, ${LABEL_PROVINCE}` : LABEL_PROVINCE;
  return [name, street, postal ? `${region}  ${postal}` : region];
}

// ---- Fitting text into a label ----

/** Width of `text` in inches at `fontSizePt`, bold or regular. */
export type MeasureLabelText = (text: string, fontSizePt: number, bold: boolean) => number;

export const LABEL_TEXT = {
  name: { maxSize: 11, minSize: 7, bold: true },
  address: { maxSize: 10, minSize: 7, bold: false },
  // Font sizes shrink in half-point steps.
  step: 0.5,
  lineHeight: 1.2,
  // Helvetica's ascent and descent, as a share of the font size.
  ascent: 0.718,
  descent: 0.207,
  // Three plain periods, not the single ellipsis character: jsPDF measures
  // that glyph narrower than viewers draw it, so a cut line could overrun.
  ellipsis: "...",
} as const;

export interface FittedLine {
  text: string;
  fontSize: number;
  bold: boolean;
}

/**
 * The largest size (down to minSize) at which the line fits maxWidth; if even
 * minSize is too wide, the line is cut short with an ellipsis.
 */
export function fitLabelLine(
  text: string,
  measure: MeasureLabelText,
  opts: {
    maxWidth: number;
    maxSize: number;
    minSize: number;
    bold: boolean;
    step?: number;
    ellipsis?: string;
  }
): FittedLine {
  const step = opts.step ?? LABEL_TEXT.step;
  const ellipsis = opts.ellipsis ?? LABEL_TEXT.ellipsis;
  if (!text) return { text: "", fontSize: opts.maxSize, bold: opts.bold };

  // Whole half-point steps, so float drift can't skip a size.
  const stepUnits = Math.max(1, Math.round(step * 2));
  for (let half = Math.round(opts.maxSize * 2); half >= Math.round(opts.minSize * 2); half -= stepUnits) {
    const size = half / 2;
    if (measure(text, size, opts.bold) <= opts.maxWidth) {
      return { text, fontSize: size, bold: opts.bold };
    }
  }

  const size = opts.minSize;
  for (let end = text.length - 1; end > 0; end--) {
    const cut = text.slice(0, end).replace(/[\s,-]+$/, "");
    if (cut && measure(cut + ellipsis, size, opts.bold) <= opts.maxWidth) {
      return { text: cut + ellipsis, fontSize: size, bold: opts.bold };
    }
  }
  return {
    text: measure(ellipsis, size, opts.bold) <= opts.maxWidth ? ellipsis : "",
    fontSize: size,
    bold: opts.bold,
  };
}

/** Text baselines (inches from the page top) for lines centred in a label. */
export function labelBaselines(
  sizesPt: readonly number[],
  rectY: number,
  rectHeight: number,
  text: Pick<typeof LABEL_TEXT, "ascent" | "descent" | "lineHeight"> = LABEL_TEXT
): number[] {
  if (sizesPt.length === 0) return [];
  const blockPt =
    text.ascent * sizesPt[0] +
    sizesPt.slice(1).reduce((sum, size) => sum + text.lineHeight * size, 0) +
    text.descent * sizesPt[sizesPt.length - 1];
  const top = rectY + (rectHeight - blockPt / 72) / 2;

  const baselines = [top + (text.ascent * sizesPt[0]) / 72];
  for (let i = 1; i < sizesPt.length; i++) {
    baselines.push(baselines[i - 1] + (text.lineHeight * sizesPt[i]) / 72);
  }
  return baselines;
}

export interface PlacedLine extends FittedLine {
  x: number;
  baseline: number;
}

export interface PlacedLabel {
  slot: number;
  page: number;
  personIndex: number;
  rect: LabelRect;
  lines: PlacedLine[];
}

/** Every label on the sheet with its fitted, positioned lines. */
export function layoutLabelSheet(
  people: readonly LabelAddressInput[],
  measure: MeasureLabelText,
  layout: LabelLayout = AVERY_5160
): { pageCount: number; labels: PlacedLabel[] } {
  const perPage = layout.columns * layout.rows;
  const maxWidth = layout.labelWidth - 2 * layout.insetX;

  // Fit each person once; their copies share the result.
  const fitted = people.map((person) => {
    const [name, street, cityLine] = formatLabelLines(person);
    return [
      fitLabelLine(name, measure, { maxWidth, ...LABEL_TEXT.name }),
      fitLabelLine(street, measure, { maxWidth, ...LABEL_TEXT.address }),
      fitLabelLine(cityLine, measure, { maxWidth, ...LABEL_TEXT.address }),
    ].filter((line) => line.text !== "");
  });

  const slots = allocateLabelSlots(
    people.map((_, index) => index),
    perPage
  );

  const labels = slots.map((personIndex, slot) => {
    const rect = labelSlotRect(slot, layout);
    const lines = fitted[personIndex];
    const baselines = labelBaselines(
      lines.map((line) => line.fontSize),
      rect.y,
      rect.height
    );
    return {
      slot,
      page: rect.page,
      personIndex,
      rect,
      lines: lines.map((line, i) => ({ ...line, x: rect.x + layout.insetX, baseline: baselines[i] })),
    };
  });

  return { pageCount: labelPageCount(people.length, perPage), labels };
}
