import { addDaysToDateKey } from "@/lib/vancouverDate";

// Drivers can look back 30 days and ahead 7 from Vancouver's today.
const DAYS_BACK = 30;
const DAYS_AHEAD = 7;

/** The date bar's previous and next days, as YYYY-MM-DD keys on Vancouver's calendar. */
export function dateNavigation(currentDate: string, todayKey: string) {
  const prevDate = addDaysToDateKey(currentDate, -1);
  const nextDate = addDaysToDateKey(currentDate, 1);
  return {
    prevDate,
    nextDate,
    isPrevDisabled: prevDate < addDaysToDateKey(todayKey, -DAYS_BACK),
    isNextDisabled: nextDate > addDaysToDateKey(todayKey, DAYS_AHEAD),
  };
}
