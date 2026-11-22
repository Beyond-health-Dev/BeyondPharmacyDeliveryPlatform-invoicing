"use client";

import { useRouter, usePathname } from "next/navigation";
import { cn, primaryButton, secondaryButton } from "@/lib/portalStyles";
import { dateNavigation } from "./dateNavigation";

// Today and the day's label come from the server (Vancouver's day). Reading
// the browser clock here made the server render and the browser disagree
// every evening, when UTC is already tomorrow.
export default function DateNavigation({
  currentDate,
  todayKey,
  isToday,
  dateLabel,
}: {
  storeSlug: string;
  currentDate: string;
  todayKey: string;
  isToday: boolean;
  dateLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { prevDate, nextDate, isPrevDisabled, isNextDisabled } = dateNavigation(currentDate, todayKey);

  const navigate = (date: string | null) => {
    if (date) {
      router.push(`${pathname}?date=${date}`);
    } else {
      router.push(pathname);
    }
  };

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => navigate(prevDate)}
          disabled={isPrevDisabled}
          className={secondaryButton}
        >
          &larr; Prev
        </button>

        <button
          onClick={() => navigate(null)}
          className={cn(
            isToday
              ? primaryButton
              : secondaryButton
          )}
        >
          Today
        </button>

        <button
          onClick={() => navigate(nextDate)}
          disabled={isNextDisabled}
          className={secondaryButton}
        >
          Next &rarr;
        </button>
      </div>

      {!isToday && (
        <p className="text-center text-sm text-muted mt-2">{dateLabel}</p>
      )}
    </div>
  );
}
