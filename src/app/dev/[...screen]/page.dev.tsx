import { notFound } from "next/navigation";
import Link from "next/link";
import PharmacyShell from "@/components/PharmacyShell";
import DriverShell from "@/components/DriverShell";
import StorePickerView from "@/components/StorePickerView";
import DashboardView from "@/app/(pharmacy)/[store]/dashboard/DashboardView";
import OrdersView, { ORDER_STATUS_FILTERS } from "@/app/(pharmacy)/[store]/orders/OrdersView";
import NewOrderView from "@/app/(pharmacy)/[store]/orders/new/NewOrderView";
import RecurringView from "@/app/(pharmacy)/[store]/recurring/RecurringView";
import RemindersView from "@/app/(pharmacy)/[store]/reminders/RemindersView";
import PricingView from "@/app/(pharmacy)/[store]/pricing/PricingView";
import InvoicesView from "@/app/(pharmacy)/[store]/invoices/InvoicesView";
import UsersView from "@/app/(pharmacy)/[store]/users/UsersView";
import DeliveriesView from "@/app/(driver)/[store]/deliveries/DeliveriesView";
import DeliveryDetailView from "@/app/(driver)/[store]/deliver/[id]/DeliveryDetailView";
import EarningsView from "@/app/(driver)/[store]/earnings/EarningsView";
import DevFrame from "../_DevFrame";
import { deliveryDateDefault, vancouverWeekStartKey } from "@/lib/vancouverDate";
import { card, pageTitle, textLink } from "@/lib/portalStyles";
import { ANCHOR_ORDER_FILTERS, NOT_CONFIRMED_FILTER, WAITING_FILTER } from "@/lib/orderFilters";
import { FAILED_EXTERNAL_STATUSES, UNCONFIRMED_EXTERNAL_STATUSES } from "@/lib/externalDispatchStatus";
import * as fx from "../_fixtures";

function Pharmacy({ children }: { children: React.ReactNode }) {
  return (
    <PharmacyShell storeSlug={fx.DEV_STORE.slug} storeName={fx.DEV_STORE.name} navBasePath="/dev">
      {children}
    </PharmacyShell>
  );
}

function Driver({ children }: { children: React.ReactNode }) {
  return (
    <DriverShell storeSlug={fx.DEV_STORE.slug} navBasePath="/dev">
      {children}
    </DriverShell>
  );
}

const slug = fx.DEV_SLUG;

export default async function DevScreen({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string[] }>;
  searchParams: Promise<{ search?: string | string[]; status?: string | string[] }>;
}) {
  const [{ screen }, query] = await Promise.all([params, searchParams]);
  const search = typeof query.search === "string" ? query.search.trim() : "";
  const status = typeof query.status === "string" && (ORDER_STATUS_FILTERS.includes(query.status) || ANCHOR_ORDER_FILTERS.some((filter) => filter.key === query.status))
    ? query.status
    : undefined;
  return <DevFrame>{renderScreen(screen.join("/"), search, status)}</DevFrame>;
}

function renderScreen(path: string, search: string, status: string | undefined) {
  switch (path) {
    case "home":
      return <StorePickerView stores={fx.stores} />;
    case "dashboard":
    case "reminder-popup":
      return (
        <Pharmacy>
          <DashboardView
            storeSlug={slug}
            dayKey={fx.TODAY}
            deliveries={fx.dashboardDeliveries}
            heldForAnchorCount={fx.heldForAnchorCount}
          />
        </Pharmacy>
      );
    case "spoke-tracking/x1": {
      const sample = fx.dashboardDeliveries.find((delivery) => delivery.trackingLink === `/dev/${path}`);
      if (!sample) notFound();
      return (
        <Pharmacy>
          <section className={`${card} max-w-xl space-y-4 p-6`}>
            <h1 className={pageTitle}>Spoke tracking preview</h1>
            <p className="font-semibold text-navy">{sample.patientName} · {sample.deliveryCity}</p>
            <p className="text-sm text-muted">
              This sample delivery shows where tracking opens. Live deliveries open the tracking page supplied by Spoke.
            </p>
            <Link href="/dev/dashboard" className={textLink}>Back to dashboard</Link>
          </section>
        </Pharmacy>
      );
    }
    case "orders": {
      const searchTerm = search.toLowerCase();
      const groupedOrders = Object.fromEntries(
        Object.entries(fx.groupedOrders).map(([dateKey, orders]) => [
          dateKey,
          orders.filter((order) =>
            (!status || order.status === status || (order.isExternal && (
              (status === "FAILED" && FAILED_EXTERNAL_STATUSES.includes(order.status)) ||
              (status === WAITING_FILTER && order.status === "SCHEDULED") ||
              (status === NOT_CONFIRMED_FILTER && dateKey < fx.TODAY && UNCONFIRMED_EXTERNAL_STATUSES.includes(order.status))
            ))) &&
            order.patientName.toLowerCase().includes(searchTerm)
          ),
        ])
      );
      const sortedDateKeys = fx.sortedDateKeys.filter((dateKey) => groupedOrders[dateKey].length > 0);
      const orderCount = Object.values(groupedOrders).reduce((total, orders) => total + orders.length, 0);
      return (
        <Pharmacy>
          <OrdersView
            storeSlug={slug}
            status={status}
            search={search}
            limit={100}
            total={fx.orderCount}
            orderCount={orderCount}
            groupedOrders={groupedOrders}
            sortedDateKeys={sortedDateKeys}
            drivers={fx.drivers.filter((driver) => !driver.isExternal)}
            poll={false}
          />
        </Pharmacy>
      );
    }
    case "orders/new":
      return (
        <Pharmacy>
          <NewOrderView
            storeSlug={slug}
            zones={fx.activeZones}
            drivers={fx.drivers}
            zoneHistory={fx.zoneHistory}
            fallbackZoneId="z_surrey"
            dateDefault={deliveryDateDefault()}
          />
        </Pharmacy>
      );
    // Anchor is preselected; dated tomorrow, the order would be held for
    // tomorrow's 6 AM run, so the hint under the date shows.
    case "orders/new-anchor":
      return (
        <Pharmacy>
          <NewOrderView
            storeSlug={slug}
            zones={fx.activeZones}
            drivers={fx.drivers}
            zoneHistory={fx.zoneHistory}
            fallbackZoneId="z_surrey"
            dateDefault={{ dateKey: fx.day(1), nextDay: true }}
          />
        </Pharmacy>
      );
    case "recurring":
    // The Delivery Labels card's Rearrange panel, open.
    case "recurring/labels":
      return (
        <Pharmacy>
          <RecurringView
            storeSlug={slug}
            weekStartKey={vancouverWeekStartKey()}
            zones={fx.activeZones}
            drivers={fx.drivers}
            zoneHistory={fx.zoneHistory}
            fallbackZoneId="z_surrey"
            orders={fx.recurringOrders}
            defaultRearrangeOpen={path === "recurring/labels"}
          />
        </Pharmacy>
      );
    case "reminders":
      return (
        <Pharmacy>
          <RemindersView storeSlug={slug} profiles={fx.reminderProfiles} reminders={fx.reminders} />
        </Pharmacy>
      );
    case "pricing":
      return (
        <Pharmacy>
          <PricingView storeSlug={slug} zones={fx.pricingZones} drivers={fx.drivers} />
        </Pharmacy>
      );
    case "invoices":
      return (
        <Pharmacy>
          <InvoicesView storeSlug={slug} drivers={fx.drivers} invoices={fx.invoices} />
        </Pharmacy>
      );
    case "users":
      return (
        <Pharmacy>
          <UsersView storeSlug={slug} users={fx.users} />
        </Pharmacy>
      );
    case "deliveries":
      return (
        <Driver>
          <DeliveriesView
            storeSlug={slug}
            currentDateStr={fx.TODAY}
            todayKey={fx.TODAY}
            isToday
            selectedDateLabel={new Date(`${fx.TODAY}T12:00:00.000Z`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            pendingCount={3}
            completedCount={1}
            failedCount={1}
            deliveries={fx.driverDeliveries}
            eligibleForBatchDeliver={2}
            poll={false}
          />
        </Driver>
      );
    case "deliver/o1":
      return (
        <Driver>
          <DeliveryDetailView storeSlug={slug} order={fx.deliveryDetail} />
        </Driver>
      );
    case "earnings":
      return (
        <Driver>
          <EarningsView
            storeSlug={slug}
            range="week"
            totalCount={fx.earnings.length}
            totalEarnings={fx.earnings.reduce((sum, e) => sum + e.priceAtCreation, 0)}
            startStr={fx.day(-3)}
            endStr={fx.TODAY}
            deliveries={fx.earnings}
          />
        </Driver>
      );
    default:
      notFound();
  }
}
