import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { notFound } from "next/navigation";
import { deliveryDayRange } from "@/lib/vancouverDate";
import DeliveriesView from "./DeliveriesView";

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) notFound();

  const session = await auth();
  if (!session?.user) return null;

  const sp = await searchParams;

  // Vancouver's day, with UTC-midnight bounds like the stored scheduledDate.
  // (Server-local midnight — UTC on Vercel — rolled "today" over to tomorrow
  // at ~5 PM Pacific, showing next-day orders as today's.)
  const {
    selectedKey: currentDateStr,
    todayKey,
    isToday,
    todayStart: today,
    dayStart: selectedDate,
    nextDayStart: nextDay,
  } = deliveryDayRange(sp.date);

  // Fetch deliveries for selected date + any FAILED orders from previous days (only when viewing today)
  const [dateDeliveries, failedFromPreviousDays] = await Promise.all([
    prisma.order.findMany({
      where: {
        assignedDriverId: session.user.id,
        storeId: store.id,
        scheduledDate: { gte: selectedDate, lt: nextDay },
        status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED"] },
      },
      orderBy: { createdAt: "asc" },
    }),
    isToday
      ? prisma.order.findMany({
          where: {
            assignedDriverId: session.user.id,
            storeId: store.id,
            scheduledDate: { lt: today },
            status: "FAILED",
          },
          orderBy: { scheduledDate: "desc" },
        })
      : Promise.resolve([]),
  ]);

  // Combine: failed from previous days first, then selected date's
  const allDeliveries = [...failedFromPreviousDays, ...dateDeliveries];

  const pending = allDeliveries.filter(
    (d) => d.status !== "DELIVERED"
  );
  const completed = allDeliveries.filter((d) => d.status === "DELIVERED");
  const failed = allDeliveries.filter((d) => d.status === "FAILED");
  const eligibleForBatchDeliver = allDeliveries.filter(
    (d) => ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"].includes(d.status)
  ).length;

  return (
    <DeliveriesView
      storeSlug={store.slug}
      currentDateStr={currentDateStr}
      todayKey={todayKey}
      isToday={isToday}
      selectedDateLabel={selectedDate.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
      pendingCount={pending.length}
      completedCount={completed.length}
      failedCount={failed.length}
      deliveries={allDeliveries.map((d) => ({
          id: d.id,
          patientName: d.patientName,
          deliveryAddress: d.deliveryAddress,
          deliveryCity: d.deliveryCity,
          deliveryPostalCode: d.deliveryPostalCode,
          instructions: d.instructions,
          status: d.status,
          failedReason: d.failedReason,
          attemptCount: d.attemptCount,
          scheduledDate: d.scheduledDate.toISOString(),
          completedAt: d.completedAt ? d.completedAt.toISOString() : null,
        }))}
      eligibleForBatchDeliver={eligibleForBatchDeliver}
    />
  );
}
