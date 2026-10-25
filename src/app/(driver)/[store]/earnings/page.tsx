import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { notFound } from "next/navigation";
import EarningsView from "./EarningsView";
import { earningsPeriod } from "./earningsPeriod";

export default async function EarningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) notFound();

  const session = await auth();
  if (!session?.user) return null;

  const sp = await searchParams;
  const range = sp.range === "month" ? "month" : "week";

  const { start: rangeStart, startKey: startStr, endKey: endStr } = earningsPeriod(range);

  const earningsWhere = {
    assignedDriverId: session.user.id,
    storeId: store.id,
    status: "DELIVERED" as const,
    scheduledDate: { gte: rangeStart },
  };

  // Use aggregate for totals (efficient DB-level sum) + paginated list
  const [stats, deliveries] = await Promise.all([
    prisma.order.aggregate({
      where: earningsWhere,
      _sum: { priceAtCreation: true },
      _count: true,
    }),
    prisma.order.findMany({
      where: earningsWhere,
      select: {
        id: true,
        patientName: true,
        deliveryZoneName: true,
        priceAtCreation: true,
        scheduledDate: true,
      },
      orderBy: { scheduledDate: "desc" },
      take: 100,
    }),
  ]);

  const totalEarnings = stats._sum.priceAtCreation ?? 0;
  const totalCount = stats._count;

  return (
    <EarningsView
      storeSlug={storeSlug}
      range={range}
      totalCount={totalCount}
      totalEarnings={totalEarnings}
      startStr={startStr}
      endStr={endStr}
      deliveries={deliveries}
    />
  );
}
