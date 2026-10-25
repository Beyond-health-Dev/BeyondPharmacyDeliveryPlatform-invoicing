import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { undoWeekSkip } from "@/lib/recurringHolds";
import { vancouverWeekRange } from "@/lib/vancouverDate";

function parseDateInput(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
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

  if (requestedSkipDate && body.scope !== "WEEK") {
    // The calendar's Resume on a one-day hold.
    await prisma.recurringOrderSkip.deleteMany({
      where: { recurringOrderId: id, skipDate: requestedSkipDate },
    });
    return NextResponse.json({ success: true });
  }

  // Undo Skip This Week: the list's Unskip (this week), or the calendar's
  // Resume Week (the week skip's own date). Only the week skip goes; a
  // one-day hold it took over on its Sunday comes back.
  const row = await prisma.recurringOrderSkip.findUnique({
    where: {
      recurringOrderId_skipDate: {
        recurringOrderId: id,
        skipDate: requestedSkipDate ?? vancouverWeekRange().weekStart,
      },
    },
  });
  const undo = undoWeekSkip(row);
  if (row && undo === "delete") {
    await prisma.recurringOrderSkip.deleteMany({ where: { id: row.id } });
  } else if (row && undo === "restoreDay") {
    await prisma.recurringOrderSkip.updateMany({ where: { id: row.id }, data: { scope: "DAY" } });
  }

  return NextResponse.json({ success: true });
}
