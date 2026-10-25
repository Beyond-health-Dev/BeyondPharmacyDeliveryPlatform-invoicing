"use client";

import { useId, useMemo, useState } from "react";
import { button, card, cn, mutedText, sectionTitle } from "@/lib/portalStyles";
import { BANNER_CLASSES } from "@/lib/statusTheme";
import {
  WEEKDAY_SHEETS,
  countLabelSheetPeople,
  labelPageCount,
  labelSheetFileName,
  labelSheetTitle,
  type LabelSheet,
  type LabelSheetProfile,
} from "@/lib/recurringLabels";

// Preset delivery labels on Avery 5160 sheets: one button for the daily
// deliveries (two or more days a week), one per weekday for everyone else.
// The counts come from the same rules the PDF route uses.
export default function RecurringLabelSheets({
  storeSlug,
  orders,
}: {
  storeSlug: string;
  orders: ReadonlyArray<Pick<LabelSheetProfile, "activeDays" | "isActive">>;
}) {
  const titleId = useId();
  const dayGroupId = useId();
  const counts = useMemo(() => countLabelSheetPeople(orders), [orders]);
  const [pending, setPending] = useState<LabelSheet | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const download = async (sheet: LabelSheet) => {
    setPending(sheet);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/${storeSlug}/recurring/labels?sheet=${sheet}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Couldn't make the label sheet. Please try again.");
        return;
      }
      // An expired session is redirected to the sign-in page, which comes
      // back as a normal page rather than a PDF.
      if (!res.headers.get("Content-Type")?.includes("application/pdf")) {
        setError("Your session may have expired. Reload the page and sign in again.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = labelSheetFileName(storeSlug, sheet);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${labelSheetTitle(sheet)} labels downloaded. Print at Actual size (100%).`);
    } catch {
      setError("Network error — the label sheet wasn't downloaded. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const sheetButton = (sheet: LabelSheet, tone: "primary" | "secondary", extra?: string) => {
    const people = counts[sheet];
    const pages = labelPageCount(people);
    return (
      <button
        key={sheet}
        type="button"
        onClick={() => download(sheet)}
        disabled={people === 0 || pending !== null}
        aria-busy={pending === sheet || undefined}
        className={cn(button(tone, "sm"), extra)}
      >
        {pending === sheet ? (
          "Preparing…"
        ) : (
          <>
            {labelSheetTitle(sheet)} <span className="tabular-nums">({people})</span>
            {pages > 1 && <span className="tabular-nums"> · {pages} sheets</span>}
          </>
        )}
      </button>
    );
  };

  return (
    <section aria-labelledby={titleId} className={card}>
      <div className="px-6 py-4 border-b border-hairline">
        <h2 id={titleId} className={sectionTitle}>
          Delivery Labels
        </h2>
        <p className={cn(mutedText, "mt-1")}>
          Avery 5160 · 30 per sheet · each person&apos;s labels repeat to fill the page. Print at
          Actual size (100%).
        </p>
      </div>
      <div className="px-6 py-4 space-y-4">
        {error && (
          <p role="alert" className={cn("rounded-row px-3 py-2 text-sm", BANNER_CLASSES.error)}>
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="inline-block text-xs font-bold text-navy bg-mint px-2.5 py-1 rounded-full">
            {status}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {sheetButton("daily", "primary")}
          <span className="text-xs text-muted">Profiles on two or more days a week</span>
        </div>
        <div>
          <p id={dayGroupId} className="mb-2 text-xs font-semibold text-muted">
            One day a week
          </p>
          <div role="group" aria-labelledby={dayGroupId} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WEEKDAY_SHEETS.map((sheet) => sheetButton(sheet, "secondary", "w-full"))}
          </div>
        </div>
      </div>
    </section>
  );
}
