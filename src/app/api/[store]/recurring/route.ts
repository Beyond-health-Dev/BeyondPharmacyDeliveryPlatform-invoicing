import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireStoreAdmin } from "@/lib/storeAccess";
import { resolveStore } from "@/lib/store";
import { getVancouverDeliveryDateInfo, isRecurringScheduleDue } from "@/lib/cron";
import { SpokeDispatchError } from "@/lib/spoke";
import {
  buildRecurringSpokeIdempotencyKey,
  dispatchOrderToSpoke,
  isSelectedSpokeProvider,
} from "@/lib/spokeDispatch";
import {
  cleanOptionalText,
  cleanText,
  createOrReuseSavedAddress,
  createPatientWithDefaultAddress,
} from "@/lib/patientAddressRecords";
import {
  findRecurringDuplicate,
  formatRecurringDuplicateMessage,
  parseRecurringActiveDays,
} from "@/lib/recurringDuplicateGuard";

interface DriverCandidate {
  id: string;
  role: string;
  isActive: boolean;
  storeId: string | null;
}

function normalizeOptionalId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIntervalWeeks(value: unknown) {
  if (value === undefined || value === null || value === "") return 1;
  const interval = Number(value);
  return interval === 1 || interval === 2 ? interval : null;
}

function normalizeAnchorDate(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback;

  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidStoreDriver(
  driver: DriverCandidate | null | undefined,
  storeId: string
): driver is DriverCandidate {
  return !!driver && driver.role === "DRIVER" && driver.isActive && driver.storeId === storeId;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const access = await requireStoreAdmin(await resolveStore(storeSlug));
  if (access.error) return access.error;
  const { store, session } = access;

  const body = await req.json();
  const assignedDriverId = normalizeOptionalId(body.assignedDriverId);
  const recurrenceIntervalWeeks = normalizeIntervalWeeks(body.recurrenceIntervalWeeks);
  const requestedPatientId = cleanOptionalText(body.patientId);
  const requestedAddressId = cleanOptionalText(body.deliveryAddressId);
  const saveAddressToPatient = body.saveAddressToPatient === true;
  const patientName = cleanText(body.patientName);
  const patientPhone = cleanOptionalText(body.patientPhone);
  let deliveryAddress = cleanText(body.deliveryAddress);
  let deliveryCity = cleanText(body.deliveryCity);
  let deliveryPostalCode = cleanText(body.deliveryPostalCode);

  if (!patientName || !deliveryAddress || !deliveryCity || !deliveryPostalCode) {
    return NextResponse.json(
      { error: "patientName, deliveryAddress, deliveryCity, and deliveryPostalCode are required" },
      { status: 400 }
    );
  }

  const activeDays = parseRecurringActiveDays(body.activeDays ?? [1]);
  if (!activeDays) {
    return NextResponse.json(
      { error: "activeDays must be a non-empty array of day numbers (0-6)" },
      { status: 400 }
    );
  }

  if (!recurrenceIntervalWeeks) {
    return NextResponse.json(
      { error: "recurrenceIntervalWeeks must be 1 or 2" },
      { status: 400 }
    );
  }

  const deliveryDate = getVancouverDeliveryDateInfo();
  const recurrenceAnchorDate = normalizeAnchorDate(
    body.recurrenceAnchorDate,
    deliveryDate.dayStart
  );
  if (!recurrenceAnchorDate) {
    return NextResponse.json(
      { error: "recurrenceAnchorDate must be a valid date" },
      { status: 400 }
    );
  }

  const zone = await prisma.deliveryZone.findFirst({
    where: { id: body.deliveryZoneId, storeId: store.id, isActive: true },
    include: {
      defaultDriver: {
        select: { id: true, role: true, isActive: true, storeId: true },
      },
    },
  });

  if (!zone) {
    return NextResponse.json({ error: "Invalid delivery zone" }, { status: 400 });
  }

  let assignedDriver: { id: string; name: string; email: string } | null = null;
  if (assignedDriverId) {
    const driver = await prisma.user.findFirst({
      where: {
        id: assignedDriverId,
        role: "DRIVER",
        isActive: true,
        storeId: store.id,
      },
      select: { id: true, name: true, email: true },
    });

    if (!driver) {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }
    assignedDriver = driver;
  }

  const patientId = requestedPatientId;
  if (requestedPatientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: requestedPatientId, storeId: store.id },
      select: { id: true },
    });

    if (!patient) {
      return NextResponse.json({ error: "Invalid patient" }, { status: 400 });
    }
  }

  let deliveryAddressId: string | null = null;
  if (requestedAddressId) {
    if (!patientId) {
      return NextResponse.json(
        { error: "Saved address requires a patient selection" },
        { status: 400 }
      );
    }

    const address = await prisma.address.findFirst({
      where: { id: requestedAddressId, patientId },
    });

    if (!address) {
      return NextResponse.json({ error: "Invalid saved address" }, { status: 400 });
    }

    deliveryAddressId = address.id;
    deliveryAddress = address.address;
    deliveryCity = address.city;
    deliveryPostalCode = address.postalCode;
  }

  const duplicate = await findRecurringDuplicate(prisma, {
    storeId: store.id,
    patientId,
    patientName,
    patientPhone,
    deliveryAddress,
    deliveryCity,
    deliveryPostalCode,
    activeDays,
  });

  if (duplicate) {
    return NextResponse.json(
      { error: formatRecurringDuplicateMessage({ patientName }, duplicate) },
      { status: 409 }
    );
  }

  const dueToday =
    activeDays.includes(deliveryDate.dayOfWeek) &&
    isRecurringScheduleDue(
      { recurrenceIntervalWeeks, recurrenceAnchorDate },
      deliveryDate
    );
  const routeTodayToSpoke = isSelectedSpokeProvider(assignedDriverId);

  const { recurringOrder, finalPatientId, finalAddressId } = await prisma.$transaction(async (tx) => {
    let finalPatientId = patientId;
    let finalAddressId = deliveryAddressId;

    if (saveAddressToPatient && !finalPatientId) {
      const created = await createPatientWithDefaultAddress(tx, {
        name: patientName,
        phone: patientPhone,
        address: deliveryAddress,
        city: deliveryCity,
        postalCode: deliveryPostalCode,
        storeId: store.id,
      });
      finalPatientId = created.patient.id;
      finalAddressId = created.address.id;
    } else if (saveAddressToPatient && finalPatientId && !finalAddressId) {
      const savedAddress = await createOrReuseSavedAddress(
        tx,
        finalPatientId,
        {
          label: "Saved",
          address: deliveryAddress,
          city: deliveryCity,
          postalCode: deliveryPostalCode,
        },
        { label: "Saved" }
      );
      finalAddressId = savedAddress.id;
    }

    const createdRecurringOrder = await tx.recurringOrder.create({
      data: {
        patientId: finalPatientId,
        patientName,
        patientPhone,
        deliveryAddress,
        deliveryCity,
        deliveryPostalCode,
        deliveryZoneId: zone.id,
        instructions: body.instructions || null,
        assignedDriverId,
        activeDays: JSON.stringify(activeDays),
        recurrenceIntervalWeeks,
        recurrenceAnchorDate,
        createdById: session.user.id,
        storeId: store.id,
      },
      include: { deliveryZone: true },
    });

    // If today is an active day, immediately create today's internal Order unless
    // the recurring profile explicitly selected the Spoke/Anchor provider.
    if (dueToday && !routeTodayToSpoke) {
      const defaultDriverId = isValidStoreDriver(zone.defaultDriver, store.id)
        ? zone.defaultDriver.id
        : null;
      const driverId = assignedDriverId || defaultDriverId;
      const status = driverId ? "ASSIGNED" : "PENDING";
      try {
        await tx.order.create({
          data: {
            patientId: finalPatientId,
            patientName,
            patientPhone,
            deliveryAddress,
            deliveryCity,
            deliveryPostalCode,
            deliveryAddressId: finalAddressId,
            deliveryZoneId: zone.id,
            deliveryZoneName: createdRecurringOrder.deliveryZone.name,
            priceAtCreation: createdRecurringOrder.deliveryZone.price,
            instructions: body.instructions || null,
            status,
            assignedDriverId: driverId,
            scheduledDate: deliveryDate.dayStart,
            recurringOrderId: createdRecurringOrder.id,
            createdById: session.user.id,
            storeId: store.id,
          },
        });
      } catch (err) {
        // Dedup: the unique (recurringOrderId, scheduledDate) constraint means
        // the cron already created today's order. Any OTHER database failure is
        // real and must fail the transaction — not be mislabelled a duplicate.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
          throw err;
        }
      }
    }

    return { recurringOrder: createdRecurringOrder, finalPatientId, finalAddressId };
  });

  if (dueToday && routeTodayToSpoke) {
    try {
      await dispatchOrderToSpoke({
        idempotencyKey: buildRecurringSpokeIdempotencyKey(
          recurringOrder.id,
          deliveryDate.dateKey
        ),
        patientId: finalPatientId,
        store: {
          id: store.id,
          slug: store.slug,
          name: store.name,
        },
        selectedProviderUser: assignedDriver,
        patientName,
        patientPhone,
        deliveryAddress,
        deliveryCity,
        deliveryPostalCode,
        deliveryAddressId: finalAddressId,
        deliveryZoneId: zone.id,
        deliveryZoneName: recurringOrder.deliveryZone.name,
        priceAtCreation: recurringOrder.deliveryZone.price,
        instructions: body.instructions || null,
        scheduledDate: deliveryDate.dayStart,
        scheduledDateKey: deliveryDate.dateKey,
        createdById: session.user.id,
      });
    } catch (err) {
      const spokeError =
        err instanceof SpokeDispatchError
          ? err
          : new SpokeDispatchError("Failed to contact Spoke.", 502);

      return NextResponse.json(
        {
          // The profile itself committed before the dispatch attempt — say so,
          // or staff re-enter it and trip the duplicate guard.
          error: `Recurring profile was saved, but today's Spoke dispatch failed: ${spokeError.message} Use "Generate Today's Orders" to retry.`,
          external: true,
          provider: "SPOKE",
          recurringOrder,
        },
        { status: spokeError.statusCode }
      );
    }
  }

  return NextResponse.json(recurringOrder, { status: 201 });
}
