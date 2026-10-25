"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useConfirm, usePromptDateRange } from "@/components/ui/DialogsProvider";
import {
  button,
  card,
  cn,
  dangerLinkButton,
  emptyState,
  input,
  linkButton,
  sectionTitle,
  statusBadgeClasses,
} from "@/lib/portalStyles";
import { BANNER_CLASSES } from "@/lib/statusTheme";
import {
  describeZoneSuggestion,
  suggestZone,
  type ZoneHistory,
} from "@/lib/zoneSuggestion";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

interface Driver {
  id: string;
  name: string;
  isExternal?: boolean;
}

interface ZoneOption {
  id: string;
  name: string;
  price: number;
}

interface RecurringOrderItem {
  id: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryZoneId: string;
  zoneName: string;
  zonePrice: number;
  activeDays: number[];
  recurrenceIntervalWeeks: number;
  recurrenceAnchorDate: string;
  isActive: boolean;
  isOnHold: boolean;
  holdStart: string | null;
  holdEnd: string | null;
  isSkippedThisWeek: boolean;
  heldDaysThisWeek: number;
  holdUpcoming: boolean;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
}

// Not on a vacation hold, or the hold hasn't started yet: deliveries (and so
// skipping them) still apply.
function deliveringThisWeek(order: Pick<RecurringOrderItem, "isOnHold" | "holdUpcoming">) {
  return !order.isOnHold || order.holdUpcoming;
}

function lastNameGroup(patientName: string) {
  const trimmed = patientName.trim();
  if (!trimmed) return "Unknown";

  const group = trimmed.includes(",")
    ? trimmed.split(",")[0]?.trim()
    : trimmed.split(/\s+/)[0]?.trim();

  return group || "Unknown";
}

export default function RecurringOrderList({
  orders,
  drivers,
  storeSlug,
  zones,
  zoneHistory,
}: {
  orders: RecurringOrderItem[];
  drivers: Driver[];
  storeSlug: string;
  zones: ZoneOption[];
  zoneHistory: ZoneHistory;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const promptDateRange = usePromptDateRange();
  const [loading, setLoading] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState("");
  const [actionError, setActionError] = useState("");
  const [activeDriverFilter, setActiveDriverFilter] = useState<string>(ALL);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingDaysId, setEditingDaysId] = useState<string | null>(null);
  const [draftActiveDays, setDraftActiveDays] = useState<number[]>([]);
  const [daysError, setDaysError] = useState("");
  // Moving a profile from Anchor to an in-house driver: staff confirm the zone
  // first, because from then on it sets the price on that driver's invoice.
  const [zoneConfirm, setZoneConfirm] = useState<{
    orderId: string;
    driverId: string | null;
    zoneId: string;
  } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );

  const driverCounts = useMemo(() => {
    const counts: Record<string, number> = { [ALL]: orders.length, [UNASSIGNED]: 0 };
    for (const d of drivers) counts[d.id] = 0;
    for (const o of orders) {
      const key = o.assignedDriverId ?? UNASSIGNED;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [orders, drivers]);

  const visibleOrders = useMemo(() => {
    if (activeDriverFilter === ALL) return orders;
    if (activeDriverFilter === UNASSIGNED) {
      return orders.filter((o) => !o.assignedDriverId);
    }
    return orders.filter((o) => o.assignedDriverId === activeDriverFilter);
  }, [orders, activeDriverFilter]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;

  // While searching we ignore the driver tab and scan the whole list; with no
  // query we fall back to the driver-filtered view.
  const displayOrders = useMemo(() => {
    if (!isSearching) return visibleOrders;
    return orders.filter(
      (o) =>
        o.patientName.toLowerCase().includes(trimmedQuery) ||
        o.deliveryAddress.toLowerCase().includes(trimmedQuery) ||
        o.deliveryCity.toLowerCase().includes(trimmedQuery)
    );
  }, [orders, visibleOrders, isSearching, trimmedQuery]);

  const groupedOrders = useMemo(() => {
    const groups = new Map<string, RecurringOrderItem[]>();
    for (const order of displayOrders) {
      const key = lastNameGroup(order.patientName);
      groups.set(key, [...(groups.get(key) ?? []), order]);
    }

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [displayOrders]);

  const generateToday = async () => {
    setGenerating(true);
    setGenerateMsg("");
    try {
      const res = await fetch(`/api/${storeSlug}/recurring/generate`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setGenerateMsg(
          data.message ||
            (data.created > 0
              ? `${data.created} order${data.created === 1 ? "" : "s"} generated for today.`
              : "Today\u2019s orders have already been generated.")
        );
        router.refresh();
      } else {
        setGenerateMsg("Failed to generate orders.");
      }
    } catch {
      setGenerateMsg("Network error. Please try again.");
    }
    setGenerating(false);
  };

  // Shared wrapper for row actions: surfaces server/network failures instead of
  // silently refreshing as if the update had succeeded.
  const runAction = async (id: string, request: () => Promise<Response>) => {
    setLoading(id);
    setActionError("");
    try {
      const res = await request();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error || "Update failed. Please try again.");
      }
    } catch {
      setActionError("Network error. Please try again.");
    }
    setLoading(null);
    router.refresh();
  };

  const patchRecurring = (id: string, payload: unknown) =>
    runAction(id, () =>
      fetch(`/api/${storeSlug}/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

  const toggleHold = async (id: string, isOnHold: boolean) => {
    if (!isOnHold) {
      // Ask for both dates in one dialog; cancelling leaves the profile as is.
      const range = await promptDateRange({
        title: "Vacation Hold",
        startLabel: "Hold start date",
        endLabel: "Hold end date",
      });
      if (!range) return;

      await patchRecurring(id, { isOnHold: true, holdStart: range.start, holdEnd: range.end });
    } else {
      await patchRecurring(id, { isOnHold: false });
    }
  };

  const toggleSkip = async (id: string, currentlySkipped: boolean) => {
    const action = currentlySkipped ? "unskip" : "skip";
    await runAction(id, () =>
      fetch(`/api/${storeSlug}/recurring/${id}/${action}`, { method: "POST" })
    );
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await patchRecurring(id, { isActive: !isActive });
  };

  const isExternalDriver = (driverId: string | null) =>
    !!driverId && !!drivers.find((d) => d.id === driverId)?.isExternal;

  const reassignDriver = async (order: RecurringOrderItem, assignedDriverId: string | null) => {
    const pending = zoneConfirm?.orderId === order.id ? zoneConfirm : null;
    if (isExternalDriver(order.assignedDriverId) && !isExternalDriver(assignedDriverId)) {
      if (pending) {
        // Changing the target driver keeps the zone staff may have adjusted.
        setZoneConfirm({ ...pending, driverId: assignedDriverId });
        return;
      }
      const suggestion = suggestZone({
        city: order.deliveryCity,
        zones,
        history: zoneHistory,
      });
      setZoneConfirm({
        orderId: order.id,
        driverId: assignedDriverId,
        zoneId:
          suggestion?.zoneId ??
          (zones.some((z) => z.id === order.deliveryZoneId) ? order.deliveryZoneId : ""),
      });
      return;
    }
    setZoneConfirm(null);
    // Picking the current driver again just closes a pending confirmation.
    if (assignedDriverId === order.assignedDriverId) return;
    await patchRecurring(order.id, { assignedDriverId });
  };

  const zoneConfirmHint = (order: RecurringOrderItem) => {
    const suggestion = suggestZone({ city: order.deliveryCity, zones, history: zoneHistory });
    const zone = suggestion && zones.find((z) => z.id === suggestion.zoneId);
    return suggestion && zone
      ? describeZoneSuggestion(suggestion, order.deliveryCity, zone.name)
      : `No past deliveries to ${order.deliveryCity} — choose the zone`;
  };

  const confirmZoneAndReassign = async () => {
    if (!zoneConfirm?.zoneId) return;
    const { orderId, driverId, zoneId } = zoneConfirm;
    setZoneConfirm(null);
    await patchRecurring(orderId, { assignedDriverId: driverId, deliveryZoneId: zoneId });
  };

  const startEditingDays = (order: RecurringOrderItem) => {
    setEditingDaysId(order.id);
    setDraftActiveDays([...order.activeDays].sort((a, b) => a - b));
    setDaysError("");
  };

  const toggleDraftDay = (day: number) => {
    setDraftActiveDays((current) => {
      if (current.includes(day)) {
        return current.filter((activeDay) => activeDay !== day);
      }
      return [...current, day].sort((a, b) => a - b);
    });
    setDaysError("");
  };

  const cancelEditingDays = () => {
    setEditingDaysId(null);
    setDraftActiveDays([]);
    setDaysError("");
  };

  const saveActiveDays = async (id: string) => {
    if (draftActiveDays.length === 0) {
      setDaysError("Select at least one delivery day.");
      return;
    }

    setLoading(id);
    setDaysError("");
    try {
      const res = await fetch(`/api/${storeSlug}/recurring/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeDays: draftActiveDays }),
      });

      if (!res.ok) {
        let message = "Failed to update delivery days.";
        try {
          const data = await res.json();
          message = data.error || message;
        } catch {
          // Keep the plain fallback when the server cannot return JSON.
        }
        setDaysError(message);
        return;
      }

      setEditingDaysId(null);
      setDraftActiveDays([]);
      router.refresh();
    } catch {
      setDaysError("Network error. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  const deleteOrder = async (id: string) => {
    if (
      !(await confirm({
        message:
          "Are you sure you want to delete this recurring order? This cannot be undone. Existing delivery records will be preserved.",
        tone: "danger",
      }))
    ) {
      return;
    }
    await runAction(id, () =>
      fetch(`/api/${storeSlug}/recurring/${id}`, { method: "DELETE" })
    );
  };

  const scheduleText = (order: RecurringOrderItem) => {
    const days = order.activeDays.map((d) => DAYS[d]).join(", ");
    if (order.recurrenceIntervalWeeks === 2) {
      return `Every other ${days}`;
    }
    return `Weekly on ${days}`;
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="px-6 py-4 border-b border-hairline flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className={sectionTitle}>Recurring Profiles</h2>
        <div className="flex flex-wrap items-center gap-3">
          {generateMsg && (
            <span role="status" className="text-xs font-bold text-navy bg-mint px-2.5 py-1 rounded-full">{generateMsg}</span>
          )}
          <a
            href={`/api/${storeSlug}/recurring/export`}
            className={button("secondary", "sm")}
          >
            Export Today&apos;s CSV
          </a>
          <button
            onClick={generateToday}
            disabled={generating}
            className={button("primary", "sm")}
          >
            {generating ? "Generating..." : "Generate Today\u2019s Orders"}
          </button>
        </div>
      </div>
      <div className="px-6 py-3 border-b border-hairline">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={"Search by patient name, address, or city…"}
          aria-label="Search recurring profiles"
          className={input}
        />
        {isSearching && (
          <p className="mt-1 text-xs text-muted">
            {displayOrders.length} match{displayOrders.length === 1 ? "" : "es"} across all profiles
            {activeDriverFilter !== ALL ? " (driver filter ignored while searching)" : ""}
          </p>
        )}
      </div>
      {actionError && (
        <div role="alert" className={cn("border-b border-hairline px-6 py-3 text-sm", BANNER_CLASSES.error)}>
          {actionError}
        </div>
      )}
      <div className="px-6 py-3 border-b border-hairline flex flex-wrap gap-2">
        <DriverTab
          label="All"
          count={driverCounts[ALL]}
          active={activeDriverFilter === ALL}
          onClick={() => setActiveDriverFilter(ALL)}
        />
        <DriverTab
          label="Unassigned"
          count={driverCounts[UNASSIGNED] ?? 0}
          active={activeDriverFilter === UNASSIGNED}
          onClick={() => setActiveDriverFilter(UNASSIGNED)}
        />
        {drivers.map((d) => (
          <DriverTab
            key={d.id}
            label={d.name}
            count={driverCounts[d.id] ?? 0}
            active={activeDriverFilter === d.id}
            onClick={() => setActiveDriverFilter(d.id)}
          />
        ))}
      </div>
      {displayOrders.length === 0 ? (
        <div className={cn(emptyState, "m-4")}>
          {isSearching
            ? <>No recurring profiles match <span className="text-navy">&ldquo;{searchQuery.trim()}&rdquo;</span>.</>
            : orders.length === 0
              ? <>No recurring orders <span className="text-navy">configured</span>.</>
              : <>No recurring orders for this <span className="text-navy">driver</span>.</>}
        </div>
      ) : (
        <div className="divide-y divide-hairline">
          {groupedOrders.map(([group, groupOrders]) => {
            const isExpanded = isSearching || expandedGroups.has(group);
            const groupId = `recurring-group-${group
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")}`;

            return (
              <section key={group}>
                <button
                  type="button"
                  aria-controls={groupId}
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(group)}
                  className="row-hover flex w-full items-center justify-between px-6 py-3 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`text-sm text-navy transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    >
                      ›
                    </span>
                    <span className="text-sm font-bold text-navy">
                      {group}
                    </span>
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-muted tabular-nums ring-1 ring-inset ring-hairline">
                    {groupOrders.length}
                  </span>
                </button>

                {isExpanded && (
                  <div id={groupId} className="divide-y divide-hairline">
                    {groupOrders.map((order) => (
                      <div key={order.id} className="px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-semibold text-navy">{order.patientName}</p>
                          <p className="text-sm text-muted">{order.deliveryAddress}, {order.deliveryCity}</p>
                          <p className="text-sm text-muted">{order.zoneName} — ${order.zonePrice.toFixed(2)} • {scheduleText(order)}</p>
                          {editingDaysId === order.id ? (
                            <div className="mt-3 rounded-row border border-hairline bg-white p-3 shadow-soft">
                              <div className="flex flex-wrap gap-1.5">
                                {DAYS.map((day, index) => {
                                  const selected = draftActiveDays.includes(index);
                                  return (
                                    <button
                                      key={day}
                                      type="button"
                                      onClick={() => toggleDraftDay(index)}
                                      disabled={loading === order.id}
                                      className="selectable inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold active:scale-(--press-scale) disabled:opacity-50"
                                      aria-pressed={selected}
                                    >
                                      <span className="select-dot" aria-hidden="true" />
                                      {day}
                                    </button>
                                  );
                                })}
                              </div>
                              {daysError && (
                                <p className="mt-2 text-xs font-medium text-danger">{daysError}</p>
                              )}
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveActiveDays(order.id)}
                                  disabled={loading === order.id || draftActiveDays.length === 0}
                                  className={button("primary", "sm")}
                                >
                                  {loading === order.id ? "Saving..." : "Save Days"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditingDays}
                                  disabled={loading === order.id}
                                  className={button("secondary", "sm")}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditingDays(order)}
                              className={cn(linkButton, "mt-2 text-xs")}
                            >
                              Edit Days
                            </button>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted">Driver:</span>
                            <select
                              value={
                                zoneConfirm?.orderId === order.id
                                  ? (zoneConfirm.driverId ?? "")
                                  : order.assignedDriverId || ""
                              }
                              onChange={(e) => reassignDriver(order, e.target.value || null)}
                              disabled={loading === order.id}
                              className={`${input} text-xs py-1`}
                            >
                              <option value="">Zone default</option>
                              {drivers.map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                              ))}
                            </select>
                          </div>
                          {zoneConfirm?.orderId === order.id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-row bg-butter px-3 py-2">
                              <span className="text-xs font-semibold text-navy">
                                Confirm the zone for{" "}
                                {drivers.find((d) => d.id === zoneConfirm.driverId)?.name ??
                                  "the zone default driver"}
                                &apos;s invoice:
                              </span>
                              <select
                                value={zoneConfirm.zoneId}
                                onChange={(e) =>
                                  setZoneConfirm({ ...zoneConfirm, zoneId: e.target.value })
                                }
                                className={`${input} w-auto text-xs py-1`}
                              >
                                <option value="">Select zone...</option>
                                {zones.map((z) => (
                                  <option key={z.id} value={z.id}>
                                    {z.name} — ${z.price.toFixed(2)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={confirmZoneAndReassign}
                                disabled={!zoneConfirm.zoneId || loading === order.id}
                                className="text-xs font-bold text-navy underline-offset-2 hover:underline disabled:opacity-50"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setZoneConfirm(null)}
                                className="text-xs font-semibold text-navy underline-offset-2 hover:underline"
                              >
                                Cancel
                              </button>
                              <p className="w-full text-xs text-navy">{zoneConfirmHint(order)}</p>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {order.isOnHold && (
                            <span className={statusBadgeClasses("HOLD")}>
                              {/* Hold dates are stored as UTC midnight; format in UTC so the
                                  badge doesn't show the previous day in local time. */}
                              {order.holdUpcoming ? "Upcoming hold" : "On Hold"} {order.holdStart && order.holdEnd
                                ? `${new Date(order.holdStart).toLocaleDateString(undefined, { timeZone: "UTC" })} – ${new Date(order.holdEnd).toLocaleDateString(undefined, { timeZone: "UTC" })}`
                                : ""}
                            </span>
                          )}
                          {order.isSkippedThisWeek && deliveringThisWeek(order) && (
                            <span className={statusBadgeClasses("SKIPPED")}>Skipped this week</span>
                          )}
                          {!order.isSkippedThisWeek && order.heldDaysThisWeek > 0 && deliveringThisWeek(order) && (
                            <span className={statusBadgeClasses("SKIPPED")}>
                              {order.heldDaysThisWeek === 1
                                ? "1 day held this week"
                                : `${order.heldDaysThisWeek} days held this week`}
                            </span>
                          )}
                          {!order.isActive && (
                            <span className={statusBadgeClasses("INACTIVE")}>Inactive</span>
                          )}
                          {order.isActive && (
                            <button onClick={() => toggleHold(order.id, order.isOnHold)} disabled={loading === order.id}
                              className={button("secondary", "sm")}>
                              {order.isOnHold ? "Remove Hold" : "Vacation Hold"}
                            </button>
                          )}
                          {order.isActive && deliveringThisWeek(order) && (
                            <button onClick={() => toggleSkip(order.id, order.isSkippedThisWeek)} disabled={loading === order.id}
                              className={button("secondary", "sm")}>
                              {order.isSkippedThisWeek ? "Unskip" : "Skip This Week"}
                            </button>
                          )}
                          <button onClick={() => toggleActive(order.id, order.isActive)} disabled={loading === order.id}
                            className="text-xs text-muted hover:text-navy font-semibold disabled:opacity-50">
                            {order.isActive ? "Deactivate" : "Activate"}
                          </button>
                          <button onClick={() => deleteOrder(order.id)} disabled={loading === order.id}
                            className={cn(dangerLinkButton, "text-xs")}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DriverTab({
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
