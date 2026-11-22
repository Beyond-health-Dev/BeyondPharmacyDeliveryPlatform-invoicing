"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Package,
  Search,
} from "lucide-react";
import artwork from "@/assets/delivery-dashboard-rainbow.webp";
import attentionIcon from "@/assets/delivery-icons/attention.webp";
import deliveredIcon from "@/assets/delivery-icons/delivered.webp";
import movingIcon from "@/assets/delivery-icons/moving.webp";
import totalIcon from "@/assets/delivery-icons/total.webp";
import DeliveryHero from "@/components/DeliveryHero";
import ExternalDispatchActions from "@/components/ExternalDispatchActions";
import NotificationPanel from "@/components/NotificationPanel";
import { WAITING_FILTER } from "@/lib/orderFilters";
import { statusTone } from "@/lib/statusTheme";

export type DashboardDelivery = {
  id: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  driverName: string | null;
  status: string;
  trackingLink: string | null;
  failedReason: string | null;
  createdAt: Date;
  isExternal: boolean;
  externalDispatchId: string | null;
  canCancelExternal: boolean;
  hasAnchorStop: boolean;
  statusLabel: string | null;
  statusNote: string | null;
  needsAttention: boolean;
};

const filters = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "moving", label: "On the road" },
  { value: "delivered", label: "Delivered" },
  { value: "attention", label: "Needs attention" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type Filter = (typeof filters)[number]["value"];

const metrics = [
  { key: "all", label: "Total deliveries", icon: totalIcon, tone: "blue" },
  { key: "moving", label: "On the road", icon: movingIcon, tone: "lilac" },
  { key: "delivered", label: "Delivered", icon: deliveredIcon, tone: "mint" },
  { key: "attention", label: "Needs attention", icon: attentionIcon, tone: "blush" },
] as const;

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function groupStatus(status: string): Exclude<Filter, "all"> {
  if (status === "DELIVERED") return "delivered";
  if (status === "CANCELLED") return "cancelled";
  const tone = statusTone(status);
  if (tone === "lilac") return "moving";
  if (tone === "blush") return "attention";
  return "queued";
}

function displayStatus(status: string) {
  const words = status.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function SpokeTracking({ delivery }: { delivery: DashboardDelivery }) {
  if (!delivery.isExternal) {
    return (
      <span className="delivery-tracking-note">
        <span aria-hidden="true">—</span>
        <span className="sr-only">In-house delivery</span>
      </span>
    );
  }
  if (delivery.status === "CANCELLED" || delivery.status === "DISPATCH_FAILED") {
    return <span className="delivery-tracking-note">Unavailable</span>;
  }
  if (delivery.trackingLink) {
    return (
      <a
        href={delivery.trackingLink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Track ${delivery.patientName}’s delivery in Spoke (opens in a new tab)`}
        className="delivery-text-link"
      >
        Track <ExternalLink size={13} aria-hidden="true" />
      </a>
    );
  }
  const finished = delivery.status === "DELIVERED" || delivery.status === "DELIVERY_FAILED";
  // A held Anchor order goes out at 6 AM, so Spoke can't have sent a link yet.
  const note = finished ? "Unavailable" : delivery.status === "SCHEDULED" ? "Not sent yet" : "Awaiting link";
  return <span className="delivery-tracking-note">{note}</span>;
}

// ARIA doesn't name a plain span, so the words are read from hidden text.
const noActions = (
  <span>
    <span aria-hidden="true">—</span>
    <span className="sr-only">No actions</span>
  </span>
);

export default function DashboardView({
  storeSlug,
  dayKey,
  deliveries,
  heldForAnchorCount,
}: {
  storeSlug: string;
  dayKey: string;
  deliveries: DashboardDelivery[];
  heldForAnchorCount: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const summary: Record<Filter, number> = {
    all: deliveries.length, queued: 0, moving: 0, delivered: 0, attention: 0, cancelled: 0,
  };
  const visibleDeliveries: DashboardDelivery[] = [];
  for (const order of deliveries) {
    const group = order.needsAttention ? "attention" : groupStatus(order.status);
    summary[group] += 1;
    if (filter === "cancelled" ? order.status !== "CANCELLED" : filter !== "all" && filter !== group) continue;
    const searchText = [
      order.patientName, order.deliveryAddress, order.deliveryCity, order.driverName,
    ].join(" ").toLowerCase();
    if (searchText.includes(query)) visibleDeliveries.push(order);
  }

  return (
    <div className="delivery-dashboard">
      <DeliveryHero title="Delivery overview" artwork={artwork} storeSlug={storeSlug}>
        <time dateTime={dayKey} className="delivery-date">
          <CalendarDays size={15} aria-hidden="true" />
          {dateFormat.format(new Date(dayKey + "T00:00:00Z"))}
        </time>
      </DeliveryHero>

      <section aria-label="Filter by delivery summary" className="delivery-metrics">
        {metrics.map(({ key, label, icon, tone }) => (
          <button
            key={key}
            type="button"
            data-tone={tone}
            aria-pressed={filter === key}
            aria-controls="delivery-queue"
            onClick={() => setFilter(key)}
            className="delivery-metric"
          >
            <Image src={icon} alt="" unoptimized draggable={false} className="delivery-metric-icon" />
            <span className="delivery-metric-copy">
              <span>{label}</span>
              <strong>{summary[key]}</strong>
            </span>
          </button>
        ))}
      </section>

      <div className="delivery-panels">
        <section className="delivery-panel" id="delivery-queue" aria-labelledby="delivery-queue-title">
          <div className="delivery-panel-heading">
            <h2 id="delivery-queue-title">Today&apos;s deliveries</h2>
            <Link href={"/" + storeSlug + "/orders"} className="delivery-text-link">
              View all orders <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {heldForAnchorCount > 0 && (
            <Link href={`/${storeSlug}/orders?status=${WAITING_FILTER}`} className="delivery-text-link delivery-waiting-link">
              {heldForAnchorCount} {heldForAnchorCount === 1 ? "order" : "orders"} waiting to go to Anchor
            </Link>
          )}
          <div className="delivery-toolbar">
            <label className="delivery-search">
              <Search size={17} strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only">Search deliveries</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search deliveries"
              />
            </label>
            <label className="delivery-filter">
              <span className="sr-only">Filter by status</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
                {filters.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          {visibleDeliveries.length > 0 ? (
            <table className="delivery-table" role="table" aria-labelledby="delivery-queue-title">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Patient</th>
                  <th scope="col" role="columnheader">Address</th>
                  <th scope="col" role="columnheader">Driver</th>
                  <th scope="col" role="columnheader">Status</th>
                  <th scope="col" role="columnheader">Spoke tracking</th>
                  <th scope="col" role="columnheader">Actions</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {visibleDeliveries.map((order) => (
                  <tr key={order.id} role="row">
                    <td role="cell" className="delivery-patient">{order.patientName}</td>
                    <td role="cell" className="delivery-address">
                      {order.deliveryAddress}
                      <span className="delivery-cell-detail">{order.deliveryCity}</span>
                    </td>
                    <td role="cell" className="delivery-driver">
                      {order.driverName || "Unassigned"}
                      {order.isExternal && <span className="delivery-cell-detail">Spoke</span>}
                    </td>
                    <td role="cell" className="delivery-state">
                      <span className="delivery-status" data-tone={order.needsAttention ? "blush" : statusTone(order.status)}>
                        {order.statusLabel ?? displayStatus(order.status)}
                      </span>
                      {order.statusNote && <span className="delivery-cell-detail">{order.statusNote}</span>}
                      {order.status === "FAILED" && order.failedReason && (
                        <span className="delivery-failed-reason">{order.failedReason}</span>
                      )}
                    </td>
                    <td role="cell" className="delivery-tracking"><SpokeTracking delivery={order} /></td>
                    <td role="cell" className="delivery-actions" data-external={order.isExternal}>
                      {order.isExternal ? (
                        <ExternalDispatchActions
                          dispatchId={order.externalDispatchId}
                          currentStatus={order.status}
                          canCancel={order.canCancelExternal}
                          hasAnchorStop={order.hasAnchorStop}
                          patientName={order.patientName}
                          onAttentionRow={order.needsAttention || groupStatus(order.status) === "attention"}
                          noAction={noActions}
                          storeSlug={storeSlug}
                        />
                      ) : (
                        noActions
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="delivery-empty">
              <Package size={23} strokeWidth={1.7} aria-hidden="true" />
              <p>{deliveries.length ? "No deliveries match these filters." : "No deliveries scheduled for today."}</p>
              {deliveries.length > 0 && (
                <button
                  type="button"
                  className="delivery-text-link"
                  onClick={() => { setFilter("all"); setSearch(""); }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
          <p className="delivery-count" role="status">
            Showing {visibleDeliveries.length} of {deliveries.length} deliveries
          </p>
        </section>
        <NotificationPanel key={storeSlug} storeSlug={storeSlug} />
      </div>
    </div>
  );
}
