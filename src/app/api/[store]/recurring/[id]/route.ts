import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getVancouverDeliveryDateInfo } from "@/lib/cron";
import { isSelectedSpokeProvider } from "@/lib/spokeDispatch";
import { resolveStore } from "@/lib/store";
import {
  findRecurringDuplicate,
  formatRecurringDuplicateMessage,
  parseRecurringActiveDays,
} from "@/lib/recurringDuplicateGuard";

function normalizeOptionalId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeAnchorDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  if (!session?.user || session.user.role !== "PHARMACY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify recurring order belongs to store
  const existing = await prisma.recurringOrder.findUnique({ where: { id, storeId: store.id } });
  if (!existing) {
    return NextResponse.json({ error: "Recurring order not found" }, { status: 404 });
  }

  const body = await req.json();

  const updateData: Record<string, unknown> = {};

  // Toggle active/inactive
  if (typeof body.isActive === "boolean") {
    updateData.isActive = body.isActive;
  }

  let nextActiveDays = parseRecurringActiveDays(existing.activeDays);

  // Custom delivery days
  if ("activeDays" in body) {
    nextActiveDays = parseRecurringActiveDays(body.activeDays);
    if (!nextActiveDays) {
      return NextResponse.json(
        { error: "activeDays must be a non-empty array of day numbers (0-6)" },
        { status: 400 }
      );
    }
    updateData.activeDays = JSON.stringify(nextActiveDays);
  }

  if ("recurrenceIntervalWeeks" in body) {
    const recurrenceIntervalWeeks = Number(body.recurrenceIntervalWeeks);
    if (recurrenceIntervalWeeks !== 1 && recurrenceIntervalWeeks !== 2) {
      return NextResponse.json(
        { error: "recurrenceIntervalWeeks must be 1 or 2" },
        { status: 400 }
      );
    }
    updateData.recurrenceIntervalWeeks = recurrenceIntervalWeeks;
  }

  if ("recurrenceAnchorDate" in body) {
    const recurrenceAnchorDate = normalizeAnchorDate(body.recurrenceAnchorDate);
    if (!recurrenceAnchorDate) {
      return NextResponse.json(
        { error: "recurrenceAnchorDate must be a valid date" },
        { status: 400 }
      );
    }
    // A future anchor makes weeksSinceAnchor negative in isRecurringScheduleDue,
    // which silently stops the profile from ever generating until that date.
    if (recurrenceAnchorDate.getTime() > Date.now()) {
      return NextResponse.json(
        { error: "recurrenceAnchorDate cannot be in the future" },
        { status: 400 }
      );
    }
    updateData.recurrenceAnchorDate = recurrenceAnchorDate;
  }

  // Vacation hold
  if (typeof body.isOnHold === "boolean") {
    updateData.isOnHold = body.isOnHold;
    if (body.isOnHold) {
      if (!body.holdStart || !body.holdEnd) {
        return NextResponse.json(
          { error: "holdStart and holdEnd are required when enabling hold" },
          { status: 400 }
        );
      }
      const start = new Date(body.holdStart);
      const end = new Date(body.holdEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return NextResponse.json(
          { error: "holdStart and holdEnd must be valid dates" },
          { status: 400 }
        );
      }
      // Both days are included, so a one-day hold starts and ends on the same day.
      if (end < start) {
        return NextResponse.json(
          { error: "holdEnd can't be before holdStart" },
          { status: 400 }
        );
      }
      updateData.holdStart = start;
      updateData.holdEnd = end;
    } else {
      updateData.holdStart = null;
      updateData.holdEnd = null;
    }
  }

  // Driver assignment (null to unassign, string to assign)
  if ("assignedDriverId" in body) {
    const assignedDriverId = normalizeOptionalId(body.assignedDriverId);
    if (assignedDriverId) {
      const driver = await prisma.user.findFirst({
        where: {
          id: assignedDriverId,
          role: "DRIVER",
          isActive: true,
          storeId: store.id,
        },
        select: { id: true },
      });

      if (!driver) {
        return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
      }
    }

    updateData.assignedDriverId = assignedDriverId;
  }

  // Delivery zone — sets the price on in-house invoices. Sent when a profile
  // moves from Anchor to an in-house driver, so staff confirm the zone that
  // driver is paid by instead of inheriting one that never affected money.
  if ("deliveryZoneId" in body) {
    const deliveryZoneId = normalizeOptionalId(body.deliveryZoneId);
    const zone = deliveryZoneId
      ? await prisma.deliveryZone.findFirst({
          where: { id: deliveryZoneId, storeId: store.id, isActive: true },
          select: { id: true },
        })
      : null;
    if (!zone) {
      return NextResponse.json({ error: "Invalid delivery zone" }, { status: 400 });
    }
    updateData.deliveryZoneId = zone.id;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const nextIsActive =
    typeof body.isActive === "boolean" ? body.isActive : existing.isActive;
  const shouldCheckDuplicate =
    nextIsActive && (body.isActive === true || "activeDays" in body);

  if (shouldCheckDuplicate) {
    if (!nextActiveDays) {
      return NextResponse.json(
        { error: "Existing activeDays are invalid" },
        { status: 400 }
      );
    }

    const duplicate = await findRecurringDuplicate(
      prisma,
      {
        storeId: store.id,
        patientId: existing.patientId,
        patientName: existing.patientName,
        patientPhone: existing.patientPhone,
        deliveryAddress: existing.deliveryAddress,
        deliveryCity: existing.deliveryCity,
        deliveryPostalCode: existing.deliveryPostalCode,
        activeDays: nextActiveDays,
      },
      { excludeId: id }
    );

    if (duplicate) {
      return NextResponse.json(
        {
          error: formatRecurringDuplicateMessage(
            { patientName: existing.patientName },
            duplicate
          ),
        },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.recurringOrder.update({
    where: { id, storeId: store.id },
    data: updateData,
  });

  // Propagate a driver reassignment to today's (and any future) already-generated
  // orders that haven't left the pharmacy yet. Without this, an order created by
  // the 6 AM run keeps the OLD driver all day and never appears on the newly
  // assigned driver's app — the change would only apply from tomorrow.
  let reassignedOrders = 0;
  if ("assignedDriverId" in body) {
    const newDriverId = normalizeOptionalId(body.assignedDriverId);
    if (isSelectedSpokeProvider(newDriverId)) {
      // Profile now routes to Spoke from the next generation. Existing in-house
      // orders keep their current driver — converting them into a Spoke handoff
      // is an explicit action (cancel + re-enter), not a PATCH side effect.
    } else {
      // Resolve the effective driver the same way generation does:
      // profile driver, else the zone's default driver, else unassigned.
      let effectiveDriverId = newDriverId;
      if (!effectiveDriverId) {
        const zone = await prisma.deliveryZone.findUnique({
          // The zone sent in this same request wins over the stored one.
          where: { id: (updateData.deliveryZoneId as string | undefined) ?? existing.deliveryZoneId },
          select: {
            defaultDriver: {
              select: { id: true, role: true, isActive: true, storeId: true },
            },
          },
        });
        const zoneDefault = zone?.defaultDriver;
        effectiveDriverId =
          zoneDefault &&
          zoneDefault.role === "DRIVER" &&
          zoneDefault.isActive &&
          zoneDefault.storeId === store.id &&
          !isSelectedSpokeProvider(zoneDefault.id)
            ? zoneDefault.id
            : null;
      }

      // Only orders still in the pharmacy's hands move; anything picked up,
      // in transit, or settled is deliberately left with its current driver.
      const synced = await prisma.order.updateMany({
        where: {
          recurringOrderId: id,
          storeId: store.id,
          scheduledDate: { gte: getVancouverDeliveryDateInfo().dayStart },
          status: { in: ["PENDING", "ASSIGNED"] },
        },
        data: {
          assignedDriverId: effectiveDriverId,
          status: effectiveDriverId ? "ASSIGNED" : "PENDING",
        },
      });
      reassignedOrders = synced.count;
    }
  }

  return NextResponse.json({ ...updated, reassignedOrders });
}

export async function DELETE(
  req: NextRequest,
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

  const existing = await prisma.recurringOrder.findUnique({ where: { id, storeId: store.id } });
  if (!existing) {
    return NextResponse.json({ error: "Recurring order not found" }, { status: 404 });
  }

  await prisma.$transaction([
    // Delete all skip records (required FK)
    prisma.recurringOrderSkip.deleteMany({ where: { recurringOrderId: id } }),
    // Unlink existing orders (preserve delivery history)
    prisma.order.updateMany({ where: { recurringOrderId: id }, data: { recurringOrderId: null } }),
    // Delete the recurring order
    prisma.recurringOrder.delete({ where: { id } }),
  ]);

  return NextResponse.json({ message: "Recurring order deleted" });
}
