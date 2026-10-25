import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isRecurringScheduleDue } from "@/lib/cron";
import {
  findRecurringSkipForDate,
  isVacationHoldActive,
  recurringSkipScope,
} from "@/lib/recurringHolds";
import {
  recurringPeopleMatch,
  type RecurringPersonInput,
} from "@/lib/recurringDuplicateGuard";
import { resolveStore } from "@/lib/store";

const MAX_RANGE_DAYS = 93;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateParam(value: string | null) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function dateKey(date: Date) {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function utcWeekStart(date: Date) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function parseActiveDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    ) {
      return parsed as number[];
    }
  } catch {
    return null;
  }

  return null;
}

function sameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
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

  const start = parseDateParam(req.nextUrl.searchParams.get("start"));
  const end = parseDateParam(req.nextUrl.searchParams.get("end"));
  if (!start || !end || end <= start) {
    return NextResponse.json(
      { error: "start and end must be valid YYYY-MM-DD dates" },
      { status: 400 }
    );
  }

  const rangeDays = Math.ceil((end.getTime() - start.getTime()) / MS_PER_DAY);
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: `Calendar range cannot exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 }
    );
  }

  const skipRangeStart = utcWeekStart(start);
  const recurringOrders = await prisma.recurringOrder.findMany({
    where: { storeId: store.id, isActive: true },
    include: {
      assignedDriver: { select: { name: true } },
      deliveryZone: { select: { name: true, price: true } },
      skips: {
        where: {
          skipDate: { gte: skipRangeStart, lt: end },
        },
      },
      orders: {
        where: {
          scheduledDate: { gte: start, lt: end },
        },
        select: { id: true, scheduledDate: true, status: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const instances = [];
  // De-dup identical recurring profiles per calendar day. Bucketed by date so the
  // fuzzy match only runs against same-day candidates instead of every instance seen.
  const seenByDate = new Map<string, RecurringPersonInput[]>();

  for (const recurring of recurringOrders) {
    const activeDays = parseActiveDays(recurring.activeDays);
    if (!activeDays) continue;

    for (let day = start; day < end; day = addDays(day, 1)) {
      if (!activeDays.includes(day.getUTCDay())) continue;

      const weekStart = utcWeekStart(day);
      if (!isRecurringScheduleDue(recurring, { weekStart })) continue;

      const skip = findRecurringSkipForDate(recurring.skips, { dayStart: day, weekStart });
      const templateHold = isVacationHoldActive(recurring, day);
      const order = recurring.orders.find((candidate) =>
        sameUtcDay(candidate.scheduledDate, day)
      );
      const instanceDate = dateKey(day);
      const person = {
        patientId: recurring.patientId,
        patientName: recurring.patientName,
        patientPhone: recurring.patientPhone,
        deliveryAddress: recurring.deliveryAddress,
        deliveryCity: recurring.deliveryCity,
        deliveryPostalCode: recurring.deliveryPostalCode,
      };

      const seenForDate = seenByDate.get(instanceDate);
      if (seenForDate?.some((seen) => recurringPeopleMatch(seen, person))) {
        continue;
      }
      if (seenForDate) {
        seenForDate.push(person);
      } else {
        seenByDate.set(instanceDate, [person]);
      }

      instances.push({
        id: `${recurring.id}:${instanceDate}`,
        recurringOrderId: recurring.id,
        date: instanceDate,
        patientName: recurring.patientName,
        deliveryAddress: recurring.deliveryAddress,
        deliveryCity: recurring.deliveryCity,
        zoneName: recurring.deliveryZone.name,
        zonePrice: recurring.deliveryZone.price,
        assignedDriverName: recurring.assignedDriver?.name ?? null,
        assignedDriverId: recurring.assignedDriverId,
        recurrenceIntervalWeeks: recurring.recurrenceIntervalWeeks,
        isHeld: !!skip || templateHold,
        // WEEK: Skip This Week from the profile list; INSTANCE: a one-day
        // hold; TEMPLATE: the profile's vacation hold.
        holdType: skip
          ? recurringSkipScope(skip) === "WEEK"
            ? "WEEK"
            : "INSTANCE"
          : templateHold
            ? "TEMPLATE"
            : null,
        skipDate: skip ? dateKey(skip.skipDate) : null,
        holdReason: skip?.reason ?? null,
        generatedOrderId: order?.id ?? null,
        generatedOrderStatus: order?.status ?? null,
      });
    }
  }

  return NextResponse.json({
    start: dateKey(start),
    end: dateKey(end),
    instances,
  });
}
