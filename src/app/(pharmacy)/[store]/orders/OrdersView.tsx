import Link from "next/link";
import OrdersPoller from "./OrdersPoller";
import OrdersList from "./OrdersList";
import PageHeader from "@/components/ui/PageHeader";
import { ANCHOR_ORDER_FILTERS } from "@/lib/orderFilters";
import {
  cn,
  ctaShadow,
  emptyState,
  input,
  pageAction,
  pageTitle,
  primaryButton,
  secondaryButton,
  selectablePill,
  statusBadgeClasses,
} from "@/lib/portalStyles";

export const ORDER_STATUS_FILTERS = [
  "PENDING",
  "ASSIGNED",
  "SUBMITTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "DELIVERY_FAILED",
  "CANCELLED",
];

// Every pill: the status filters by name, then the Anchor-only ones
// (src/lib/orderFilters.ts), which read in plain words.
const FILTER_PILLS = [
  ...ORDER_STATUS_FILTERS.map((key) => ({ key, label: key.replace(/_/g, " ") })),
  ...ANCHOR_ORDER_FILTERS,
];

export type SerializedOrder = {
  id: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  scheduledDate: string;
  deliveryZoneName: string;
  priceAtCreation: number;
  status: string;
  assignedDriverId: string | null;
  assignedDriverName: string | null;
  cancelledAt: string | null;
  createdAt: string;
  isExternal: boolean;
  externalProvider: string | null;
  externalDispatchId: string | null;
  canCancelExternal: boolean;
  // Anchor rows only (null / false in-house), worked out on the server: the
  // badge text, a short line under it such as when Anchor gets the order,
  // and whether a held order missed its send (shown like a failed one).
  statusLabel: string | null;
  statusNote: string | null;
  needsAttention: boolean;
};

// Presentational orders screen; the page supplies the data. Kept separate so
// the dev-only style guide can render it from fixtures.
export default function OrdersView({
  storeSlug,
  status,
  search,
  limit,
  total,
  orderCount,
  groupedOrders,
  sortedDateKeys,
  drivers,
  poll = true,
}: {
  storeSlug: string;
  status: string | undefined;
  search: string;
  limit: number;
  total: number;
  orderCount: number;
  groupedOrders: Record<string, SerializedOrder[]>;
  sortedDateKeys: string[];
  drivers: { id: string; name: string }[];
  poll?: boolean;
}) {
  return (
    <div>
      {poll && <OrdersPoller />}
      <PageHeader className="flex items-center justify-between mb-8">
        <h1 className={pageTitle}>
          Orders, organized
        </h1>
        <Link
          href={`/${storeSlug}/orders/new`}
          className={cn(primaryButton, ctaShadow, pageAction)}
        >
          + New Order
        </Link>
      </PageHeader>

      {/* Search Bar */}
      <form method="GET" className="mb-4">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            name="search"
            placeholder="Search by patient name..."
            defaultValue={search}
            className={`${input} pl-10`}
          />
        </div>
      </form>

      {/* Status Filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Link
          href={`/${storeSlug}/orders${search ? `?search=${encodeURIComponent(search)}` : ""}`}
          aria-current={!status ? "page" : undefined}
          className={cn(selectablePill, "inline-flex items-center gap-2")}
        >
          <span className="select-dot" aria-hidden="true" />
          All ({total})
        </Link>
        {FILTER_PILLS.map(
          ({ key, label }) => (
            <Link
              key={key}
              href={`/${storeSlug}/orders?status=${key}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
              aria-current={status === key ? "page" : undefined}
              className={cn(selectablePill, "inline-flex items-center gap-2")}
            >
              <span className="select-dot" aria-hidden="true" />
              {label}
            </Link>
          )
        )}
      </div>

      {/* Grouped Orders */}
      {orderCount === 0 ? (
        <div className={emptyState}>
          {search ? `No orders found for "${search}".` : <>No orders <span className="text-navy">found</span>.</>}
        </div>
      ) : (
        <OrdersList
          groupedOrders={groupedOrders}
          sortedDateKeys={sortedDateKeys}
          storeSlug={storeSlug}
          drivers={drivers}
          statusColors={Object.fromEntries(
            ORDER_STATUS_FILTERS.map((s) => [s, statusBadgeClasses(s)])
          )}
        />
      )}

      {/* Load More */}
      {limit < total && (
        <div className="mt-4 text-center">
          <Link
            href={`/${storeSlug}/orders?limit=${limit + 100}${status ? `&status=${status}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
            className={cn(secondaryButton, "inline-block")}
          >
            Load More ({total - limit} remaining)
          </Link>
        </div>
      )}
    </div>
  );
}
