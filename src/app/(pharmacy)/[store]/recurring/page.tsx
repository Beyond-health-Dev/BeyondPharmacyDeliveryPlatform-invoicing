import { prisma } from "@/lib/db";
import { resolveStore } from "@/lib/store";
import { notFound } from "next/navigation";
import RecurringView from "./RecurringView";
import { visibleRecurringProfiles } from "@/lib/recurringDuplicateGuard";
import { isSelectedSpokeProvider } from "@/lib/spokeDispatch";
import { getZoneSuggestionData } from "@/lib/zoneHistory";
import { vancouverWeekRange } from "@/lib/vancouverDate";

export default async function RecurringPage({
  params,
}: {
  params: Promise<{ store: string }>;
}) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) notFound();

  // The pharmacy's week (Sunday to Saturday, Vancouver time) for the "skipped
  // this week" badges and the calendar's opening week.
  const thisWeek = vancouverWeekRange();
  const [recurringOrders, zones, drivers] = await Promise.all([
    prisma.recurringOrder.findMany({
      where: { storeId: store.id, isActive: true },
      include: {
        deliveryZone: true,
        assignedDriver: { select: { id: true, name: true } },
        skips: {
          where: {
            skipDate: {
              gte: thisWeek.weekStart,
              lt: thisWeek.weekEnd,
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.deliveryZone.findMany({
      where: { isActive: true, storeId: store.id },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "DRIVER", isActive: true, storeId: store.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const zoneOptions = zones.map((z) => ({ id: z.id, name: z.name, price: z.price }));
  const { history: zoneHistory, fallbackZoneId } = await getZoneSuggestionData(
    store.id,
    zoneOptions
  );
  // Anchor (Spoke) deliveries don't use the zone price, so the forms hide the
  // zone selector for them.
  const driverOptions = drivers.map((d) => ({
    ...d,
    isExternal: isSelectedSpokeProvider(d.id),
  }));
  // Same visibility rule the delivery label sheets use (fully duplicated
  // profiles hidden, partly duplicated ones keep only their own days).
  const orderItems = visibleRecurringProfiles(recurringOrders).map(({ order: o, activeDays }) => ({
    id: o.id,
    patientName: o.patientName,
    deliveryAddress: o.deliveryAddress,
    deliveryCity: o.deliveryCity,
    deliveryZoneId: o.deliveryZoneId,
    zoneName: o.deliveryZone.name,
    zonePrice: o.deliveryZone.price,
    activeDays,
    recurrenceIntervalWeeks: o.recurrenceIntervalWeeks,
    recurrenceAnchorDate: o.recurrenceAnchorDate.toISOString(),
    isActive: o.isActive,
    isOnHold: o.isOnHold,
    holdStart: o.holdStart?.toISOString() ?? null,
    holdEnd: o.holdEnd?.toISOString() ?? null,
    isSkippedThisWeek: o.skips.length > 0,
    assignedDriverId: o.assignedDriverId,
    assignedDriverName: o.assignedDriver?.name ?? null,
  }));

  return (
    <RecurringView
      storeSlug={storeSlug}
      weekStartKey={thisWeek.startKey}
      zones={zoneOptions}
      drivers={driverOptions}
      zoneHistory={zoneHistory}
      fallbackZoneId={fallbackZoneId}
      orders={orderItems}
    />
  );
}
