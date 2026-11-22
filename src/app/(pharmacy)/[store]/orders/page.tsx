import { prisma } from "@/lib/db";
import { resolveStore } from "@/lib/store";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getVancouverDeliveryDateInfo } from "@/lib/cron";
import { externalDispatchRowView } from "@/lib/externalDispatchStatus";
import { externalStatusWhere, orderStatusWhere } from "@/lib/orderFilters";
import { isSelectedSpokeProvider } from "@/lib/spokeDispatch";
import { vancouverHour } from "@/lib/vancouverDate";
import OrdersView, { type SerializedOrder } from "./OrdersView";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ store: string }>;
  searchParams: Promise<{ status?: string; page?: string; search?: string; limit?: string }>;
}) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) notFound();

  const sp = await searchParams;
  const status = sp.status;
  const search = sp.search?.trim() || "";
  const limit = parseInt(sp.limit || "100");

  // Hide cancelled orders older than 24 hours (they're past the cooldown window)
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Vancouver's today, for the "Not confirmed" filter and the row notes.
  const { dateKey: todayKey, dayStart: todayStart } = getVancouverDeliveryDateInfo(now);
  const clock = { todayKey, vancouverHour: vancouverHour(now) };
  const where: Prisma.OrderWhereInput = {
    storeId: store.id,
    ...orderStatusWhere(status),
    ...(search ? { patientName: { contains: search, mode: "insensitive" as const } } : {}),
    // Exclude cancelled orders whose cancelledAt is older than 24h
    NOT: {
      status: "CANCELLED",
      cancelledAt: { lt: twentyFourHoursAgo },
    },
  };
  const externalWhere: Prisma.ExternalDispatchWhereInput = {
    storeId: store.id,
    provider: "SPOKE",
    ...externalStatusWhere(status, todayStart),
    ...(search
      ? { patientName: { contains: search, mode: "insensitive" as const } }
      : {}),
  };

  const [orders, orderTotal, externalDispatches, externalTotal, drivers] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { assignedDriver: true, deliveryZone: true },
      orderBy: { scheduledDate: "desc" },
      take: limit,
    }),
    prisma.order.count({ where }),
    prisma.externalDispatch.findMany({
      where: externalWhere,
      include: { selectedProviderUser: true },
      orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
      take: limit,
    }),
    prisma.externalDispatch.count({ where: externalWhere }),
    prisma.user.findMany({ where: { role: "DRIVER", isActive: true, storeId: store.id } }),
  ]);

  const total = orderTotal + externalTotal;
  const serializedOrders: SerializedOrder[] = [
    ...orders.map((order) => ({
      id: order.id,
      patientName: order.patientName,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      scheduledDate: order.scheduledDate.toISOString(),
      deliveryZoneName: order.deliveryZoneName,
      priceAtCreation: order.priceAtCreation,
      status: order.status,
      assignedDriverId: order.assignedDriverId,
      assignedDriverName: order.assignedDriver?.name || null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      isExternal: false,
      externalProvider: null,
      externalDispatchId: null,
      canCancelExternal: false,
      statusLabel: null,
      statusNote: null,
      needsAttention: false,
    })),
    ...externalDispatches.map((dispatch) => ({
      id: `external-${dispatch.id}`,
      patientName: dispatch.patientName,
      deliveryAddress: dispatch.deliveryAddress,
      deliveryCity: dispatch.deliveryCity,
      scheduledDate: dispatch.scheduledDate.toISOString(),
      deliveryZoneName: dispatch.deliveryZoneName,
      priceAtCreation: dispatch.priceAtCreation,
      status: dispatch.status,
      assignedDriverId: null,
      assignedDriverName: dispatch.selectedProviderUser?.name ?? "Anchor / Spoke",
      cancelledAt: null,
      createdAt: dispatch.createdAt.toISOString(),
      isExternal: true,
      externalProvider: "Spoke",
      externalDispatchId: dispatch.id,
      ...externalDispatchRowView(dispatch, clock),
    })),
  ]
    .sort((a, b) => {
      const scheduledDiff =
        new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime();
      if (scheduledDiff !== 0) return scheduledDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, limit);

  // Group orders by scheduled date
  const grouped: Record<string, SerializedOrder[]> = {};
  for (const order of serializedOrders) {
    const dateKey = new Date(order.scheduledDate).toISOString().split("T")[0];
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(order);
  }
  const sortedDateKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  // Serialize orders for client component
  const serializedGroups: Record<string, SerializedOrder[]> = {};

  for (const [dateKey, dateOrders] of Object.entries(grouped)) {
    serializedGroups[dateKey] = dateOrders;
  }

  return (
    <OrdersView
      storeSlug={storeSlug}
      status={status}
      search={search}
      limit={limit}
      total={total}
      orderCount={serializedOrders.length}
      groupedOrders={serializedGroups}
      sortedDateKeys={sortedDateKeys}
      // Assign Driver is for in-house drivers only: an order assigned to
      // Anchor here would never reach Anchor (the server refuses it too).
      drivers={drivers
        .filter((d) => !isSelectedSpokeProvider(d.id))
        .map((d) => ({ id: d.id, name: d.name }))}
    />
  );
}
