import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getVancouverDeliveryDateInfo, isRecurringScheduleDue } from "@/lib/cron";
import { hasRecurringSkipForDate, isVacationHoldActive } from "@/lib/recurringHolds";
import {
  recurringPeopleMatch,
  type RecurringPersonInput,
} from "@/lib/recurringDuplicateGuard";
import { resolveStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseActiveDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6
      )
    ) {
      return parsed as number[];
    }
  } catch {
    return null;
  }

  return null;
}

function buildDateInfo(dateKey: string) {
  const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) return null;

  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  return {
    dateKey,
    dayOfWeek: dayStart.getUTCDay(),
    dayStart,
    nextDayStart,
    weekStart,
    weekEnd,
  };
}

function resolveExportDate(req: NextRequest) {
  const dateParam = req.nextUrl.searchParams.get("date");
  if (!dateParam) return getVancouverDeliveryDateInfo();
  if (!DATE_PARAM_PATTERN.test(dateParam)) return null;

  return buildDateInfo(dateParam);
}

function csvCell(value: string | null | undefined) {
  if (!value) return "";
  return `"${value.replace(/"/g, '""')}"`;
}

function fullAddress(input: {
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPostalCode: string;
}) {
  return [
    input.deliveryAddress,
    input.deliveryCity,
    input.deliveryPostalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
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

  const deliveryDate = resolveExportDate(req);
  if (!deliveryDate) {
    return NextResponse.json(
      { error: "date must be a valid YYYY-MM-DD value" },
      { status: 400 }
    );
  }

  const recurringOrders = await prisma.recurringOrder.findMany({
    where: {
      storeId: store.id,
      isActive: true,
    },
    include: {
      skips: {
        where: {
          skipDate: { gte: deliveryDate.weekStart, lt: deliveryDate.weekEnd },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const rows: string[] = [];
  const seenDueRecurringPeople: Array<RecurringPersonInput> = [];

  for (const recurring of recurringOrders) {
    if (isVacationHoldActive(recurring, deliveryDate.dayStart)) continue;

    const activeDays = parseActiveDays(recurring.activeDays);
    if (!activeDays) continue;
    if (!activeDays.includes(deliveryDate.dayOfWeek)) continue;
    if (!isRecurringScheduleDue(recurring, deliveryDate)) continue;
    if (hasRecurringSkipForDate(recurring.skips, deliveryDate)) continue;

    const recurringPerson = {
      patientId: recurring.patientId,
      patientName: recurring.patientName,
      patientPhone: recurring.patientPhone,
      deliveryAddress: recurring.deliveryAddress,
      deliveryCity: recurring.deliveryCity,
      deliveryPostalCode: recurring.deliveryPostalCode,
    };
    if (
      seenDueRecurringPeople.some((person) =>
        recurringPeopleMatch(person, recurringPerson)
      )
    ) {
      continue;
    }
    seenDueRecurringPeople.push(recurringPerson);

    rows.push(
      [
        csvCell(recurring.patientName),
        csvCell(recurring.patientPhone),
        csvCell(fullAddress(recurring)),
      ].join(",")
    );
  }

  const csv = ["Patient Name,Phone Number,Address", ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="recurring-orders-${store.slug}-${deliveryDate.dateKey}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
