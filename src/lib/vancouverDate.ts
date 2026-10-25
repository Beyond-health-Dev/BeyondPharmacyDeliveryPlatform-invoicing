// Client-safe (no Node-only imports) Vancouver date helper. The store operates
// on America/Vancouver days; `new Date().toISOString()` is UTC and rolls to
// "tomorrow" at ~5 PM Pacific, which mis-defaults forms and day boundaries.
const DELIVERY_TIME_ZONE = "America/Vancouver";

// en-CA formats as YYYY-MM-DD, matching <input type="date"> values and the
// scheduledDate keys used across the app.
export function vancouverTodayKey(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DELIVERY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Vancouver wall-clock hour (0-23). The browser's own clock may be in another
// timezone (or plain wrong), so anything scheduled against the pharmacy's day
// has to be derived this way rather than from getHours().
export function vancouverHour(now: Date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone: DELIVERY_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;

  // "24" is a valid en-CA rendering of midnight in some runtimes.
  const parsed = Number(hour);
  if (!Number.isFinite(parsed)) return 0;
  return parsed % 24;
}

// Calendar arithmetic on a YYYY-MM-DD key. Works on the date itself, not on
// an instant, so daylight-saving changes can't shift the result.
export function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The Sunday (YYYY-MM-DD) that starts the Vancouver week containing `now`.
 * Weeks run Sunday to Saturday, like the recurring calendar and the skips.
 * The UTC week turns over at ~5 PM Pacific on Saturday, a whole evening early.
 */
export function vancouverWeekStartKey(now: Date = new Date()) {
  const today = vancouverTodayKey(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  return addDaysToDateKey(today, -weekday);
}

/**
 * UTC-midnight bounds of the Vancouver week containing `now`, which is how
 * skipDate and scheduledDate are stored. Same week as the recurring cron's.
 */
export function vancouverWeekRange(now: Date = new Date()) {
  const startKey = vancouverWeekStartKey(now);
  return {
    startKey,
    weekStart: new Date(`${startKey}T00:00:00.000Z`),
    weekEnd: new Date(`${addDaysToDateKey(startKey, 7)}T00:00:00.000Z`),
  };
}

// From 12:00 PM Vancouver time, new orders default to the next day's delivery.
export const NEXT_DAY_CUTOFF_HOUR = 12;

export function isAfterNextDayCutoff(now: Date = new Date()) {
  return vancouverHour(now) >= NEXT_DAY_CUTOFF_HOUR;
}

/** The delivery date a new order starts with: today before noon, else tomorrow. */
export function defaultDeliveryDateKey(now: Date = new Date()) {
  const today = vancouverTodayKey(now);
  return isAfterNextDayCutoff(now) ? addDaysToDateKey(today, 1) : today;
}

export interface DeliveryDateDefault {
  dateKey: string;
  // True when the noon rule moved the default to tomorrow.
  nextDay: boolean;
}

// Worked out once on the server and handed to the form, so the server render
// and the browser always agree (a browser clock can be skewed, and a render
// straddling noon would otherwise disagree with its hydration).
export function deliveryDateDefault(now: Date = new Date()): DeliveryDateDefault {
  return { dateKey: defaultDeliveryDateKey(now), nextDay: isAfterNextDayCutoff(now) };
}

/** "today", "tomorrow" or "on Thu, Oct 8" — for messages about a delivery day. */
export function describeDeliveryDay(dateKey: string, now: Date = new Date()) {
  const today = vancouverTodayKey(now);
  if (dateKey === today) return "today";
  if (dateKey === addDaysToDateKey(today, 1)) return "tomorrow";
  const label = new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    // Only spell out the year when it isn't this one.
    ...(dateKey.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
  });
  return `on ${label}`;
}

function isDateKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  // Rejects impossible dates like 2026-02-30 rather than rolling them over.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The day a delivery list shows: `?date=YYYY-MM-DD` when valid, else
 * Vancouver's today. Bounds are UTC midnights, which is how scheduledDate is
 * stored — server-local midnight (UTC on Vercel) would flip "today" to
 * tomorrow at ~5 PM Pacific.
 */
export function deliveryDayRange(dateParam: string | undefined, now: Date = new Date()) {
  const todayKey = vancouverTodayKey(now);
  const selectedKey = isDateKey(dateParam) ? dateParam : todayKey;
  return {
    todayKey,
    selectedKey,
    isToday: selectedKey === todayKey,
    todayStart: new Date(`${todayKey}T00:00:00.000Z`),
    dayStart: new Date(`${selectedKey}T00:00:00.000Z`),
    nextDayStart: new Date(`${addDaysToDateKey(selectedKey, 1)}T00:00:00.000Z`),
  };
}
