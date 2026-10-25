"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { BANNER_CLASSES, TONE_CLASSES, statusTone } from "@/lib/statusTheme";
import { vancouverWeekStartKey } from "@/lib/vancouverDate";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

interface Driver {
  id: string;
  name: string;
}

interface CalendarInstance {
  id: string;
  recurringOrderId: string;
  date: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  zoneName: string;
  assignedDriverName: string | null;
  assignedDriverId: string | null;
  isHeld: boolean;
  holdType: "INSTANCE" | "TEMPLATE" | null;
  skipDate: string | null;
  holdReason: string | null;
  generatedOrderStatus: string | null;
}

interface CalendarResponse {
  instances: CalendarInstance[];
}

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

function formatWeekRange(start: Date, end: Date) {
  const rangeEnd = addDays(end, -1);
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel = rangeEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel} - ${endLabel}`;
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function RecurringCalendar({
  storeSlug,
  drivers,
  initialWeekStartKey,
}: {
  storeSlug: string;
  drivers: Driver[];
  // From the server, so the server render and the browser open on the same
  // week even if the browser's clock is off.
  initialWeekStartKey: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [visibleWeek, setVisibleWeek] = useState(() => dateFromKey(initialWeekStartKey));
  const [instances, setInstances] = useState<CalendarInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyInstance, setBusyInstance] = useState<string | null>(null);
  const [selectedInstance, setSelectedInstance] =
    useState<CalendarInstance | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
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

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({
      start: dateKey(start),
      end: dateKey(end),
    });

    fetch(`/api/${storeSlug}/recurring/calendar?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as CalendarResponse & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error || "Failed to load recurring calendar");
        }
        setInstances(body.instances ?? []);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load recurring calendar");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [end, refreshToken, start, storeSlug]);

  const showWeek = (week: Date) => {
    setLoading(true);
    setError("");
    setVisibleWeek(weekStart(week));
  };

  const toggleInstanceHold = async (instance: CalendarInstance) => {
    if (instance.holdType === "TEMPLATE") return;

    const holding = !instance.isHeld;
    const reason = holdReasonDraft.trim();
    if (holding && !reason) {
      setError("Enter a reason for the hold.");
      return;
    }

    setBusyInstance(instance.id);
    setError("");

    const action = instance.isHeld ? "unskip" : "skip";
    const res = await fetch(
      `/api/${storeSlug}/recurring/${instance.recurringOrderId}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skipDate: instance.isHeld && instance.skipDate ? instance.skipDate : instance.date,
          ...(holding ? { reason } : {}),
        }),
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to update calendar hold");
    } else {
      setSelectedInstance({
        ...instance,
        isHeld: holding,
        holdType: holding ? "INSTANCE" : null,
        skipDate: holding ? instance.date : null,
        holdReason: holding ? reason : null,
      });
      setHoldReasonDraft("");
      setLoading(true);
      setRefreshToken((value) => value + 1);
      router.refresh();
    }

    setBusyInstance(null);
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

    setBusyInstance(instance.id);
    setError("");

    const res = await fetch(
      `/api/${storeSlug}/recurring/${instance.recurringOrderId}`,
      { method: "DELETE" }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Failed to delete recurring profile");
    } else {
      setSelectedInstance(null);
      setLoading(true);
      setRefreshToken((value) => value + 1);
      router.refresh();
    }

    setBusyInstance(null);
  };

  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-hairline px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className={sectionTitle}>Recurring Calendar</h2>
          <p className="text-sm text-muted">{formatWeekRange(start, end)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => showWeek(addDays(visibleWeek, -7))}
            className={button("secondary", "sm")}
          >
            Previous Week
          </button>
          <button
            type="button"
            onClick={() => showWeek(dateFromKey(vancouverWeekStartKey()))}
            className={button("primary", "sm")}
          >
            This Week
          </button>
          <button
            type="button"
            onClick={() => showWeek(addDays(visibleWeek, 7))}
            className={button("secondary", "sm")}
          >
            Next Week
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-6 py-3">
        <CalendarDriverTab
          label="All"
          count={driverCounts[ALL]}
          active={activeDriverFilter === ALL}
          onClick={() => setActiveDriverFilter(ALL)}
        />
        {driverCounts[UNASSIGNED] > 0 && (
          <CalendarDriverTab
            label="Unassigned"
            count={driverCounts[UNASSIGNED]}
            active={activeDriverFilter === UNASSIGNED}
            onClick={() => setActiveDriverFilter(UNASSIGNED)}
          />
        )}
        {drivers.map((d) => (
          <CalendarDriverTab
            key={d.id}
            label={d.name}
            count={driverCounts[d.id] ?? 0}
            active={activeDriverFilter === d.id}
            onClick={() => setActiveDriverFilter(d.id)}
          />
        ))}
      </div>

      {error && (
        <div role="alert" className={cn("border-b border-hairline px-6 py-3 text-sm", BANNER_CLASSES.error)}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-7 bg-navy">
        {DAY_LABELS.map((day) => (
          <div
            key={day}
            className="px-2 py-2 text-center text-xs font-bold uppercase tracking-table text-cream"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          const dayInstances = instancesByDate.get(key) ?? [];

          return (
            <div
              key={key}
              className="min-h-48 border-b border-hairline p-2 sm:border-r"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-navy">
                  {formatDayLabel(day)}
                </span>
                {dayInstances.length > 0 && (
                  <span className="rounded-full bg-white px-2 py-0.5 text-label font-bold text-muted tabular-nums ring-1 ring-inset ring-hairline">
                    {dayInstances.length}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="rounded-row bg-white px-2 py-2 text-xs text-muted">
                  Loading...
                </div>
              ) : (
                <div className="space-y-1">
                  {dayInstances.map((instance) => {
                    const isBusy = busyInstance === instance.id;

                    return (
                      <button
                        key={instance.id}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setHoldReasonDraft("");
                          setSelectedInstance(instance);
                        }}
                        title={
                          instance.isHeld && instance.holdReason
                            ? `On hold: ${instance.holdReason}`
                            : instance.patientName
                        }
                        className={cn(
                          "block w-full truncate rounded-full px-2.5 py-1 text-left text-label font-semibold transition duration-(--hover-ms) active:scale-(--press-scale) disabled:cursor-not-allowed disabled:opacity-70",
                          instance.isHeld
                            ? cn(TONE_CLASSES[statusTone("HOLD")], "hover:bg-blush-hover")
                            : "row-hover text-navy ring-1 ring-inset ring-hairline hover:ring-control-hover"
                        )}
                      >
                        {isBusy ? "Updating..." : instance.patientName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Modal
        open={!!selectedInstance}
        onClose={() => setSelectedInstance(null)}
        size="lg"
        labelledBy="recurring-quick-view-title"
      >
        {selectedInstance && (
          <div className="overflow-y-auto px-5 pb-5 pt-2 sm:pt-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="recurring-quick-view-title"
                  className={sectionTitle}
                >
                  {selectedInstance.patientName}
                </h3>
                <p className="text-sm text-muted">
                  {formatDayLabel(new Date(`${selectedInstance.date}T00:00:00.000Z`))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInstance(null)}
                className="rounded-full px-3 py-1 text-sm font-semibold text-muted transition duration-(--hover-ms) hover:bg-panel-cream hover:text-navy"
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
                value={
                  selectedInstance.holdType === "TEMPLATE"
                    ? "Vacation hold"
                    : selectedInstance.isHeld
                      ? "Hold active"
                      : "Active"
                }
              />
              {selectedInstance.generatedOrderStatus && (
                <QuickViewRow
                  label="Generated order"
                  value={selectedInstance.generatedOrderStatus.replace("_", " ")}
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
                <label htmlFor="hold-reason" className={label}>
                  Reason for hold
                </label>
                <textarea
                  id="hold-reason"
                  rows={2}
                  value={holdReasonDraft}
                  onChange={(event) => setHoldReasonDraft(event.target.value)}
                  placeholder="e.g. Patient in hospital until next week"
                  className={input}
                />
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              {selectedInstance.holdType === "TEMPLATE" ? (
                <span className={cn("rounded-full px-3 py-2 text-center text-xs font-bold", TONE_CLASSES[statusTone("HOLD")])}>
                  Vacation hold
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleInstanceHold(selectedInstance)}
                  disabled={
                    busyInstance === selectedInstance.id ||
                    (!selectedInstance.isHeld && !holdReasonDraft.trim())
                  }
                  className={cn(button("secondary", "sm"), "justify-center")}
                >
                  {busyInstance === selectedInstance.id
                    ? "Updating..."
                    : selectedInstance.isHeld
                      ? "Resume"
                      : "Hold"}
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteRecurringProfile(selectedInstance)}
                disabled={busyInstance === selectedInstance.id}
                className={button("danger", "sm")}
              >
                {busyInstance === selectedInstance.id ? "Working..." : "Delete"}
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
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="selectable inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold active:scale-(--press-scale)"
    >
      <span className="select-dot" aria-hidden="true" />
      <span>
        {label} <span className="text-ink tabular-nums">({count})</span>
      </span>
    </button>
  );
}
