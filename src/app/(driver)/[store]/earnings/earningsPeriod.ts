import { vancouverTodayKey, vancouverWeekStartKey } from "@/lib/vancouverDate";

/**
 * A driver's earnings period on Vancouver's calendar: this week (from Sunday)
 * or this month, up to today. `start` is a UTC midnight, like scheduledDate.
 * The server's clock is UTC, whose week and month turn over at ~5 PM Pacific.
 */
export function earningsPeriod(range: "week" | "month", now: Date = new Date()) {
  const endKey = vancouverTodayKey(now);
  const startKey = range === "week" ? vancouverWeekStartKey(now) : `${endKey.slice(0, 7)}-01`;
  return { startKey, endKey, start: new Date(`${startKey}T00:00:00.000Z`) };
}
