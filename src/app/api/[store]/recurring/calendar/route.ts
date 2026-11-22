import { NextRequest, NextResponse } from "next/server";
import { requireStoreAdmin } from "@/lib/storeAccess";
import { prisma } from "@/lib/db";
import { isRecurringScheduleDue } from "@/lib/cron";
import { isVacationHoldActive, sameUtcDay } from "@/lib/recurringHolds";
import { holdsForCalendarDate } from "@/lib/weeklyHolds";
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const access = await requireStoreAdmin(await resolveStore(storeSlug));
  if (access.error) return access.error;
  const { store } = access;

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

  // Every scheduled delivery in the range, oldest profile first, as the order
  // generator walks them.
  const candidates: Array<{
    recurring: (typeof recurringOrders)[number];
    day: Date;
    weekStart: Date;
    instanceDate: string;
    onVacation: boolean;
    person: RecurringPersonInput;
  }> = [];
  for (const recurring of recurringOrders) {
    const activeDays = parseActiveDays(recurring.activeDays);
    if (!activeDays) continue;

    for (let day = start; day < end; day = addDays(day, 1)) {
      if (!activeDays.includes(day.getUTCDay())) continue;

      const weekStart = utcWeekStart(day);
      if (!isRecurringScheduleDue(recurring, { weekStart })) continue;

      candidates.push({
        recurring,
        day,
        weekStart,
        instanceDate: dateKey(day),
        onVacation: isVacationHoldActive(recurring, day),
        person: {
          patientId: recurring.patientId,
          patientName: recurring.patientName,
          patientPhone: recurring.patientPhone,
          deliveryAddress: recurring.deliveryAddress,
          deliveryCity: recurring.deliveryCity,
          deliveryPostalCode: recurring.deliveryPostalCode,
        },
      });
    }
  }

  // De-dup identical recurring profiles per calendar day the way the order
  // generator does. It drops profiles on vacation first, so a newer profile
  // for the same patient still delivers; a vacation is shown only when no
  // other profile delivers to that patient that day. It checks day and week
  // skips after de-duping, so a skipped profile still stands in for its
  // duplicates. Bucketed by date so the fuzzy match only runs against same-day
  // candidates instead of every instance seen.
  const seenByDate = new Map<string, RecurringPersonInput[]>();
  const shown = new Set<(typeof candidates)[number]>();
  for (const vacationPass of [false, true]) {
    for (const candidate of candidates) {
      if (candidate.onVacation !== vacationPass) continue;
      const seenForDate = seenByDate.get(candidate.instanceDate);
      if (seenForDate?.some((seen) => recurringPeopleMatch(seen, candidate.person))) {
        continue;
      }
      if (seenForDate) {
        seenForDate.push(candidate.person);
      } else {
        seenByDate.set(candidate.instanceDate, [candidate.person]);
      }
      shown.add(candidate);
    }
  }

  const instances = candidates
    .filter((candidate) => shown.has(candidate))
    .map(({ recurring, day, weekStart, instanceDate }) => {
      const holdDetails = holdsForCalendarDate(recurring.skips, recurring, day, weekStart);
      const hold = holdDetails[0];
      const order = recurring.orders.find((candidate) =>
        sameUtcDay(candidate.scheduledDate, day)
      );
      return {
        id: `${recurring.id}:${instanceDate}`,
        recurringOrderId: recurring.id,
        date: instanceDate,
        patientId: recurring.patientId,
        patientName: recurring.patientName,
        deliveryAddress: recurring.deliveryAddress,
        deliveryCity: recurring.deliveryCity,
        zoneName: recurring.deliveryZone.name,
        zonePrice: recurring.deliveryZone.price,
        assignedDriverName: recurring.assignedDriver?.name ?? null,
        assignedDriverId: recurring.assignedDriverId,
        recurrenceIntervalWeeks: recurring.recurrenceIntervalWeeks,
        isHeld: !!hold,
        holdType: hold?.type ?? null,
        skipDate: hold?.type === "WEEK" ? dateKey(weekStart) : hold?.type === "INSTANCE" ? instanceDate : null,
        holdReason: hold?.reason ?? null,
        holdDetails,
        generatedOrderId: order?.id ?? null,
        generatedOrderStatus: order?.status ?? null,
      };
    });

  return NextResponse.json({
    start: dateKey(start),
    end: dateKey(end),
    instances,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
