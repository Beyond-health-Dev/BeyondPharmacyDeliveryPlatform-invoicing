import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { deliveryDayRange } from "@/lib/vancouverDate";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "DRIVER") {
    return NextResponse.json({ error: "Only drivers can use batch deliver" }, { status: 403 });
  }

  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Vancouver's today, the same day the driver's deliveries page shows.
  // (Server-local midnight is UTC on Vercel, which turns over at ~5 PM
  // Pacific and would mark tomorrow's orders delivered.)
  const { todayStart, nextDayStart } = deliveryDayRange(undefined);

  const result = await prisma.$transaction(async (tx) => {
    const eligible = await tx.order.findMany({
      where: {
        assignedDriverId: session.user.id,
        storeId: store.id,
        scheduledDate: { gte: todayStart, lt: nextDayStart },
        status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
      },
      select: { id: true, patientName: true },
    });

    if (eligible.length === 0) return { updated: 0 };

    const ids = eligible.map((o) => o.id);

    await tx.order.updateMany({
      where: { id: { in: ids } },
      data: { status: "DELIVERED", completedAt: new Date() },
    });

    await tx.notification.create({
      data: {
        orderId: ids[0],
        type: "BATCH_DELIVERED",
        message: `Driver batch-delivered ${ids.length} order(s)`,
        storeId: store.id,
      },
    });

    return { updated: ids.length };
  });

  if (result.updated === 0) {
    return NextResponse.json(
      { error: "No eligible orders to deliver" },
      { status: 400 }
    );
  }

  return NextResponse.json({ updated: result.updated });
}
