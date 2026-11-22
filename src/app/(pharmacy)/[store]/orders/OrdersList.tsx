"use client";

import { useState } from "react";
import ExternalDispatchActions from "@/components/ExternalDispatchActions";
import OrderActions from "./OrderActions";
import {
  card,
  cn,
  sectionTitle,
  statusBadgeClasses,
  tableHeader,
  tableRow,
} from "@/lib/portalStyles";
import { toneBadgeClasses } from "@/lib/statusTheme";
import type { SerializedOrder } from "./OrdersView";

interface OrdersListProps {
  groupedOrders: Record<string, SerializedOrder[]>;
  sortedDateKeys: string[];
  storeSlug: string;
  drivers: { id: string; name: string }[];
  statusColors: Record<string, string>;
}

function formatDateHeading(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function OrdersList({
  groupedOrders,
  sortedDateKeys,
  storeSlug,
  drivers,
  statusColors,
}: OrdersListProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(
    () => new Set(sortedDateKeys)
  );

  const toggleDay = (dateKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {sortedDateKeys.map((dateKey) => {
        const orders = groupedOrders[dateKey];
        const isExpanded = expandedDays.has(dateKey);

        return (
          <div key={dateKey} className={`${card} overflow-hidden`}>
            {/* Accordion Header */}
            <button
              onClick={() => toggleDay(dateKey)}
              aria-expanded={isExpanded}
              className="row-hover w-full flex items-center justify-between px-6 py-4"
            >
              <div className="flex items-center space-x-3">
                <svg
                  className={`h-5 w-5 text-navy transition-transform duration-200 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className={sectionTitle}>
                  {formatDateHeading(dateKey)}
                </span>
              </div>
              <span className={`${toneBadgeClasses("mint")} whitespace-nowrap`}>
                {orders.length} {orders.length === 1 ? "order" : "orders"}
              </span>
            </button>

            {/* Accordion Body */}
            {isExpanded && (
              <div className="border-t border-hairline overflow-x-auto">
                <table className="w-full">
                  <thead className={tableHeader}>
                    <tr>
                      <th className="px-6 py-3">Patient</th>
                      <th className="px-6 py-3">Address</th>
                      <th className="px-6 py-3">Zone</th>
                      <th className="px-6 py-3">Price</th>
                      <th className="px-6 py-3">Driver</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {orders.map((order) => (
                      <tr key={order.id} className={tableRow}>
                        <td className="px-6 py-4 text-sm font-semibold text-navy">{order.patientName}</td>
                        <td className="px-6 py-4 text-sm text-ink">{order.deliveryAddress}, {order.deliveryCity}</td>
                        <td className="px-6 py-4 text-sm text-ink">{order.deliveryZoneName}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-navy tabular-nums">${order.priceAtCreation.toFixed(2)}</td>
                        <td className="px-6 py-4 text-sm text-ink">
                          <span>{order.assignedDriverName || "Unassigned"}</span>
                          {order.isExternal && (
                            <span className="ml-2 inline-flex rounded-full bg-blue px-2 py-0.5 text-xs font-bold text-navy">
                              {order.externalProvider}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {/* No wrapping: the table scrolls sideways on a phone instead. */}
                          {/* A held order that missed its send looks like a failed one. */}
                          <span
                            className={cn(
                              order.needsAttention
                                ? statusBadgeClasses("FAILED")
                                : statusColors[order.status] || statusBadgeClasses(order.status),
                              "whitespace-nowrap"
                            )}
                          >
                            {order.statusLabel ?? order.status.replace(/_/g, " ")}
                          </span>
                          {/* Notes can run to two sentences: they wrap, the badge doesn't. */}
                          {order.statusNote && (
                            <p className="mt-1 min-w-48 max-w-64 text-xs font-medium text-muted">{order.statusNote}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {order.isExternal ? (
                            <ExternalDispatchActions
                              dispatchId={order.externalDispatchId}
                              currentStatus={order.status}
                              canCancel={order.canCancelExternal}
                              hasAnchorStop={order.hasAnchorStop}
                              storeSlug={storeSlug}
                              patientName={order.patientName}
                            />
                          ) : (
                            <OrderActions
                              orderId={order.id}
                              currentStatus={order.status}
                              currentDriverId={order.assignedDriverId}
                              cancelledAt={order.cancelledAt}
                              storeSlug={storeSlug}
                              drivers={drivers}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
