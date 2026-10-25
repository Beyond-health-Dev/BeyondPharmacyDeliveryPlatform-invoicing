import Link from "next/link";
import EarningsExport from "./EarningsExport";
import Circles from "@/components/ui/Circles";
import PageHeader from "@/components/ui/PageHeader";
import { card, cn, emptyState, pageTitle, totalPill } from "@/lib/portalStyles";

const rangeToggle =
  "selectable inline-flex items-center gap-2 px-4 py-3 rounded-full text-sm font-semibold active:scale-(--press-scale)";

export interface EarningsDelivery {
  id: string;
  patientName: string;
  deliveryZoneName: string;
  priceAtCreation: number;
  scheduledDate: Date | string;
}

// Presentational earnings screen; the page supplies the data. Kept separate
// so the dev-only style guide can render it from fixtures.
export default function EarningsView({
  storeSlug,
  range,
  totalCount,
  totalEarnings,
  startStr,
  endStr,
  deliveries,
}: {
  storeSlug: string;
  range: "week" | "month";
  totalCount: number;
  totalEarnings: number;
  startStr: string;
  endStr: string;
  deliveries: EarningsDelivery[];
}) {
  return (
    <div>
      <PageHeader className="mb-4">
        <h1 className={pageTitle}>
          My Earnings, tracked
        </h1>
      </PageHeader>

      {/* Range Toggle */}
      <div className="flex space-x-2 mb-4">
        <Link
          href={`/${storeSlug}/earnings?range=week`}
          aria-current={range === "week" ? "page" : undefined}
          className={rangeToggle}
        >
          <span className="select-dot" aria-hidden="true" />
          This Week
        </Link>
        <Link
          href={`/${storeSlug}/earnings?range=month`}
          aria-current={range === "month" ? "page" : undefined}
          className={rangeToggle}
        >
          <span className="select-dot" aria-hidden="true" />
          This Month
        </Link>
      </div>

      {/* Summary Card */}
      <div className="circle-host overflow-hidden rounded-card bg-mint p-5 mb-4">
        <Circles variant="mintPanel" />
        <div className="flex justify-between items-center">
          <div>
            <p className="text-sm font-medium text-navy">Completed Deliveries</p>
            <p className="text-2xl font-extrabold text-navy tabular-nums">
              {totalCount}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-navy">Total Earnings</p>
            <p className="text-2xl font-extrabold text-navy tabular-nums">
              ${totalEarnings.toFixed(2)}
            </p>
          </div>
        </div>
      </div>

      {/* Export Button */}
      <EarningsExport
        storeSlug={storeSlug}
        start={startStr}
        end={endStr}
      />

      {/* Deliveries List */}
      {deliveries.length === 0 ? (
        <div className={`${emptyState} mt-4`}>
          No completed deliveries in this <span className="text-navy">period</span>.
        </div>
      ) : (
        <div data-reveal="" className="space-y-2 mt-4">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className={`${card} p-3 flex justify-between items-center`}
            >
              <div>
                <p className="text-sm font-semibold text-navy">
                  {d.patientName}
                </p>
                <p className="text-xs text-muted">
                  {d.deliveryZoneName} &middot;{" "}
                  {new Date(d.scheduledDate).toLocaleDateString("en-US", { timeZone: "UTC" })}
                </p>
              </div>
              <p className={cn(totalPill.regular, "text-sm")}>
                ${d.priceAtCreation.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
