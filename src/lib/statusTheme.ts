// Every status and semantic colour in the app comes from here — badges,
// notification markers, banners and calendar chips — so the same state never
// looks different in two places. Semantic states are pastel fills with navy
// text (never saturated fills or white text); "off" states are white with a
// hairline and muted text.

export type Tone = "blush" | "lilac" | "cream" | "butter" | "blue" | "mint" | "white" | "off";

// blush = failed / on hold / needs attention, lilac = on the road,
// cream = neutral, butter = waiting / draft, blue = information / assigned,
// mint = done / active, white = a chip sitting on a pastel row,
// off = cancelled / inactive.
export const TONE_CLASSES: Record<Tone, string> = {
  blush: "bg-blush text-navy",
  lilac: "bg-lilac text-navy",
  cream: "bg-panel-cream text-navy",
  butter: "bg-butter text-navy",
  blue: "bg-blue text-navy",
  mint: "bg-mint text-navy",
  white: "bg-white text-navy",
  off: "bg-white text-muted ring-1 ring-inset ring-hairline",
};

const STATUS_TONES: Record<string, Tone> = {
  // Orders
  PENDING: "butter",
  ASSIGNED: "blue",
  PICKED_UP: "lilac",
  IN_TRANSIT: "lilac",
  DELIVERED: "mint",
  FAILED: "blush",
  CANCELLED: "off",
  // Spoke dispatch. Held for its 6 AM run: waiting, like PENDING.
  SCHEDULED: "butter",
  SUBMITTED: "blue",
  PLAN_CREATED: "blue",
  STOP_CREATED: "blue",
  ALLOCATED: "blue",
  DEPARTED: "lilac",
  TRACKING_LINK_ADDED: "lilac",
  DELIVERY_FAILED: "blush",
  DISPATCH_FAILED: "blush",
  WEBHOOK_RECEIVED: "cream",
  // Zones, users, invoices, recurring profiles
  ACTIVE: "mint",
  INACTIVE: "off",
  DRAFT: "butter",
  FINALIZED: "mint",
  ADMIN: "blue",
  DRIVER: "mint",
  // Held deliveries won't go out: flagged like failures, in the calendar
  // and the profile list alike.
  HOLD: "blush",
  SKIPPED: "cream",
};

export function statusTone(status: string): Tone {
  return STATUS_TONES[status] ?? "cream";
}

export function toneBadgeClasses(tone: Tone) {
  return `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${TONE_CLASSES[tone]}`;
}

export function statusBadgeClasses(status: string) {
  return toneBadgeClasses(statusTone(status));
}

// Small markers (notification dots, toast dots). Pastels are too faint to read
// as a dot on white, so markers use the accent colours instead.
export type MarkerKind = "error" | "success" | "info";

export const MARKER_CLASSES: Record<MarkerKind, string> = {
  error: "bg-danger",
  success: "bg-green",
  info: "bg-navy",
};

// Message banners: errors are blush with --danger text (AA on blush); the
// rest are pastel with navy text.
export const BANNER_CLASSES = {
  error: "bg-blush text-danger",
  success: "bg-mint text-navy",
  warning: "bg-butter text-navy",
  info: "bg-blue text-navy",
} as const;

// Store notifications: which badge status and marker each kind uses.
const FAILURE_NOTIFICATIONS = new Set([
  "DELIVERY_FAILED",
  "SPOKE_DISPATCH_FAILED",
  "SPOKE_DISPATCH_STALLED",
  "SPOKE_CANCEL_INCOMPLETE",
  "GENERATION_INCOMPLETE",
]);

// The badge title of each kind of store notification the app creates. A kind
// missing here reads "Notice" (src/lib/__tests__/notificationTitles.test.ts
// checks every kind the code creates is listed).
export const NOTIFICATION_TITLES: Record<string, string> = {
  DELIVERY_FAILED: "Delivery Failed",
  DELIVERY_REATTEMPT: "Re-attempt Started",
  SPOKE_DISPATCH_FAILED: "Spoke Dispatch Failed",
  SPOKE_DISPATCH_STALLED: "Spoke Delivery Stalled",
  SPOKE_CANCEL_INCOMPLETE: "Remove from Anchor",
  GENERATION_INCOMPLETE: "Generation Incomplete",
  ORDER_PICKED_UP: "Order Picked Up",
  BATCH_DELIVERED: "Batch Delivered",
};

export function notificationTitle(type: string) {
  return NOTIFICATION_TITLES[type] ?? "Notice";
}

// `unread` is the row fill while a notification is still new.
export function notificationStyle(type: string): { badge: string; marker: string; unread: string } {
  if (FAILURE_NOTIFICATIONS.has(type)) {
    return { badge: statusBadgeClasses("FAILED"), marker: MARKER_CLASSES.error, unread: "bg-blush" };
  }
  if (type === "ORDER_PICKED_UP") {
    return { badge: statusBadgeClasses("PICKED_UP"), marker: MARKER_CLASSES.success, unread: "bg-mint" };
  }
  if (type === "BATCH_DELIVERED") {
    return { badge: statusBadgeClasses("DELIVERED"), marker: MARKER_CLASSES.success, unread: "bg-mint" };
  }
  return { badge: statusBadgeClasses("IN_TRANSIT"), marker: MARKER_CLASSES.info, unread: "bg-blue" };
}
