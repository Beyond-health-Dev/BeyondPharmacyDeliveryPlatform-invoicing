import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import { WEEK_SKIP_REASON } from "@/lib/recurringHolds";
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

  await prisma.recurringOrderSkip.deleteMany({
    where: requestedSkipDate
      ? // The calendar's Resume: whatever holds that date.
        { recurringOrderId: id, skipDate: requestedSkipDate }
      : // The list's Unskip: this week's Skip This Week only, never a
        // one-day hold on its Sunday. (Rows saved before the scope was
        // recorded are week skips when they carry the week-skip reason.)
        {
          recurringOrderId: id,
          skipDate: vancouverWeekRange().weekStart,
          OR: [{ scope: "WEEK" }, { scope: null, reason: WEEK_SKIP_REASON }],
        },
  });

  return NextResponse.json({ success: true });
}
