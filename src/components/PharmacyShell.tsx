import PharmacyNav from "@/components/PharmacyNav";
import ReminderPopup from "@/components/ReminderPopup";
import Circles from "@/components/ui/Circles";

export default function PharmacyShell({
  storeSlug,
  storeName,
  navBasePath,
  children,
}: {
  storeSlug: string;
  storeName: string;
  navBasePath?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pharmacy-workspace">
      <div className="workspace-backdrop" aria-hidden="true">
        <Circles variant="workspace" />
      </div>
      <PharmacyNav storeSlug={storeSlug} storeName={storeName} basePath={navBasePath} />
      <main id="workspace-content" className="workspace-main" tabIndex={-1}>
        {children}
      </main>
      <ReminderPopup storeSlug={navBasePath === "/dev" ? "dev" : storeSlug} />
    </div>
  );
}
