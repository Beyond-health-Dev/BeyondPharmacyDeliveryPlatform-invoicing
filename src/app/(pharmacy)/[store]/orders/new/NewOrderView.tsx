import type { ComponentProps } from "react";
import NewOrderForm from "./NewOrderForm";
import PageHeader from "@/components/ui/PageHeader";
import { pageTitle } from "@/lib/portalStyles";

// Presentational screen; the page supplies the data. Kept separate so the
// dev-only style guide can render it from fixtures.
export default function NewOrderView(props: ComponentProps<typeof NewOrderForm>) {
  return (
    <div>
      <PageHeader className="mb-8">
        <h1 className={pageTitle}>
          New order
        </h1>
      </PageHeader>
      <NewOrderForm {...props} />
    </div>
  );
}
