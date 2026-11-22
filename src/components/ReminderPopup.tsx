"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { BANNER_CLASSES, toneBadgeClasses } from "@/lib/statusTheme";
import { cn, primaryButton, sectionTitle } from "@/lib/portalStyles";
import { isReminderDue } from "@/lib/reminderSchedule";
import { vancouverTodayKey } from "@/lib/vancouverDate";

interface ReminderItem {
  id: string;
  note: string;
  patientName: string | null;
  remindOn: string;
  repeatIntervalWeeks: number | null;
  isOverdue: boolean;
}

interface DueReminders {
  dateKey: string;
  items: ReminderItem[];
  outstanding: number;
}

const SNOOZE_MINUTES = 30;
const POLL_MS = 60_000;

// Per-browser, per-day so a dismissal never silently carries into tomorrow.
function snoozeKey(storeSlug: string, dateKey: string) {
  return `reminder-snooze:${storeSlug}:${dateKey}`;
}

function readSnoozedUntil(storeSlug: string, dateKey: string) {
  try {
    const raw = window.localStorage.getItem(snoozeKey(storeSlug, dateKey));
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    // Blocked storage: treat as never snoozed. Nagging is the safe failure.
    return 0;
  }
}

function writeSnoozedUntil(storeSlug: string, dateKey: string, until: number) {
  try {
    window.localStorage.setItem(snoozeKey(storeSlug, dateKey), String(until));
  } catch {
    // Ignore — the reminder simply stays visible.
  }
}

export default function ReminderPopup({ storeSlug }: { storeSlug: string }) {
  const [due, setDue] = useState<DueReminders | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const titleId = useId();
  // Bumped on every tick so a poll that started earlier can't overwrite the
  // fresher state it doesn't know about.
  const mutationSeq = useRef(0);

  const fetchDue = useCallback(async () => {
    const seq = mutationSeq.current;
    try {
      const res = await fetch(`/api/${storeSlug}/reminders?scope=due`);
      if (!res.ok) return;
      const data = await res.json();
      if (mutationSeq.current !== seq) return;
      setDue(data);
    } catch {
      // Offline or transient — keep whatever we already have.
    }
  }, [storeSlug]);

  useEffect(() => {
    fetchDue();
    const interval = setInterval(() => {
      setNow(new Date());
      fetchDue();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchDue]);

  const dateKey = due?.dateKey ?? vancouverTodayKey(now);

  useEffect(() => {
    setSnoozedUntil(readSnoozedUntil(storeSlug, dateKey));
  }, [storeSlug, dateKey]);

  const complete = async (item: ReminderItem) => {
    mutationSeq.current += 1;
    setSaving(item.id);
    setError("");
    try {
      const res = await fetch(`/api/${storeSlug}/reminders/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Could not save — try again.");
        return;
      }
      await fetchDue();
    } catch {
      setError("Network error — that reminder was not marked done.");
    } finally {
      setSaving(null);
    }
  };

  const hideUntil = (until: number) => {
    writeSnoozedUntil(storeSlug, dateKey, until);
    setSnoozedUntil(until);
  };
  const snooze = () => hideUntil(Date.now() + SNOOZE_MINUTES * 60_000);
  // Keyed to today's dateKey, so tomorrow starts fresh regardless.
  const dismissForToday = () => hideUntil(Date.now() + 24 * 60 * 60_000);

  const outstanding = due?.outstanding ?? 0;
  const visible =
    outstanding > 0 && isReminderDue(now) && Date.now() >= snoozedUntil;

  if (!visible || !due) return null;

  // Escape and the backdrop snooze, as before; the Modal only listens while
  // the popup is actually showing.
  return (
    <Modal open onClose={snooze} size="lg" labelledBy={titleId}>
      <div className="shrink-0 border-b border-hairline px-6 pb-4 pt-2 sm:pt-4">
        <div className="flex items-center gap-2">
          <Bell size={19} strokeWidth={1.8} className="text-navy" aria-hidden="true" />
          <h3 id={titleId} className={sectionTitle}>Reminders for today</h3>
        </div>
        <p className="mt-1 text-sm text-muted">
          {outstanding} {outstanding === 1 ? "reminder" : "reminders"} outstanding.
          Tick each one off as you handle it.
        </p>
      </div>

      <div className="flex-1 divide-y divide-hairline overflow-y-auto">
        {due.items.map((item) => (
          <div key={item.id} className="flex items-start gap-3 px-6 py-3">
            <button
              onClick={() => complete(item)}
              disabled={saving === item.id}
              title="Mark done"
              aria-label={`Mark done: ${item.note}`}
              className="mt-0.5 h-6 w-6 shrink-0 rounded-full border-(length:--line-strong) border-dot bg-white transition duration-(--hover-ms) hover:border-green hover:bg-mint disabled:opacity-40"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-navy">{item.note}</span>
                {item.isOverdue && (
                  <span className={toneBadgeClasses("blush")}>
                    Overdue
                  </span>
                )}
              </div>
              {item.patientName && (
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {item.patientName}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className={cn("shrink-0 px-6 py-2 text-sm", BANNER_CLASSES.error)}>
          {error}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-hairline px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={dismissForToday}
            className="text-xs font-semibold text-muted transition-colors duration-(--hover-ms) hover:text-navy"
            title="Hides these until tomorrow, even if still outstanding."
          >
            Not today — dismiss
          </button>
          <Link
            href={`/${storeSlug}/reminders`}
            onClick={snooze}
            className="text-xs font-semibold text-muted transition-colors duration-(--hover-ms) hover:text-navy"
          >
            Manage
          </Link>
        </div>
        <button onClick={snooze} className={primaryButton}>
          Remind me in {SNOOZE_MINUTES} min
        </button>
      </div>
    </Modal>
  );
}
