import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { vancouverWeekRange } from "@/lib/vancouverDate";

const TERMINAL_ORDER_STATUSES = ["DELIVERED", "FAILED", "CANCELLED"];

function parseDateInput(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function nextDay(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function nextWeek(date: Date) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export async function POST(
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

  const body = await req.json().catch(() => ({}));
  const requestedSkipDate = parseDateInput(body.skipDate);
  if (body.skipDate && !requestedSkipDate) {
    return NextResponse.json({ error: "skipDate must be a valid date" }, { status: 400 });
  }

  // No date means "Skip This Week": a week-long skip keyed on Vancouver's
  // Sunday, the same week the recurring cron checks.
  const skipDate = requestedSkipDate ?? vancouverWeekRange().weekStart;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : requestedSkipDate
        ? "Held from recurring calendar"
        : "Patient picked up in-store";

  const skip = await prisma.recurringOrderSkip.upsert({
    where: {
      recurringOrderId_skipDate: {
        recurringOrderId: id,
        skipDate,
      },
    },
    update: { reason },
    create: {
      recurringOrderId: id,
      skipDate,
      reason,
      createdById: session.user.id,
    },
  });

  await prisma.order.updateMany({
    where: {
      recurringOrderId: id,
      storeId: store.id,
      status: { notIn: TERMINAL_ORDER_STATUSES },
      scheduledDate: requestedSkipDate
        ? { gte: skipDate, lt: nextDay(skipDate) }
        : { gte: skipDate, lt: nextWeek(skipDate) },
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  return NextResponse.json(skip, { status: 201 });
}
