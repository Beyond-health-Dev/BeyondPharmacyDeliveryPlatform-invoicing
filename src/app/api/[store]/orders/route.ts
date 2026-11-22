import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { resolveStore } from "@/lib/store";
import {
  cleanOptionalText,
  cleanText,
  createOrReuseSavedAddress,
  createPatientWithDefaultAddress,
} from "@/lib/patientAddressRecords";
import { orderMatchesDuplicate } from "@/lib/orderDuplicate";
import {
  parseScheduledDateKey,
  shouldRouteToSpoke,
  SpokeDispatchError,
} from "@/lib/spoke";
import {
  alreadySavedConflict,
  buildExternalDispatchResponse,
  dispatchOrderToSpoke,
  scheduleDeferredSpokeDispatch,
} from "@/lib/spokeDispatch";
import { getVancouverDeliveryDateInfo } from "@/lib/cron";
import { z } from "zod";

const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  patientId: z.string().optional(),
  patientName: z.string().min(1),
  patientPhone: z.string().optional().default(""),
  deliveryAddress: z.string().min(1),
  deliveryCity: z.string().min(1),
  deliveryPostalCode: z.string().min(1),
  deliveryAddressId: z.string().optional(),
  saveAddressToPatient: z.boolean().optional().default(false),
  deliveryZoneId: z.string().min(1),
  instructions: z.string().optional().default(""),
  scheduledDate: z.string().min(1),
  assignedDriverId: z.string().optional(),
  // Explicit staff confirmation that a same-day delivery for the same
  // patient/address is intentional (e.g. a forgotten med). Skips the
  // duplicate 409s; everything else (driver requirement, Spoke routing,
  // idempotency) behaves identically.
  allowDuplicate: z.boolean().optional().default(false),
  isExternalProvider: z.boolean().optional().default(false),
  delivery_company: z.string().optional().default(""),
});

const DUPLICATE_ORDER_MESSAGE =
  "An active order already exists for this patient, address, and date.";
const SPOKE_AUDIT_UNAVAILABLE_MESSAGE =
  "Spoke dispatch audit is unavailable. Please confirm the Spoke database migration has run.";

function getScheduledDateRange(value: string) {
  const scheduledDate = new Date(value);
  if (Number.isNaN(scheduledDate.getTime())) return null;

  const dayStart = new Date(
    Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate()
    )
  );
  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

  return { scheduledDate, dayStart, nextDayStart };
}

function toSpokeOrderError(err: unknown) {
  if (err instanceof SpokeDispatchError) return err;

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2021" || err.code === "P2022")
  ) {
    return new SpokeDispatchError(
      SPOKE_AUDIT_UNAVAILABLE_MESSAGE,
      500,
      null,
      "SETUP"
    );
  }

  return new SpokeDispatchError("Failed to dispatch order to Spoke.", 502);
}

export async function POST(
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

  const body = await req.json();
  const parsed = createOrderSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const patientName = cleanText(data.patientName);
  const patientPhone = cleanOptionalText(data.patientPhone);
  const requestedPatientId = cleanOptionalText(data.patientId);
  const requestedAddressId = cleanOptionalText(data.deliveryAddressId);
  let deliveryAddress = cleanText(data.deliveryAddress);
  let deliveryCity = cleanText(data.deliveryCity);
  let deliveryPostalCode = cleanText(data.deliveryPostalCode);
  const scheduledDateRange = getScheduledDateRange(data.scheduledDate);

  if (!patientName || !deliveryAddress || !deliveryCity || !deliveryPostalCode) {
    return NextResponse.json(
      { error: "patientName, deliveryAddress, deliveryCity, and deliveryPostalCode are required" },
      { status: 400 }
    );
  }

  if (!scheduledDateRange) {
    return NextResponse.json({ error: "Invalid scheduled date" }, { status: 400 });
  }

  // Idempotency: if a previous request with this key already produced an order,
  // return it instead of inserting again.
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    if (existing.storeId !== store.id) {
      return NextResponse.json(
        { error: "Idempotency key conflict" },
        { status: 409 }
      );
    }
    return NextResponse.json(existing, { status: 200 });
  }

  const zone = await prisma.deliveryZone.findUnique({
    where: { id: data.deliveryZoneId, storeId: store.id },
  });
  if (!zone) {
    return NextResponse.json({ error: "Invalid delivery zone" }, { status: 400 });
  }

  // Driver assignment is mandatory for staff-created orders: every order must
  // leave the form with explicit routing (an in-house driver, or the Spoke
  // provider user — e.g. "Anchor" — which routes the order to Spoke).
  if (!data.assignedDriverId) {
    return NextResponse.json(
      { error: "A driver must be assigned before the order can be created" },
      { status: 400 }
    );
  }

  let assignedDriverId: string | null = null;
  let assignedDriver: { id: string; name: string; email: string } | null = null;
  if (data.assignedDriverId) {
    const driver = await prisma.user.findUnique({
      where: { id: data.assignedDriverId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        storeId: true,
      },
    });
    if (!driver || driver.role !== "DRIVER" || !driver.isActive || driver.storeId !== store.id) {
      return NextResponse.json({ error: "Invalid driver" }, { status: 400 });
    }
    assignedDriverId = driver.id;
    assignedDriver = {
      id: driver.id,
      name: driver.name,
      email: driver.email,
    };
  }

  let patientId: string | null = null;
  if (requestedPatientId) {
    const patient = await prisma.patient.findFirst({
      where: { id: requestedPatientId, storeId: store.id },
    });
    if (!patient) {
      return NextResponse.json({ error: "Invalid patient" }, { status: 400 });
    }
    patientId = patient.id;
  }

  let deliveryAddressId: string | null = null;
  if (requestedAddressId) {
    if (!patientId) {
      return NextResponse.json(
        { error: "Saved address requires a patient selection" },
        { status: 400 }
      );
    }
    const addr = await prisma.address.findFirst({
      where: { id: requestedAddressId, patientId },
    });
    if (!addr) {
      return NextResponse.json({ error: "Invalid saved address" }, { status: 400 });
    }
    deliveryAddressId = addr.id;
    deliveryAddress = addr.address;
    deliveryCity = addr.city;
    deliveryPostalCode = addr.postalCode;
  }

  const instructions = data.instructions || null;
  const scheduledDate = scheduledDateRange.scheduledDate;
  const scheduledDateKey = parseScheduledDateKey(data.scheduledDate, scheduledDate);
  const routeToSpoke = shouldRouteToSpoke({
    assignedDriverId,
    isExternalProvider: data.isExternalProvider === true,
    deliveryCompany: cleanOptionalText(data.delivery_company),
  });

  const [sameDayOrders, sameDayDispatches] = await Promise.all([
    prisma.order.findMany({
      where: {
        storeId: store.id,
        status: { not: "CANCELLED" },
        scheduledDate: {
          gte: scheduledDateRange.dayStart,
          lt: scheduledDateRange.nextDayStart,
        },
      },
      select: {
        patientId: true,
        patientName: true,
        deliveryAddress: true,
        deliveryCity: true,
        deliveryPostalCode: true,
        status: true,
      },
    }),
    // Anchor/Spoke deliveries live in ExternalDispatch, not Order — without this
    // leg a re-entered Spoke delivery sails past the duplicate check (Kimbelee
    // Home, Jul 14 2026: two stops created six seconds apart). Everything but
    // CANCELLED blocks; a DISPATCH_FAILED handoff is recovered via its Retry
    // action (same idempotency key), never by re-entering a new order identity.
    // The caller's own key is excluded so a same-key replay still reaches the
    // idempotent 200 path below instead of a 409.
    prisma.externalDispatch.findMany({
      where: {
        storeId: store.id,
        provider: "SPOKE",
        status: { not: "CANCELLED" },
        idempotencyKey: { not: data.idempotencyKey },
        scheduledDate: {
          gte: scheduledDateRange.dayStart,
          lt: scheduledDateRange.nextDayStart,
        },
      },
      select: {
        patientId: true,
        patientName: true,
        deliveryAddress: true,
        deliveryCity: true,
        deliveryPostalCode: true,
        status: true,
      },
    }),
  ]);

  // Staff can explicitly confirm an intentional second same-day delivery via
  // allowDuplicate — the 409s below carry machine-readable metadata so the
  // form can offer that confirmation. Accidental re-entries stay blocked.
  if (!data.allowDuplicate) {
    const duplicateInput = {
      patientId,
      patientName,
      deliveryAddress,
      deliveryCity,
      deliveryPostalCode,
    };

    const duplicate = sameDayOrders.find((order) =>
      orderMatchesDuplicate(order, duplicateInput)
    );

    if (duplicate) {
      return NextResponse.json(
        {
          error: DUPLICATE_ORDER_MESSAGE,
          duplicateBlocked: true,
          existingKind: "IN_HOUSE",
          existingStatus: duplicate.status,
        },
        { status: 409 }
      );
    }

    const duplicateDispatch = sameDayDispatches.find((dispatch) =>
      orderMatchesDuplicate(dispatch, duplicateInput)
    );

    if (duplicateDispatch) {
      return NextResponse.json(
        {
          error: `An Anchor/Spoke delivery already exists for this patient, address, and date (status: ${duplicateDispatch.status}). Manage it from the Orders page instead of re-entering it.`,
          duplicateBlocked: true,
          existingKind: "SPOKE",
          existingStatus: duplicateDispatch.status,
        },
        { status: 409 }
      );
    }
  }

  const savePatientAddress = async (tx: Prisma.TransactionClient) => {
    let finalPatientId = patientId;
    let finalAddressId = deliveryAddressId;

    if (data.saveAddressToPatient && !finalPatientId) {
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
    } else if (data.saveAddressToPatient && finalPatientId && !finalAddressId) {
      const savedAddress = await createOrReuseSavedAddress(
        tx,
        finalPatientId,
        {
          address: deliveryAddress,
          city: deliveryCity,
          postalCode: deliveryPostalCode,
          label: "Saved",
        },
        { label: "Saved" }
      );
      finalAddressId = savedAddress.id;
    }

    return { finalPatientId, finalAddressId };
  };

  if (routeToSpoke) {
    try {
      const existingExternalDispatch = await prisma.externalDispatch.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (existingExternalDispatch && existingExternalDispatch.storeId !== store.id) {
        return NextResponse.json(
          { error: "Idempotency key conflict" },
          { status: 409 }
        );
      }

      // Spoke's unassigned stops carry no machine-readable delivery date, so a
      // stop created before its delivery day sits in Anchor's queue and misses
      // that day's plan. Future-dated orders are held locally as SCHEDULED and
      // released by the daily 6 AM cron on the morning of delivery.
      const todayKey = getVancouverDeliveryDateInfo().dateKey;
      const sendToSpoke =
        scheduledDateKey > todayKey
          ? scheduleDeferredSpokeDispatch
          : dispatchOrderToSpoke;

      const result = await sendToSpoke({
        idempotencyKey: data.idempotencyKey,
        patientId,
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
        deliveryAddressId,
        deliveryZoneId: zone.id,
        deliveryZoneName: zone.name,
        priceAtCreation: zone.price,
        instructions,
        scheduledDate,
        scheduledDateKey,
        createdById: session.user.id,
        onBeforeComplete: async (tx) => {
          const { finalPatientId, finalAddressId } = await savePatientAddress(tx);
          return { patientId: finalPatientId, deliveryAddressId: finalAddressId };
        },
      });

      // The same save again after the order was cancelled, or cancelled
      // while this save sent it: nothing is saved. Answered 409 by the catch
      // below with the message a cancelled held order gets, and the form
      // starts a new request.
      if (result.alreadyDispatched && result.dispatch.status === "CANCELLED") {
        throw alreadySavedConflict(result.dispatch);
      }

      return NextResponse.json(
        buildExternalDispatchResponse(result.dispatch),
        { status: result.alreadyDispatched || existingExternalDispatch ? 200 : 201 }
      );
    } catch (err) {
      const spokeError = toSpokeOrderError(err);

      return NextResponse.json(
        { error: spokeError.message, external: true, provider: "SPOKE" },
        { status: spokeError.statusCode }
      );
    }
  }

  try {
    const order = await prisma.$transaction(async (tx) => {
      const { finalPatientId, finalAddressId } = await savePatientAddress(tx);

      return tx.order.create({
        data: {
          idempotencyKey: data.idempotencyKey,
          patientId: finalPatientId,
          patientName,
          patientPhone,
          deliveryAddress,
          deliveryCity,
          deliveryPostalCode,
          deliveryAddressId: finalAddressId,
          deliveryZoneId: data.deliveryZoneId,
          deliveryZoneName: zone.name,
          priceAtCreation: zone.price,
          instructions,
          scheduledDate,
          status: assignedDriverId ? "ASSIGNED" : "PENDING",
          assignedDriverId,
          createdById: session.user.id,
          storeId: store.id,
        },
      });
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      Array.isArray(err.meta?.target) &&
      (err.meta?.target as string[]).includes("idempotencyKey")
    ) {
      const winner = await prisma.order.findUnique({
        where: { idempotencyKey: data.idempotencyKey },
      });
      if (winner && winner.storeId === store.id) {
        return NextResponse.json(winner, { status: 200 });
      }
    }
    throw err;
  }
}

export async function GET(
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

  const orders = await prisma.order.findMany({
    where: { storeId: store.id },
    include: {
      // Narrow the related rows to identity fields. Notably this stops the full
      // driver User record (including passwordHash) from being serialized.
      assignedDriver: { select: { id: true, name: true, email: true } },
      deliveryZone: { select: { id: true, name: true, price: true } },
    },
    orderBy: { scheduledDate: "desc" },
  });

  return NextResponse.json(orders);
}
