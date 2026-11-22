"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/DialogsProvider";
import {
  button,
  card,
  cn,
  input,
  label,
  sectionTitle,
} from "@/lib/portalStyles";
import { BANNER_CLASSES } from "@/lib/statusTheme";
import { vancouverWeekStartKey } from "@/lib/vancouverDate";
import type { WeeklyHoldInstance } from "@/lib/weeklyHolds";
import WeeklyHolds from "./WeeklyHolds";
import styles from "@/styles/recurring-calendar.module.css";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
const WEEK_RANGE = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const FULL_DATE = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const WEEKDAY = new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" });
const MONTH_DAY = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

interface Driver {
  id: string;
  name: string;
}

interface CalendarInstance extends WeeklyHoldInstance {
  id: string;
  zoneName: string;
  assignedDriverName: string | null;
  assignedDriverId: string | null;
  skipDate: string | null;
  generatedOrderStatus: string | null;
}

interface CalendarResponse {
  instances: CalendarInstance[];
}
const NO_INSTANCES: CalendarInstance[] = [];

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function dateFromKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

// Days here are UTC midnights standing for calendar dates, so UTC getters give
// the right weekday. Never pass `new Date()`: its UTC date is tomorrow from
// ~5 PM Pacific, so take the current week from vancouverWeekStartKey().
function weekStart(date: Date) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function getCalendarRange(week: Date) {
  const start = weekStart(week);
  const end = addDays(start, 7);
  return { start, end };
}

function holdLabel(instance: CalendarInstance) {
  if (!instance.isHeld) return null;
  if (instance.holdType === "TEMPLATE") return "Vacation hold";
  if (instance.holdType === "WEEK") return "Skipped this week";
  return "On hold";
}

export default function RecurringCalendar({
  storeSlug,
  drivers,
  initialWeekStartKey,
  todayKey,
  revision,
  refreshCalendar,
}: {
  storeSlug: string;
  drivers: Driver[];
  // From the server, so the server render and the browser open on the same
  // week even if the browser's clock is off.
  initialWeekStartKey: string;
  todayKey: string;
  revision: number;
  refreshCalendar: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const id = useId();
  const headingId = `${id}-heading`;
  const quickViewId = `${id}-quick-view`;
  const reasonId = `${id}-hold-reason`;
  const [visibleWeek, setVisibleWeek] = useState(() => dateFromKey(initialWeekStartKey));
  const [result, setResult] = useState<{ key: string; instances: CalendarInstance[]; error: string } | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [pendingAction, setPendingAction] = useState<"hold" | "delete" | null>(null);
  const [selectedInstance, setSelectedInstance] =
    useState<CalendarInstance | null>(null);
  const [holdReasonDraft, setHoldReasonDraft] = useState("");
  const [activeDriverFilter, setActiveDriverFilter] = useState<string>(ALL);

  const { start, end } = useMemo(
    () => getCalendarRange(visibleWeek),
    [visibleWeek]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    [start]
  );
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  const weekLabel = WEEK_RANGE.formatRange(start, addDays(end, -1));
  const requestKey = `${storeSlug}/${startKey}/${revision}`;
  const loading = result?.key !== requestKey;
  const instances = loading ? NO_INSTANCES : result.instances;
  const error = loading ? "" : result.error;

  // Counts for the current week's instances, per driver tab.
  const driverCounts = useMemo(() => {
    const counts: Record<string, number> = {
      [ALL]: instances.length,
      [UNASSIGNED]: 0,
    };
    for (const d of drivers) counts[d.id] = 0;
    for (const inst of instances) {
      const key = inst.assignedDriverId ?? UNASSIGNED;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [instances, drivers]);

  // Filter the week's instances to the selected driver tab before grouping.
  const visibleInstances = useMemo(() => {
    if (activeDriverFilter === ALL) return instances;
    if (activeDriverFilter === UNASSIGNED) {
      return instances.filter((i) => !i.assignedDriverId);
    }
    return instances.filter((i) => i.assignedDriverId === activeDriverFilter);
  }, [instances, activeDriverFilter]);

  const instancesByDate = useMemo(() => {
    const map = new Map<string, CalendarInstance[]>();
    for (const instance of visibleInstances) {
      const current = map.get(instance.date) ?? [];
      current.push(instance);
      map.set(instance.date, current);
    }
    return map;
  }, [visibleInstances]);

  const heldCount = visibleInstances.filter((instance) => instance.isHeld).length;
  const ready = !loading && !error;
  const busy = pendingAction !== null;
  const driverOptions = [{ id: ALL, name: "All drivers" }, ...drivers];
  if ((ready && driverCounts[UNASSIGNED] > 0) || activeDriverFilter === UNASSIGNED) {
    driverOptions.push({ id: UNASSIGNED, name: "Unassigned" });
  }

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({
      start: startKey,
      end: endKey,
    });

    fetch(`/api/${storeSlug}/recurring/calendar?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as CalendarResponse & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error || "Failed to load recurring calendar");
        }
        if (!Array.isArray(body.instances)) throw new Error("Failed to load recurring calendar");
        if (controller.signal.aborted) return;
        const rows = body.instances;
        setResult({ key: requestKey, instances: rows, error: "" });
        setSelectedInstance((selected) => selected ? rows.find((row) => row.id === selected.id) ?? null : null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setResult({ key: requestKey, instances: NO_INSTANCES, error: err instanceof Error ? err.message : "Failed to load recurring calendar" });
        }
      });

    return () => controller.abort();
  }, [endKey, requestKey, startKey, storeSlug]);

  const showWeek = (week: Date) => {
    if (week.getTime() === start.getTime()) return;
    setVisibleWeek(week);
  };

  const toggleInstanceHold = async (instance: CalendarInstance) => {
    if (instance.holdType === "TEMPLATE") return;

    const holding = !instance.isHeld;
    const reason = holdReasonDraft.trim();
    if (holding && !reason) {
      setMutationError("Enter a reason for the hold.");
      return;
    }

    setPendingAction("hold");
    setMutationError("");

    const action = instance.isHeld ? "unskip" : "skip";
    const fallback = "Failed to update calendar hold";
    try {
      const res = await fetch(
        `/api/${storeSlug}/recurring/${instance.recurringOrderId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skipDate: instance.isHeld && instance.skipDate ? instance.skipDate : instance.date,
            // Resume Week undoes only the week skip, not a one-day hold under it.
            ...(instance.holdType === "WEEK" ? { scope: "WEEK" } : {}),
            ...(holding ? { reason } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMutationError(body.error || fallback);
        return;
      }

      // Re-read all effective holds. A resumed week can uncover a one-day hold.
      if (instance.holdType === "WEEK") setSelectedInstance(null);
      setHoldReasonDraft("");
      refreshCalendar();
      router.refresh();
    } catch {
      setMutationError(fallback);
    } finally {
      setPendingAction(null);
    }
  };

  const deleteRecurringProfile = async (instance: CalendarInstance) => {
    if (
      !(await confirm({
        message: "Delete this recurring profile? Existing delivery records will be preserved.",
        tone: "danger",
      }))
    ) {
      return;
    }

    setPendingAction("delete");
    setMutationError("");

    const fallback = "Failed to delete recurring profile";
    try {
      const res = await fetch(
        `/api/${storeSlug}/recurring/${instance.recurringOrderId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMutationError(body.error || fallback);
        return;
      }
      setSelectedInstance(null);
      refreshCalendar();
      router.refresh();
    } catch {
      setMutationError(fallback);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className={cn(card, styles.calendar)} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <h2 id={headingId} className={sectionTitle}>Recurring calendar</h2>
          <p className={styles.weekRange} aria-live="polite">
            {weekLabel}
          </p>
        </div>
        <div className={styles.navigation} role="group" aria-label="Calendar week">
          <button
            type="button"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => showWeek(addDays(start, -7))}
            className={styles.weekButton}
          >
            <ChevronLeft size={15} aria-hidden="true" /> Previous
          </button>
          <button
            type="button"
            onClick={() => showWeek(dateFromKey(vancouverWeekStartKey()))}
            className={styles.weekButton}
          >
            This week
          </button>
          <button
            type="button"
            aria-label="Next week"
            title="Next week"
            onClick={() => showWeek(addDays(start, 7))}
            className={styles.weekButton}
          >
            Next <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter deliveries by driver">
          {driverOptions.map((driver) => (
            <CalendarDriverTab
              key={driver.id}
              label={driver.name}
              count={ready ? driverCounts[driver.id] : null}
              active={activeDriverFilter === driver.id}
              onClick={() => setActiveDriverFilter(driver.id)}
            />
          ))}
        </div>
        <p className={styles.total} role="status">
          {loading && "Loading deliveries…"}
          {ready && (
            <>
              {visibleInstances.length - heldCount} scheduled
              {heldCount > 0 && ` · ${heldCount} on hold`}
            </>
          )}
        </p>
      </div>

      {error && (
        <div role="alert" className={cn(styles.loadError, BANNER_CLASSES.error)}>
          {error}
          <button type="button" onClick={refreshCalendar} className={button("secondary", "sm")}>
            Retry
          </button>
        </div>
      )}

      <ol className={styles.week} role="list" aria-label="Days of the week" aria-busy={loading} tabIndex={0}>
        {days.map((day) => {
          const key = dateKey(day);
          const dayInstances = ready ? instancesByDate.get(key) ?? [] : [];
          const today = key === todayKey;
          const empty = ready && dayInstances.length === 0;

          return (
            <li key={key} className={styles.day} data-today={today || undefined}>
              <h3>
                <span className={styles.weekday}>
                  <span aria-hidden="true">{WEEKDAY.format(day)}</span>
                  {today && <span className={styles.today}>Today</span>}
                </span>
                <span className={styles.dateRow}>
                  <time dateTime={key} aria-current={today ? "date" : undefined}>
                    <span className="sr-only">{FULL_DATE.format(day)}</span>
                    <span aria-hidden="true">{MONTH_DAY.format(day)}</span>
                  </time>
                  {dayInstances.length > 0 && (
                    <span className={styles.dayCount}>
                      {dayInstances.length}
                      <span className="sr-only">{dayInstances.length === 1 ? " delivery" : " deliveries"}</span>
                    </span>
                  )}
                </span>
              </h3>

              {empty && <p className={styles.emptyDay}>No deliveries</p>}
              {dayInstances.length > 0 && (
                <ul className={styles.entries} role="list">
                  {dayInstances.map((instance) => {
                    const hold = holdLabel(instance);
                    const details = [instance.deliveryCity, instance.assignedDriverName ?? "Unassigned"]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <li key={instance.id}>
                        <button
                          type="button"
                          className={styles.entry}
                          aria-haspopup="dialog"
                          title={`${instance.patientName} · ${details}`}
                          data-held={instance.isHeld || undefined}
                          onClick={() => {
                            setMutationError("");
                            setHoldReasonDraft("");
                            setSelectedInstance(instance);
                          }}
                        >
                          <span className={styles.patient}>{instance.patientName}</span>
                          {hold && <span className={styles.hold}>{hold}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <WeeklyHolds instances={instances} weekLabel={weekLabel} loading={loading} error={error} refresh={refreshCalendar} />

      <Modal
        open={!!selectedInstance}
        onClose={() => setSelectedInstance(null)}
        dismissible={!busy}
        size="lg"
        labelledBy={quickViewId}
      >
        {selectedInstance && (
          <div className="overflow-y-auto px-5 pb-5 pt-2 sm:pt-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 id={quickViewId} className={sectionTitle}>
                  {selectedInstance.patientName}
                </h3>
                <p className="text-sm text-muted">
                  {FULL_DATE.format(dateFromKey(selectedInstance.date))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInstance(null)}
                disabled={busy}
                className="rounded-full px-3 py-1 text-sm font-semibold text-muted transition duration-(--hover-ms) hover:bg-panel-cream hover:text-navy disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 rounded-row bg-panel-cream p-4">
              <QuickViewRow
                label="Address"
                value={`${selectedInstance.deliveryAddress}, ${selectedInstance.deliveryCity}`}
              />
              <QuickViewRow label="Zone" value={selectedInstance.zoneName} />
              <QuickViewRow
                label="Driver"
                value={selectedInstance.assignedDriverName ?? "Unassigned"}
              />
              <QuickViewRow
                label="Status"
                value={holdLabel(selectedInstance) ?? "Scheduled"}
              />
              {selectedInstance.generatedOrderStatus && (
                <QuickViewRow
                  label="Generated order"
                  value={selectedInstance.generatedOrderStatus.replaceAll("_", " ")}
                />
              )}
              {selectedInstance.isHeld && selectedInstance.holdReason && (
                <QuickViewRow
                  label="Hold reason"
                  value={selectedInstance.holdReason}
                />
              )}
            </div>

            {selectedInstance.holdType !== "TEMPLATE" && !selectedInstance.isHeld && (
              <div className="mt-4">
                <label htmlFor={reasonId} className={label}>
                  Reason for hold
                </label>
                <textarea
                  id={reasonId}
                  rows={2}
                  value={holdReasonDraft}
                  onChange={(event) => setHoldReasonDraft(event.target.value)}
                  disabled={busy}
                  className={input}
                />
              </div>
            )}

            {mutationError && (
              <p role="alert" className={cn("mt-4 rounded-row p-3 text-sm", BANNER_CLASSES.error)}>
                {mutationError}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {selectedInstance.holdType !== "TEMPLATE" && (
                <button
                  type="button"
                  onClick={() => toggleInstanceHold(selectedInstance)}
                  disabled={
                    busy || !ready ||
                    (!selectedInstance.isHeld && !holdReasonDraft.trim())
                  }
                  className={cn(button("secondary", "sm"), "justify-center")}
                >
                  {pendingAction === "hold"
                    ? "Updating…"
                    : selectedInstance.holdType === "WEEK"
                    ? "Resume week"
                    : selectedInstance.isHeld
                      ? "Resume delivery"
                      : "Hold delivery"}
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteRecurringProfile(selectedInstance)}
                disabled={busy}
                className={button("danger", "sm")}
              >
                {pendingAction === "delete" ? "Deleting…" : "Delete profile"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

function QuickViewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label font-bold uppercase tracking-label text-muted">
        {label}
      </p>
      <p className="text-sm font-medium text-ink">{value}</p>
    </div>
  );
}

function CalendarDriverTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={styles.filter}
    >
      <span>{label}</span>
      {count !== null && <span className={styles.filterCount}>{count}</span>}
    </button>
  );
}
