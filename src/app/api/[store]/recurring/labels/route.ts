import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveStore } from "@/lib/store";
import { requireStoreAdmin } from "@/lib/storeAccess";
import {
  recurringDuplicateSelect,
  visibleRecurringProfiles,
} from "@/lib/recurringDuplicateGuard";
import {
  labelSheetFileName,
  labelSheetTitle,
  parseLabelSheet,
  profilesForLabelSheet,
} from "@/lib/recurringLabels";
import { renderLabelSheetPdf } from "@/lib/recurringLabelsPdf";

export const dynamic = "force-dynamic";

/**
 * GET ?sheet=daily|sunday|...|saturday — an Avery 5160 PDF of preset delivery
 * labels for that sheet's recurring deliveries, filled to whole pages.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  // Pharmacy admins only, and a store-scoped admin only for their own store.
  const access = await requireStoreAdmin(await resolveStore(storeSlug));
  if (access.error) return access.error;
  const { store } = access;

  const sheet = parseLabelSheet(req.nextUrl.searchParams.get("sheet"));
  if (!sheet) {
    return NextResponse.json(
      { error: "sheet must be daily or a day of the week (sunday to saturday)" },
      { status: 400 }
    );
  }

  const recurringOrders = await prisma.recurringOrder.findMany({
    where: { storeId: store.id, isActive: true },
    select: recurringDuplicateSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Same profiles, and same days, as the Recurring page shows.
  const profiles = visibleRecurringProfiles(recurringOrders).map(({ order, activeDays }) => ({
    ...order,
    activeDays,
  }));
  const people = profilesForLabelSheet(profiles, sheet);

  if (people.length === 0) {
    // A blank PDF would waste a sheet of labels.
    return NextResponse.json(
      { error: `No one is on the ${labelSheetTitle(sheet)} label sheet.` },
      { status: 404 }
    );
  }

  const pdf = renderLabelSheetPdf(people, {
    title: `${store.name}: ${labelSheetTitle(sheet)} labels`,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${labelSheetFileName(store.slug, sheet)}"`,
      "Cache-Control": "no-store",
    },
  });
}
