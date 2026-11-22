import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { isSelectedSpokeProvider } from "@/lib/spokeDispatch";
import { resolveStore } from "@/lib/store";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ store: string; id: string }> }
) {
  const { store: storeSlug, id } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify user belongs to this store
  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();

  // Load the order once up front and verify it belongs to this store. Every branch
  // below reads from this record instead of issuing its own findUnique.
  const order = await prisma.order.findUnique({ where: { id, storeId: store.id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  const VALID_STATUSES = [
    "PENDING",
    "ASSIGNED",
    "PICKED_UP",
    "IN_TRANSIT",
    "DELIVERED",
    "FAILED",
    "CANCELLED",
  ];

  if (body.status !== undefined) {
    if (typeof body.status !== "string" || !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    // Invoiced orders are settled money — a status change would corrupt billing.
    if (order.isInvoiced && body.status !== order.status) {
      return NextResponse.json(
        { error: "Cannot change the status of an invoiced order" },
        { status: 409 }
      );
    }
    updateData.status = body.status;
  }
  // Only an active in-house driver of this store can be assigned here. An
  // order assigned to Anchor this way would never reach Anchor: Anchor orders
  // are sent to Spoke when they are created from New Order.
  if (body.assignedDriverId) {
    if (typeof body.assignedDriverId !== "string") {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }
    if (isSelectedSpokeProvider(body.assignedDriverId)) {
      return NextResponse.json(
        {
          error:
            "Anchor can't be assigned from here, because the order would never reach Anchor. Create Anchor orders from New Order.",
        },
        { status: 400 }
      );
    }
    const driver = await prisma.user.findUnique({
      where: { id: body.assignedDriverId },
      select: { role: true, isActive: true, storeId: true },
    });
    if (!driver || driver.role !== "DRIVER" || !driver.isActive || driver.storeId !== store.id) {
      return NextResponse.json(
        { error: "That driver isn't an active driver at this store. Choose another driver." },
        { status: 400 }
      );
    }
    updateData.assignedDriverId = body.assignedDriverId;
  }

  // Set cancelledAt timestamp when cancelling an order (Stage 1 of soft delete);
  // clear it when an order is moved back out of CANCELLED.
  if (body.status === "CANCELLED") {
    updateData.cancelledAt = new Date();
  } else if (body.status && order.cancelledAt) {
    updateData.cancelledAt = null;
  }

  // Set completedAt when order reaches a terminal status; clear it (and any stale
  // failure reason) when a terminal status is reverted, so invoicing and the
  // retention purge never see a "completed" order that is actually in progress.
  if (body.status === "DELIVERED" || body.status === "FAILED") {
    updateData.completedAt = new Date();
  } else if (body.status) {
    if (order.completedAt) updateData.completedAt = null;
    if (order.failedReason) updateData.failedReason = null;
  }

  // Auto-promote PENDING to ASSIGNED when a driver is assigned without explicit status
  if (body.assignedDriverId && !body.status && order.status === "PENDING") {
    updateData.status = "ASSIGNED";
  }

  // Handle PICKED_UP status — create notification for pharmacy
  if (body.status === "PICKED_UP") {
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id, storeId: store.id },
        data: updateData,
      });

      await tx.notification.create({
        data: {
          orderId: id,
          type: "ORDER_PICKED_UP",
          message: `Driver picked up delivery for ${order.patientName} at ${order.deliveryAddress}, ${order.deliveryCity}`,
          storeId: store.id,
        },
      });

      return updatedOrder;
    });

    return NextResponse.json(updated);
  }

  // Handle FAILED status — save reason and create notification
  if (body.status === "FAILED") {
    updateData.failedReason = body.failedReason || "No reason provided";

    // Update order and create notification in a transaction
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id, storeId: store.id },
        data: updateData,
      });

      await tx.notification.create({
        data: {
          orderId: id,
          type: "DELIVERY_FAILED",
          message: `Delivery to ${order.patientName} at ${order.deliveryAddress}, ${order.deliveryCity} failed. Reason: ${body.failedReason || "No reason provided"}`,
          storeId: store.id,
        },
      });

      return updatedOrder;
    });

    return NextResponse.json(updated);
  }

  // Handle re-attempt: when going from FAILED back to IN_TRANSIT, increment attempt count
  if (body.status === "IN_TRANSIT" && order.status === "FAILED") {
    updateData.attemptCount = (order.attemptCount || 1) + 1;
    updateData.failedReason = null;
    updateData.completedAt = null;

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id, storeId: store.id },
        data: updateData,
      });

      await tx.notification.create({
        data: {
          orderId: id,
          type: "DELIVERY_REATTEMPT",
          message: `Re-attempt #${updatedOrder.attemptCount} started for delivery to ${order.patientName} at ${order.deliveryAddress}, ${order.deliveryCity}`,
          storeId: store.id,
        },
      });

      return updatedOrder;
    });

    return NextResponse.json(updated);
  }

  const updated = await prisma.order.update({
    where: { id, storeId: store.id },
    data: updateData,
  });

  return NextResponse.json(updated);
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ store: string; id: string }> }
) {
  const { store: storeSlug, id } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user || session.user.role !== "PHARMACY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const order = await prisma.order.findUnique({
    where: { id, storeId: store.id },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Guard: completed orders must be invoiced before deletion
  if ((order.status === "DELIVERED" || order.status === "FAILED") && !order.isInvoiced) {
    return NextResponse.json(
      { error: "Cannot delete: this order has not been invoiced yet. Generate an invoice first." },
      { status: 409 }
    );
  }

  // Stage 1: If order is not yet cancelled, soft-delete it
  if (order.status !== "CANCELLED") {
    const updated = await prisma.order.update({
      where: { id, storeId: store.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return NextResponse.json({
      message: "Order cancelled. It can be permanently deleted after 24 hours.",
      order: updated,
    });
  }

  // Stage 2: Order is already cancelled — check cooldown
  if (!order.cancelledAt) {
    // Edge case: cancelled before cancelledAt field existed — set it now
    await prisma.order.update({
      where: { id, storeId: store.id },
      data: { cancelledAt: new Date() },
    });
    return NextResponse.json(
      {
        error: "Cooldown period started. You can permanently delete this order after 24 hours.",
        cancelledAt: new Date().toISOString(),
      },
      { status: 409 }
    );
  }

  const elapsed = Date.now() - new Date(order.cancelledAt).getTime();
  if (elapsed < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - elapsed;
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    return NextResponse.json(
      {
        error: `Cannot permanently delete yet. ${remainingHours} hour(s) remaining in the 24-hour cooldown.`,
        cancelledAt: order.cancelledAt,
        canDeleteAfter: new Date(new Date(order.cancelledAt).getTime() + COOLDOWN_MS).toISOString(),
      },
      { status: 409 }
    );
  }

  // Cooldown passed — permanently delete (cascade related records)
  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({ where: { orderId: id } });
    await tx.invoiceLineItem.deleteMany({ where: { orderId: id } });
    await tx.order.delete({ where: { id, storeId: store.id } });
  });

  return NextResponse.json({ message: "Order permanently deleted." });
}
