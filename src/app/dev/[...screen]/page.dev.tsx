import { notFound } from "next/navigation";
import PharmacyShell from "@/components/PharmacyShell";
import DriverShell from "@/components/DriverShell";
import StorePickerView from "@/components/StorePickerView";
import DashboardView from "@/app/(pharmacy)/[store]/dashboard/DashboardView";
import OrdersView from "@/app/(pharmacy)/[store]/orders/OrdersView";
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
}: {
  params: Promise<{ screen: string[] }>;
}) {
  const { screen } = await params;
  return <DevFrame>{renderScreen(screen.join("/"))}</DevFrame>;
}

function renderScreen(path: string) {

  switch (path) {
    case "home":
      return <StorePickerView stores={fx.stores} />;
    case "dashboard":
    case "reminder-popup":
      return (
        <Pharmacy>
          <DashboardView storeSlug={slug} deliveries={fx.dashboardDeliveries} />
        </Pharmacy>
      );
    case "orders":
      return (
        <Pharmacy>
          <OrdersView
            storeSlug={slug}
            status={undefined}
            search=""
            limit={100}
            total={fx.orderCount}
            orderCount={fx.orderCount}
            groupedOrders={fx.groupedOrders}
            sortedDateKeys={fx.sortedDateKeys}
            drivers={fx.drivers}
            poll={false}
          />
        </Pharmacy>
      );
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
    case "recurring":
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
