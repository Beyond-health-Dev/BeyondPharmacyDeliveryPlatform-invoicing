import type { ComponentProps } from "react";
import { Plus } from "lucide-react";
import RecurringCalendar from "./RecurringCalendar";
import RecurringLabelSheets from "./RecurringLabelSheets";
import RecurringOrderForm from "./RecurringOrderForm";
import RecurringOrderList from "./RecurringOrderList";
import PageHeader from "@/components/ui/PageHeader";
import { cn, pageTitle, primaryButton } from "@/lib/portalStyles";
import { vancouverTodayKey } from "@/lib/vancouverDate";

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
  defaultRearrangeOpen = false,
}: {
  storeSlug: string;
  // This week's Sunday in Vancouver (YYYY-MM-DD), worked out on the server.
  weekStartKey: string;
  zones: ComponentProps<typeof RecurringOrderList>["zones"];
  drivers: ComponentProps<typeof RecurringOrderList>["drivers"];
  zoneHistory: ComponentProps<typeof RecurringOrderList>["zoneHistory"];
  fallbackZoneId: string | null;
  orders: ComponentProps<typeof RecurringOrderList>["orders"];
  // Opens the label card's Rearrange panel on load (the style guide's screen).
  defaultRearrangeOpen?: boolean;
}) {
  return (
    <div className="space-y-5">
      <PageHeader className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h1 className={pageTitle}>Recurring deliveries</h1>
        <a
          href="#new-recurring-profile"
          className={cn(primaryButton, "inline-flex min-h-11 items-center gap-2")}
        >
          <Plus size={17} aria-hidden="true" />
          New recurring profile
        </a>
      </PageHeader>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(17rem,1fr)_minmax(0,2.3fr)] xl:grid-rows-[max-content_1fr]">
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">
          <RecurringCalendar
            storeSlug={storeSlug}
            drivers={drivers}
            initialWeekStartKey={weekStartKey}
            todayKey={vancouverTodayKey()}
          />
        </div>
        <div
          id="new-recurring-profile"
          tabIndex={-1}
          className="min-w-0 scroll-mt-20 xl:col-start-1 xl:row-span-2 xl:row-start-1"
        >
          <RecurringOrderForm
            storeSlug={storeSlug}
            zones={zones}
            drivers={drivers}
            zoneHistory={zoneHistory}
            fallbackZoneId={fallbackZoneId}
          />
        </div>
        <div className="min-w-0 space-y-5 xl:col-start-2 xl:row-start-2">
          <div data-reveal="">
            <RecurringLabelSheets
              storeSlug={storeSlug}
              orders={orders}
              defaultRearrangeOpen={defaultRearrangeOpen}
            />
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
