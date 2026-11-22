// Shared class strings for every portal screen. Built only from the design
// tokens in src/styles/theme.css (through the Tailwind mapping in
// globals.css) — no colour, radius or shadow values of their own.

export { statusBadgeClasses } from "./statusTheme";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// ---- Page ----

// `isolate`: the shell is the stacking context page-header circles paint in
// (above the page background, beneath every card).
export const portalShell = "isolate min-h-screen overflow-x-clip bg-white text-navy";

export const portalMain = "mx-auto w-full max-w-content py-6";

export const driverMain = "max-w-lg mx-auto px-4 py-4";

// ---- Surfaces ----

export const card = "rounded-card border border-hairline bg-white shadow-soft";

export const cardInteractive =
  "rounded-card border border-hairline bg-white shadow-soft transition duration-(--hover-ms) ease-out hover:-translate-y-0.5 hover:shadow-lift";

// An interactive card flagged for attention (a failed delivery): blush fill,
// no border. Text on it is navy (muted fails contrast on blush).
export const cardAttention =
  "rounded-card bg-blush shadow-soft transition duration-(--hover-ms) ease-out hover:-translate-y-0.5 hover:shadow-lift";

// A solid panel (no border): neutral cream, or pass a pastel fill instead.
export const panel = "rounded-card bg-panel-cream";

export const emptyState = "rounded-card bg-panel-cream p-8 text-center text-sm text-muted";

// ---- Type ----

// Page titles drop in on arrival; actions beside them use pageAction.
export const pageTitle =
  "drop-in text-h1 font-extrabold leading-h1 tracking-h1 text-navy";
export const pageAction = "drop-in drop-in--2";
export const sectionTitle = "text-card-title font-extrabold text-navy";
export const mutedText = "text-sm text-muted";
export const label = "block text-sm font-semibold text-navy mb-1";
export const eyebrow =
  "inline-flex items-center rounded-full bg-mint px-4 py-2 text-label font-bold uppercase tracking-eyebrow text-navy";
export const textLink =
  "font-semibold text-green-link transition-colors duration-(--hover-ms) hover:text-navy";

// ---- Form controls ----

export const input =
  "w-full rounded-row border border-hairline bg-white px-3 py-2 text-sm text-navy outline-none transition duration-(--hover-ms) placeholder:text-muted focus:border-navy focus:ring-2 focus:ring-navy";

export const inputReadOnly = "bg-panel-cream text-muted";

// ---- Buttons (all fully round; press = scale .97) ----

const BUTTON_BASE =
  "rounded-full border-(length:--line-strong) font-bold transition duration-(--hover-ms) ease-out active:scale-(--press-scale) disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_TONES = {
  // Navy pill, cream text.
  primary: "border-transparent bg-navy text-cream hover:bg-navy-deep",
  // White, faint navy border; border darkens on hover.
  secondary: "border-control bg-white text-navy shadow-soft hover:border-control-hover",
  // Destructive: blush fill, danger text — never a red fill.
  danger: "border-hairline bg-blush text-danger hover:bg-blush-hover",
} as const;

const BUTTON_SIZES = {
  sm: "px-4 py-2 text-xs",
  md: "px-btn-x py-btn-y text-sm",
  // Large tap targets (driver screens).
  lg: "px-btn-x py-3.5 text-sm",
} as const;

export function button(
  tone: keyof typeof BUTTON_TONES,
  size: keyof typeof BUTTON_SIZES = "md"
) {
  return `${BUTTON_BASE} ${BUTTON_TONES[tone]} ${BUTTON_SIZES[size]}`;
}

export const primaryButton = button("primary");

export const primaryButtonFull = `${BUTTON_BASE} ${BUTTON_TONES.primary} w-full px-btn-x py-3 text-sm`;

// The single main call-to-action on a screen also gets the CTA shadow.
export const ctaShadow = "shadow-cta";

export const secondaryButton = button("secondary");

export const dangerButton = button("danger");

export const softButton =
  "rounded-full bg-panel-cream px-4 py-2 text-sm font-bold text-navy transition duration-(--hover-ms) ease-out hover:bg-blue active:scale-(--press-scale) disabled:opacity-50";

// Small inline actions inside rows and tables. While a request runs they are
// aria-disabled rather than disabled, so keyboard focus stays on them.
const LINK_BUTTON_OFF =
  "disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
export const linkButton =
  `font-semibold text-green-link transition-colors duration-(--hover-ms) hover:text-navy ${LINK_BUTTON_OFF}`;
export const dangerLinkButton =
  `font-semibold text-danger transition-opacity duration-(--hover-ms) hover:opacity-75 ${LINK_BUTTON_OFF}`;
// An action on a pastel row or panel (a failed row, the zone confirm, a new
// notification), where the green falls under 4.5:1: navy, underlined on hover.
export const tintedLinkButton =
  `font-bold text-navy underline-offset-2 hover:underline ${LINK_BUTTON_OFF}`;

// ---- Selectable rows / tabs / filters (see .selectable in theme.css) ----

export const selectablePill =
  "selectable rounded-full px-3 py-1.5 text-sm font-semibold active:scale-(--press-scale)";
export const selectableRow = "selectable rounded-row";

// ---- Tables ----

export const tableHeader =
  "bg-navy text-left text-xs font-bold uppercase tracking-table text-cream";

// Rows aren't clickable, so no hover tint (it would also drop the green
// row-action links under 4.5:1).
export const tableRow = "transition-colors duration-(--hover-ms)";

// Totals: blue = regular, butter = highlighted, mint = total.
export const totalPill = {
  regular: "inline-flex rounded-full bg-blue px-3 py-1 font-bold text-navy tabular-nums",
  highlight: "inline-flex rounded-full bg-butter px-3 py-1 font-bold text-navy tabular-nums",
  total: "inline-flex rounded-full bg-mint px-3 py-1 font-bold text-navy tabular-nums",
} as const;
