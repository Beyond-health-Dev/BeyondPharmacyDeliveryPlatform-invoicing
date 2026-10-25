import type { ComponentProps } from "react";
import DeliveryPoller from "./DeliveryPoller";
import DateNavigation from "./DateNavigation";
import DeliveryList from "./DeliveryList";
import PageHeader from "@/components/ui/PageHeader";
import { pageTitle } from "@/lib/portalStyles";

// Presentational driver deliveries screen; the page supplies the data. Kept
// separate so the dev-only style guide can render it from fixtures.
export default function DeliveriesView({
  storeSlug,
  currentDateStr,
  todayKey,
  isToday,
  selectedDateLabel,
  pendingCount,
  completedCount,
  failedCount,
  deliveries,
  eligibleForBatchDeliver,
  poll = true,
}: {
  storeSlug: string;
  currentDateStr: string;
  todayKey: string;
  isToday: boolean;
  selectedDateLabel: string;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
  deliveries: ComponentProps<typeof DeliveryList>["deliveries"];
  eligibleForBatchDeliver: number;
  poll?: boolean;
}) {
  return (
    <div>
      {poll && <DeliveryPoller />}
      <DateNavigation
        storeSlug={storeSlug}
        currentDate={currentDateStr}
        todayKey={todayKey}
        isToday={isToday}
        dateLabel={selectedDateLabel}
      />
      <PageHeader className="mb-4">
        <h1 className={`${pageTitle} mb-4`}>
          {isToday
            ? <>Your Deliveries, sorted</>
            : `Deliveries for ${selectedDateLabel}`}
        </h1>

        <p className="drop-in drop-in--2 text-sm font-medium text-muted tabular-nums">
          {pendingCount} pending • {completedCount} completed
          {failedCount > 0 && (
            <span className="text-danger"> • {failedCount} need re-attempt</span>
          )}
        </p>
      </PageHeader>

      <DeliveryList
        deliveries={deliveries}
        storeSlug={storeSlug}
        selectedDate={currentDateStr}
        isToday={isToday}
        eligibleForBatchDeliver={eligibleForBatchDeliver}
      />
    </div>
  );
}
