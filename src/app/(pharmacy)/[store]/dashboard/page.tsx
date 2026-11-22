import { prisma } from "@/lib/db";
import { resolveStore } from "@/lib/store";
import { notFound } from "next/navigation";
import { recurringPeopleMatch } from "@/lib/recurringDuplicateGuard";
import { getVancouverDeliveryDateInfo } from "@/lib/cron";
import { externalDispatchRowView } from "@/lib/externalDispatchStatus";
import { vancouverHour } from "@/lib/vancouverDate";
import { getSpokeTrackingUrl } from "@/lib/spoke";
import type { Prisma } from "@prisma/client";
import OrdersPoller from "../orders/OrdersPoller";
import DashboardView, { type DashboardDelivery } from "./DashboardView";

const orderFields = {
  id: true, createdAt: true, recurringOrderId: true, status: true, failedReason: true,
  patientId: true, patientName: true, patientPhone: true,
  deliveryAddress: true, deliveryCity: true, deliveryPostalCode: true,
  assignedDriver: { select: { name: true } },
} satisfies Prisma.OrderSelect;

const dispatchFields = {
  id: true, createdAt: true, status: true, spokeStopId: true,
  workflowStep: true, scheduledDate: true,
  patientName: true, deliveryAddress: true, deliveryCity: true, trackingLink: true,
  selectedProviderUser: { select: { name: true } },
} satisfies Prisma.ExternalDispatchSelect;

type DashboardOrder = Prisma.OrderGetPayload<{ select: typeof orderFields }>;
type DashboardExternalDispatch = Prisma.ExternalDispatchGetPayload<{ select: typeof dispatchFields }>;

function shouldReplaceDuplicateOrder(
  existing: DashboardOrder,
  candidate: DashboardOrder
) {
  if (existing.status === "CANCELLED" && candidate.status !== "CANCELLED") {
    return true;
  }
  if (existing.status !== "CANCELLED" && candidate.status === "CANCELLED") {
    return false;
  }
  return candidate.createdAt < existing.createdAt;
}

function dedupeRecurringDashboardOrders(orders: DashboardOrder[]) {
  const displayOrders: DashboardOrder[] = [];

  for (const order of orders) {
    if (!order.recurringOrderId) {
      displayOrders.push(order);
      continue;
    }

    const duplicateIndex = displayOrders.findIndex(
      (candidate) =>
        !!candidate.recurringOrderId && recurringPeopleMatch(candidate, order)
    );

    if (duplicateIndex === -1) {
      displayOrders.push(order);
    } else if (shouldReplaceDuplicateOrder(displayOrders[duplicateIndex], order)) {
      displayOrders[duplicateIndex] = order;
    }
  }

  return displayOrders.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

function toDashboardDelivery(order: DashboardOrder): DashboardDelivery {
  return {
    id: order.id,
    patientName: order.patientName,
    deliveryAddress: order.deliveryAddress,
    deliveryCity: order.deliveryCity,
    driverName: order.assignedDriver?.name ?? null,
    status: order.status,
    trackingLink: null,
    failedReason: order.failedReason,
    createdAt: order.createdAt,
    isExternal: false,
    externalDispatchId: null,
    canCancelExternal: false,
    hasAnchorStop: false,
    statusLabel: null,
    statusNote: null,
    needsAttention: false,
  };
}

function toExternalDashboardDelivery(
  dispatch: DashboardExternalDispatch,
  clock: { todayKey: string; vancouverHour: number }
): DashboardDelivery {
  return {
    id: `external-${dispatch.id}`,
    patientName: dispatch.patientName,
    deliveryAddress: dispatch.deliveryAddress,
    deliveryCity: dispatch.deliveryCity,
    driverName: dispatch.selectedProviderUser?.name ?? "Anchor / Spoke",
    status: dispatch.status,
    trackingLink: getSpokeTrackingUrl(dispatch.trackingLink),
    failedReason: null,
    createdAt: dispatch.createdAt,
    isExternal: true,
    externalDispatchId: dispatch.id,
    ...externalDispatchRowView(dispatch, clock),
  };
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ store: string }>;
}) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) notFound();

  // "Today" must be Vancouver's today — server-local midnight (UTC on Vercel)
  // rolls the dashboard to the next day at ~5 PM Pacific.
  const now = new Date();
  const { dateKey: todayKey, dayStart: today, nextDayStart: tomorrow } =
    getVancouverDeliveryDateInfo(now);
  const clock = { todayKey, vancouverHour: vancouverHour(now) };

  const [rawTodayOrders, todayExternalDispatches, heldForAnchorCount] = await Promise.all([
    prisma.order.findMany({
      where: {
        storeId: store.id,
        scheduledDate: { gte: today, lt: tomorrow },
      },
      select: orderFields,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.externalDispatch.findMany({
      where: {
        storeId: store.id,
        provider: "SPOKE",
        scheduledDate: { gte: today, lt: tomorrow },
        // Failed handoffs stay visible — hiding them makes the delivery look
        // "never entered" and invites a duplicate re-entry.
      },
      select: dispatchFields,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    // Anchor orders still held for their 6 AM run, whatever their date.
    prisma.externalDispatch.count({
      where: { storeId: store.id, provider: "SPOKE", status: "SCHEDULED" },
    }),
  ]);
  const todayOrders = [
    ...dedupeRecurringDashboardOrders(rawTodayOrders).map(toDashboardDelivery),
    ...todayExternalDispatches.map((dispatch) => toExternalDashboardDelivery(dispatch, clock)),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <>
      <OrdersPoller />
      <DashboardView storeSlug={store.slug} dayKey={todayKey} deliveries={todayOrders} heldForAnchorCount={heldForAnchorCount} />
    </>
  );
}
