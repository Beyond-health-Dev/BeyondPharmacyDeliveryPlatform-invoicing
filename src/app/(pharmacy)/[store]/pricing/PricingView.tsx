import type { ComponentProps } from "react";
import ZoneForm from "./ZoneForm";
import ZoneList from "./ZoneList";
import PageHeader from "@/components/ui/PageHeader";
import { pageTitle } from "@/lib/portalStyles";

// Presentational screen; the page supplies the data. Kept separate so the
// dev-only style guide can render it from fixtures.
export default function PricingView({
  storeSlug,
  zones,
  drivers,
}: {
  storeSlug: string;
  zones: ComponentProps<typeof ZoneList>["zones"];
  drivers: ComponentProps<typeof ZoneList>["drivers"];
}) {
  return (
    <div>
      <PageHeader className="mb-8">
        <h1 className={pageTitle}>
          Delivery zones
        </h1>
      </PageHeader>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ZoneForm storeSlug={storeSlug} />
        </div>
        <div className="lg:col-span-2">
          <ZoneList storeSlug={storeSlug} zones={zones} drivers={drivers} />
        </div>
      </div>
    </div>
  );
}
