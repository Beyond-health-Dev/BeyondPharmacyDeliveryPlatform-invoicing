import type { ComponentProps } from "react";
import RecurringCalendar from "./RecurringCalendar";
import RecurringLabelSheets from "./RecurringLabelSheets";
import RecurringOrderForm from "./RecurringOrderForm";
import RecurringOrderList from "./RecurringOrderList";
import PageHeader from "@/components/ui/PageHeader";
import { pageTitle } from "@/lib/portalStyles";

// Presentational screen; the page supplies the data. Kept separate so the
// dev-only style guide can render it from fixtures.
export default function RecurringView({
  storeSlug,
  weekStartKey,
  zones,
  drivers,
  zoneHistory,
  fallbackZoneId,
  orders,
}: {
  storeSlug: string;
  // This week's Sunday in Vancouver (YYYY-MM-DD), worked out on the server.
  weekStartKey: string;
  zones: ComponentProps<typeof RecurringOrderList>["zones"];
  drivers: ComponentProps<typeof RecurringOrderList>["drivers"];
  zoneHistory: ComponentProps<typeof RecurringOrderList>["zoneHistory"];
  fallbackZoneId: string | null;
  orders: ComponentProps<typeof RecurringOrderList>["orders"];
}) {
  return (
    <div>
      <PageHeader className="mb-8">
        <h1 className={pageTitle}>
          Recurring Deliveries, simplified
        </h1>
      </PageHeader>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <RecurringOrderForm
            storeSlug={storeSlug}
            zones={zones}
            drivers={drivers}
            zoneHistory={zoneHistory}
            fallbackZoneId={fallbackZoneId}
          />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <RecurringCalendar storeSlug={storeSlug} drivers={drivers} initialWeekStartKey={weekStartKey} />
          <div data-reveal="">
            <RecurringLabelSheets storeSlug={storeSlug} orders={orders} />
          </div>
          <div data-reveal="">
            <RecurringOrderList
              storeSlug={storeSlug}
              drivers={drivers}
              zones={zones}
              zoneHistory={zoneHistory}
              orders={orders}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
