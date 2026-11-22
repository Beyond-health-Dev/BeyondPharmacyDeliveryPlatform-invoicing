import type { ComponentProps } from "react";
import UserForm from "./UserForm";
import UserTable from "./UserTable";
import PageHeader from "@/components/ui/PageHeader";
import { pageTitle } from "@/lib/portalStyles";

// Presentational screen; the page supplies the data. Kept separate so the
// dev-only style guide can render it from fixtures.
export default function UsersView({
  storeSlug,
  users,
}: {
  storeSlug: string;
  users: ComponentProps<typeof UserTable>["users"];
}) {
  return (
    <div>
      <PageHeader className="mb-8">
        <h1 className={pageTitle}>
          Users
        </h1>
      </PageHeader>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <UserForm storeSlug={storeSlug} />
        </div>
        <div className="lg:col-span-2">
          <UserTable
            users={users}
            storeSlug={storeSlug}
          />
        </div>
      </div>
    </div>
  );
}
