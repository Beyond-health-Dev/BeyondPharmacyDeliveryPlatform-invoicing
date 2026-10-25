import cron from "node-cron";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import {
  recurringPeopleMatch,
  type RecurringPersonInput,
} from "./recurringDuplicateGuard";
import { hasRecurringSkipForDate, isVacationHoldActive } from "./recurringHolds";
import { getSpokeProviderUserIds } from "./spoke";
import {
  buildRecurringSpokeIdempotencyKey,
  dispatchOrderToSpoke,
  isSelectedSpokeProvider,
} from "./spokeDispatch";

const DELIVERY_TIME_ZONE = "America/Vancouver";
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
// Stop the generation run before the platform's 60s function limit kills it
// mid-loop (Spoke's 5 req/s write cap makes large dispatch batches slow).
const GENERATION_TIME_BUDGET_MS = 50_000;

let initialized = false;

export function initCronJobs() {
  if (initialized) return;
  initialized = true;

  if (process.env.VERCEL === "1") {
    console.log(
      "[CRON] Skipping in-process schedulers on Vercel; Vercel Cron handles generation and cleanup."
    );
  } else {
    // Run every day at 6:00 AM to generate orders from recurring templates
    cron.schedule("0 6 * * *", async () => {
      console.log("[CRON] Generating recurring orders...");
      await generateRecurringOrders();
    });

    // Run every day at 2:00 AM to purge old invoiced records (3-month retention).
    // On Vercel this timer would never fire (instances are frozen between
    // requests), so the /api/cron/purge route + Vercel Cron handles it there.
    cron.schedule("0 2 * * *", async () => {
      console.log("[CRON] Running 3-month data cleanup...");
      await purgeOldInvoicedOrders();
    });
  }

  console.log("[CRON] Recurring order scheduler initialized");
  console.log("[CRON] Data retention cleanup scheduler initialized");
}

interface DeliveryDateInfo {
  dateKey: string;
  dayOfWeek: number;
  dayStart: Date;
  nextDayStart: Date;
  weekStart: Date;
  weekEnd: Date;
}

interface DriverCandidate {
  id: string;
  role: string;
  isActive: boolean;
  storeId: string | null;
  name?: string;
  email?: string;
}

interface RecurrenceSchedule {
  recurrenceIntervalWeeks: number;
  recurrenceAnchorDate: Date;
}

export interface RecurringGenerationResult {
  dateKey: string;
  total: number;
  due: number;
  created: number;
  existing: number;
  skipped: number;
  unprocessed: number;
}

export function getVancouverDeliveryDateInfo(now = new Date()): DeliveryDateInfo {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DELIVERY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dateKey = `${part("year")}-${part("month")}-${part("day")}`;
  const dayStart = new Date(`${dateKey}T00:00:00.000Z`);
  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[part("weekday")] ?? dayStart.getUTCDay();

  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  return { dateKey, dayOfWeek, dayStart, nextDayStart, weekStart, weekEnd };
}

export function isVancouverSixAmWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DELIVERY_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  return parts.find((p) => p.type === "hour")?.value === "06";
}

export function formatGenerationMessage(result: RecurringGenerationResult) {
  if (result.unprocessed > 0) {
    return `${result.created} order${result.created === 1 ? "" : "s"} generated before the time limit — ${result.unprocessed} profile(s) remaining. Click "Generate Today's Orders" again to continue.`;
  }

  if (result.created > 0) {
    return `${result.created} order${result.created === 1 ? "" : "s"} generated for today.`;
  }

  if (result.existing > 0) {
    return "Today's recurring orders have already been generated.";
  }

  return "No recurring orders are due today.";
}

function parseActiveDays(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((d) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return parsed as number[];
    }
  } catch {
    // Invalid JSON is handled by skipping the affected recurring order.
  }

  return null;
}

function validDriverId(driver: DriverCandidate | null | undefined, storeId: string) {
  if (!driver) return null;
  if (driver.role !== "DRIVER" || !driver.isActive || driver.storeId !== storeId) {
    return null;
  }
  return driver.id;
}

function utcWeekStart(date: Date) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

export function isRecurringScheduleDue(
  recurring: RecurrenceSchedule,
  deliveryDate: Pick<DeliveryDateInfo, "weekStart">
) {
  const interval = recurring.recurrenceIntervalWeeks;
  if (interval <= 1) return true;

  const anchorWeekStart = utcWeekStart(recurring.recurrenceAnchorDate);
  const weeksSinceAnchor = Math.floor(
    (deliveryDate.weekStart.getTime() - anchorWeekStart.getTime()) / MS_PER_WEEK
  );

  return weeksSinceAnchor >= 0 && weeksSinceAnchor % interval === 0;
}

export interface RecurringGenerationOptions {
  // Wall-clock budget for the whole run; the loop stops cleanly when exceeded.
  timeBudgetMs?: number;
  // The caller will automatically start a continuation run — switches the
  // incomplete-notification wording from "click to continue" to "auto-continuing".
  autoContinuing?: boolean;
  // The stalled-dispatch watchdog must run at most once per day (first cron
  // leg); continuations and manual re-runs pass false to avoid duplicate alerts.
  runStallWatchdog?: boolean;
  // Whether a budget stop creates a "Generation Incomplete" notification.
  notifyOnIncomplete?: boolean;
}

export async function generateRecurringOrders(
  now = new Date(),
  opts: RecurringGenerationOptions = {}
): Promise<RecurringGenerationResult> {
  const deliveryDate = getVancouverDeliveryDateInfo(now);
  const timeBudgetMs = opts.timeBudgetMs ?? GENERATION_TIME_BUDGET_MS;
  // Budget covers the whole run (deferred-dispatch release + generation loop).
  const startedAt = Date.now();

  // Batch: auto-clear all expired holds in one query
  const clearedHolds = await prisma.recurringOrder.updateMany({
    where: { isOnHold: true, holdEnd: { lt: deliveryDate.dayStart } },
    data: { isOnHold: false, holdStart: null, holdEnd: null },
  });
  if (clearedHolds.count > 0) {
    console.log(`[CRON] Auto-cleared ${clearedHolds.count} expired vacation holds`);
  }

  // Release future-dated manual Spoke handoffs whose delivery day has arrived,
  // and flag yesterday's stops that Anchor never progressed.
  const releasedDispatches = await releaseDueSpokeDispatches(deliveryDate);
  if (releasedDispatches > 0) {
    console.log(`[CRON] Released ${releasedDispatches} scheduled Spoke dispatch(es)`);
  }
  if (opts.runStallWatchdog !== false) {
    const stalledDispatches = await flagStalledSpokeDispatches(deliveryDate);
    if (stalledDispatches > 0) {
      console.log(`[CRON] Flagged ${stalledDispatches} stalled Spoke dispatch(es) from yesterday`);
    }
  }

  // Active recurring orders whose vacation hold (if any) doesn't cover today.
  // A hold set ahead of time must not stop the deliveries before it starts.
  const activeRecurringOrders = await prisma.recurringOrder.findMany({
    where: {
      isActive: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      assignedDriver: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          storeId: true,
        },
      },
      deliveryZone: {
        include: {
          defaultDriver: {
            select: { id: true, role: true, isActive: true, storeId: true },
          },
        },
      },
      store: true,
      skips: {
        where: {
          skipDate: { gte: deliveryDate.weekStart, lt: deliveryDate.weekEnd },
        },
      },
    },
  });

  const recurringOrders = activeRecurringOrders.filter(
    (recurring) => !isVacationHoldActive(recurring, deliveryDate.dayStart)
  );

  // Batch dedup: fetch all today's orders from recurring templates in one query
  const existingOrders = await prisma.order.findMany({
    where: {
      recurringOrderId: { not: null },
      scheduledDate: { gte: deliveryDate.dayStart, lt: deliveryDate.nextDayStart },
    },
    select: { recurringOrderId: true },
  });
  const existingSet = new Set(existingOrders.map((o) => o.recurringOrderId));

  // Person-level dedup seed: EVERY live delivery already scheduled for today,
  // regardless of source. A deferred manual Spoke order released minutes before
  // this loop (or a manual in-house order entered yesterday for today) is
  // invisible to the id-based dedup sets above — on Jul 10 2026 that produced
  // double deliveries for three patients (manual stop + recurring stop).
  const todaysLiveOrders = await prisma.order.findMany({
    where: {
      status: { not: "CANCELLED" },
      scheduledDate: { gte: deliveryDate.dayStart, lt: deliveryDate.nextDayStart },
    },
    select: {
      storeId: true,
      patientId: true,
      patientName: true,
      patientPhone: true,
      deliveryAddress: true,
      deliveryCity: true,
      deliveryPostalCode: true,
    },
  });

  // Profiles with a live Spoke dispatch today are also "handled": after an
  // Anchor → in-house reassignment mid-day, regenerating must not create a
  // duplicate in-house order while the Spoke stop is still active. Cancelled
  // and failed dispatches don't block, so the cancel-then-regenerate flow and
  // failed-dispatch retries keep working.
  const todaysLiveDispatches = await prisma.externalDispatch.findMany({
    where: {
      provider: "SPOKE",
      scheduledDate: { gte: deliveryDate.dayStart, lt: deliveryDate.nextDayStart },
      status: { notIn: ["CANCELLED", "DISPATCH_FAILED"] },
    },
    select: {
      idempotencyKey: true,
      storeId: true,
      patientId: true,
      patientName: true,
      patientPhone: true,
      deliveryAddress: true,
      deliveryCity: true,
      deliveryPostalCode: true,
    },
  });
  const spokeHandledSet = new Set(
    todaysLiveDispatches
      .filter((d) => d.idempotencyKey.startsWith("recurring:"))
      .map((d) => d.idempotencyKey.split(":")[1])
      .filter(Boolean)
  );

  // Bucket today's already-live deliveries (orders + dispatches, any source)
  // by store for the fuzzy person match.
  const preexistingPeopleByStore = new Map<string, RecurringPersonInput[]>();
  for (const row of [...todaysLiveOrders, ...todaysLiveDispatches]) {
    const bucket = preexistingPeopleByStore.get(row.storeId);
    const person = {
      patientId: row.patientId,
      patientName: row.patientName,
      patientPhone: row.patientPhone,
      deliveryAddress: row.deliveryAddress,
      deliveryCity: row.deliveryCity,
      deliveryPostalCode: row.deliveryPostalCode,
    };
    if (bucket) {
      bucket.push(person);
    } else {
      preexistingPeopleByStore.set(row.storeId, [person]);
    }
  }

  // Fail closed if the Spoke provider configuration goes missing: anyone who
  // has ever been the selected provider on a dispatch is a known Spoke
  // provider. If SPOKE_PROVIDER_USER_IDS no longer contains them (unset,
  // typo'd, redeploy accident), generating an internal order for that driver
  // would silently strand deliveries on an account nobody logs into.
  const configuredSpokeProviderIds = getSpokeProviderUserIds();
  const historicalProviders = await prisma.externalDispatch.findMany({
    where: { provider: "SPOKE", selectedProviderUserId: { not: null } },
    select: { selectedProviderUserId: true },
    distinct: ["selectedProviderUserId"],
  });
  const unconfiguredSpokeProviderIds = new Set(
    historicalProviders
      .map((row) => row.selectedProviderUserId as string)
      .filter((providerId) => !configuredSpokeProviderIds.has(providerId))
  );
  const misconfiguredByStore = new Map<string, number>();

  let created = 0;
  let due = 0;
  let existing = 0;
  let skipped = 0;
  let unprocessed = 0;
  let processedCount = 0;
  // De-dup identical recurring profiles that are due today. Bucketed by store so the
  // fuzzy match only runs against same-store candidates instead of every profile seen.
  const seenDueByStore = new Map<string, Array<RecurringPersonInput & { storeId: string }>>();

  for (const recurring of recurringOrders) {
    // Stop cleanly before the platform kills the function mid-loop. The dedup
    // sets + Spoke idempotency keys make a re-run resume exactly where this
    // left off, so nothing is lost — staff just need to know to re-run.
    if (Date.now() - startedAt > timeBudgetMs) {
      unprocessed = recurringOrders.length - processedCount;
      console.warn(
        `[CRON] Generation time budget reached — ${unprocessed} profile(s) left unprocessed; ${
          opts.autoContinuing
            ? "a continuation run will pick them up"
            : 're-run "Generate Today\'s Orders" to continue'
        }`
      );
      if (opts.notifyOnIncomplete !== false) {
        const message = opts.autoContinuing
          ? `Recurring order generation hit its time limit with ${unprocessed} profile(s) remaining — an automatic continuation has started. If this alert keeps appearing without the count going down, click "Generate Today's Orders".`
          : `Recurring order generation ran out of time — ${unprocessed} profile(s) not yet processed. Click "Generate Today's Orders" to continue where it left off.`;
        const remainingStoreIds = new Set(
          recurringOrders.slice(processedCount).map((r) => r.storeId)
        );
        for (const storeId of remainingStoreIds) {
          try {
            await prisma.notification.create({
              data: { type: "GENERATION_INCOMPLETE", message, storeId },
            });
          } catch (notifyErr) {
            console.error(
              "[CRON] Failed to record incomplete-generation notification:",
              notifyErr
            );
          }
        }
      }
      break;
    }
    processedCount++;

    // Parse activeDays and check if today is a delivery day
    const activeDays = parseActiveDays(recurring.activeDays);
    if (!activeDays) {
      console.warn(`[CRON] Skipping recurring order for ${recurring.patientName} (invalid activeDays)`);
      skipped++;
      continue;
    }
    if (!activeDays.includes(deliveryDate.dayOfWeek)) continue;
    if (!isRecurringScheduleDue(recurring, deliveryDate)) continue;

    due++;

    const recurringPerson = {
      storeId: recurring.storeId,
      patientId: recurring.patientId,
      patientName: recurring.patientName,
      patientPhone: recurring.patientPhone,
      deliveryAddress: recurring.deliveryAddress,
      deliveryCity: recurring.deliveryCity,
      deliveryPostalCode: recurring.deliveryPostalCode,
    };
    const seenForStore = seenDueByStore.get(recurring.storeId);
    if (seenForStore?.some((person) => recurringPeopleMatch(person, recurringPerson))) {
      console.log(`[CRON] Skipping duplicate recurring profile for ${recurring.patientName}`);
      skipped++;
      continue;
    }
    if (seenForStore) {
      seenForStore.push(recurringPerson);
    } else {
      seenDueByStore.set(recurring.storeId, [recurringPerson]);
    }

    // One-day holds from the calendar, and Skip This Week.
    if (hasRecurringSkipForDate(recurring.skips, deliveryDate)) {
      console.log(`[CRON] Skipping recurring order for ${recurring.patientName} (skip record exists)`);
      skipped++;
      continue;
    }

    // Batch dedup check (no per-order query)
    if (existingSet.has(recurring.id)) {
      console.log(`[CRON] Order already exists for ${recurring.patientName} today`);
      existing++;
      continue;
    }

    // A live delivery for this person/address already exists today from ANY
    // source — e.g. a deferred manual Spoke order released this same morning,
    // or a manual in-house order entered yesterday for today. Don't deliver
    // twice via the profile. (A profile at a DIFFERENT address still generates
    // — the fuzzy match requires the address to agree.)
    const preexisting = preexistingPeopleByStore.get(recurring.storeId);
    if (
      preexisting?.some((person) => recurringPeopleMatch(person, recurringPerson))
    ) {
      console.log(
        `[CRON] Skipping ${recurring.patientName} — a live delivery for this person/address already exists today`
      );
      existing++;
      continue;
    }

    const selectedDriverId = validDriverId(
      recurring.assignedDriver,
      recurring.storeId
    );

    if (isSelectedSpokeProvider(selectedDriverId)) {
      try {
        const result = await dispatchOrderToSpoke({
          idempotencyKey: buildRecurringSpokeIdempotencyKey(
            recurring.id,
            deliveryDate.dateKey
          ),
          patientId: recurring.patientId,
          store: {
            id: recurring.store.id,
            slug: recurring.store.slug,
            name: recurring.store.name,
          },
          selectedProviderUser: recurring.assignedDriver
            ? {
                id: recurring.assignedDriver.id,
                name: recurring.assignedDriver.name ?? "Anchor",
                email: recurring.assignedDriver.email ?? "",
              }
            : null,
          patientName: recurring.patientName,
          patientPhone: recurring.patientPhone,
          deliveryAddress: recurring.deliveryAddress,
          deliveryCity: recurring.deliveryCity,
          deliveryPostalCode: recurring.deliveryPostalCode,
          deliveryAddressId: null,
          deliveryZoneId: recurring.deliveryZoneId,
          deliveryZoneName: recurring.deliveryZone.name,
          priceAtCreation: recurring.deliveryZone.price,
          instructions: recurring.instructions,
          scheduledDate: deliveryDate.dayStart,
          scheduledDateKey: deliveryDate.dateKey,
          createdById: recurring.createdById,
        });

        existingSet.add(recurring.id);
        if (result.alreadyDispatched) {
          existing++;
          console.log(`[CRON] Spoke dispatch already exists for ${recurring.patientName} today`);
        } else {
          created++;
          console.log(`[CRON] Sent recurring order for ${recurring.patientName} (${recurring.store.name}) to Spoke`);
        }
      } catch (err) {
        console.warn(`[CRON] Failed to send recurring order for ${recurring.patientName} to Spoke:`, err);
        skipped++;
        // Surface the miss to pharmacy staff — a log line alone means this
        // patient's delivery is silently lost for the day.
        try {
          await prisma.notification.create({
            data: {
              type: "SPOKE_DISPATCH_FAILED",
              message: `Spoke dispatch failed for ${recurring.patientName} (${recurring.deliveryAddress}, ${recurring.deliveryCity}) — today's delivery was NOT sent to Spoke. Use "Generate Today's Orders" to retry.`,
              storeId: recurring.storeId,
            },
          });
        } catch (notifyErr) {
          console.error("[CRON] Failed to record Spoke dispatch failure notification:", notifyErr);
        }
      }
      continue;
    }

    if (recurring.assignedDriverId && !selectedDriverId) {
      console.warn(
        `[CRON] Recurring profile for ${recurring.patientName} has an invalid assigned driver (${recurring.assignedDriverId}) — falling back to the zone default`
      );
    }

    // A live Spoke dispatch already covers today for this profile (it was
    // Spoke-assigned when dispatched). Don't create a duplicate in-house order.
    if (spokeHandledSet.has(recurring.id)) {
      console.log(
        `[CRON] Skipping ${recurring.patientName} — a live Spoke dispatch already exists today`
      );
      existing++;
      continue;
    }

    // Priority: recurring order's selected non-Spoke driver > zone's default driver > PENDING
    const driverId =
      selectedDriverId ??
      validDriverId(recurring.deliveryZone.defaultDriver, recurring.storeId);
    const status = driverId ? "ASSIGNED" : "PENDING";

    // Fail closed: this driver has Spoke dispatch history but is missing from
    // the configured provider list — an internal order here would silently
    // strand the delivery. Skip and alert instead.
    if (driverId && unconfiguredSpokeProviderIds.has(driverId)) {
      console.error(
        `[CRON] NOT generating internal order for ${recurring.patientName} — driver ${driverId} has Spoke dispatch history but is missing from SPOKE_PROVIDER_USER_IDS`
      );
      misconfiguredByStore.set(
        recurring.storeId,
        (misconfiguredByStore.get(recurring.storeId) ?? 0) + 1
      );
      skipped++;
      continue;
    }

    // Create the order — catch unique constraint errors for race condition safety
    try {
      await prisma.order.create({
        data: {
          patientName: recurring.patientName,
          patientPhone: recurring.patientPhone,
          deliveryAddress: recurring.deliveryAddress,
          deliveryCity: recurring.deliveryCity,
          deliveryPostalCode: recurring.deliveryPostalCode,
          deliveryZoneId: recurring.deliveryZoneId,
          deliveryZoneName: recurring.deliveryZone.name,
          priceAtCreation: recurring.deliveryZone.price,
          instructions: recurring.instructions,
          status,
          assignedDriverId: driverId,
          scheduledDate: deliveryDate.dayStart,
          recurringOrderId: recurring.id,
          createdById: recurring.createdById,
          storeId: recurring.storeId,
        },
      });
      existingSet.add(recurring.id);
      created++;
      console.log(`[CRON] Created order for ${recurring.patientName} (${recurring.store.name}) — ${status}${driverId ? " (auto-assigned)" : ""}`);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Race condition: another run created this order between the dedup
        // check and the insert (unique on recurringOrderId + scheduledDate).
        console.warn(`[CRON] Skipped duplicate for ${recurring.patientName}`);
        existing++;
      } else {
        // A real database failure — never mislabel it as a duplicate.
        console.error(`[CRON] Failed to create order for ${recurring.patientName}:`, err);
        skipped++;
      }
    }
  }

  for (const [storeId, count] of misconfiguredByStore) {
    try {
      await prisma.notification.create({
        data: {
          type: "GENERATION_INCOMPLETE",
          message: `${count} Anchor deliver${count === 1 ? "y was" : "ies were"} NOT generated — the assigned driver has Spoke dispatch history but is missing from SPOKE_PROVIDER_USER_IDS. Fix the configuration and click "Generate Today's Orders".`,
          storeId,
        },
      });
    } catch (notifyErr) {
      console.error("[CRON] Failed to record routing-configuration notification:", notifyErr);
    }
  }

  console.log(`[CRON] Generated ${created} recurring orders for ${deliveryDate.dateKey}`);
  return {
    dateKey: deliveryDate.dateKey,
    total: recurringOrders.length,
    due,
    created,
    existing,
    skipped,
    unprocessed,
  };
}

// Dispatch SCHEDULED (deferred, future-dated) Spoke handoffs whose delivery day
// has arrived. All dispatch inputs were captured on the ExternalDispatch row at
// scheduling time; the original idempotency key makes the release replay-safe.
export async function releaseDueSpokeDispatches(
  deliveryDate: Pick<DeliveryDateInfo, "nextDayStart">
) {
  const dueDispatches = await prisma.externalDispatch.findMany({
    where: {
      provider: "SPOKE",
      status: "SCHEDULED",
      scheduledDate: { lt: deliveryDate.nextDayStart },
    },
    include: {
      store: { select: { id: true, slug: true, name: true } },
      selectedProviderUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { scheduledDate: "asc" },
  });

  let released = 0;
  for (const dispatch of dueDispatches) {
    try {
      await dispatchOrderToSpoke({
        idempotencyKey: dispatch.idempotencyKey,
        patientId: dispatch.patientId,
        store: {
          id: dispatch.store.id,
          slug: dispatch.store.slug,
          name: dispatch.store.name,
        },
        selectedProviderUser: dispatch.selectedProviderUser
          ? {
              id: dispatch.selectedProviderUser.id,
              name: dispatch.selectedProviderUser.name ?? "Anchor",
              email: dispatch.selectedProviderUser.email ?? "",
            }
          : null,
        patientName: dispatch.patientName,
        patientPhone: dispatch.patientPhone,
        deliveryAddress: dispatch.deliveryAddress,
        deliveryCity: dispatch.deliveryCity,
        deliveryPostalCode: dispatch.deliveryPostalCode,
        deliveryAddressId: dispatch.deliveryAddressId,
        deliveryZoneId: dispatch.deliveryZoneId,
        deliveryZoneName: dispatch.deliveryZoneName,
        priceAtCreation: dispatch.priceAtCreation,
        instructions: dispatch.instructions,
        scheduledDate: dispatch.scheduledDate,
        scheduledDateKey: dispatch.scheduledDate.toISOString().slice(0, 10),
        createdById: dispatch.createdById,
      });
      released++;
      console.log(`[CRON] Released scheduled Spoke dispatch for ${dispatch.patientName}`);
    } catch (err) {
      console.warn(
        `[CRON] Failed to release scheduled Spoke dispatch for ${dispatch.patientName}:`,
        err
      );
      try {
        await prisma.notification.create({
          data: {
            type: "SPOKE_DISPATCH_FAILED",
            message: `Spoke dispatch failed for ${dispatch.patientName} (${dispatch.deliveryAddress}, ${dispatch.deliveryCity}) — the scheduled delivery was NOT sent to Spoke. Use "Generate Today's Orders" to retry.`,
            storeId: dispatch.storeId,
          },
        });
      } catch (notifyErr) {
        console.error(
          "[CRON] Failed to record Spoke release failure notification:",
          notifyErr
        );
      }
    }
  }

  return released;
}

// One-shot watchdog: a dispatch still sitting in Spoke's unassigned queue the
// morning AFTER its delivery date means the delivery was likely missed (this is
// exactly how the Shirley Heap Jul 6 2026 incident went unnoticed). The window
// only covers yesterday so each miss alerts exactly once.
export async function flagStalledSpokeDispatches(
  deliveryDate: Pick<DeliveryDateInfo, "dayStart">
) {
  const yesterdayStart = new Date(deliveryDate.dayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  const stalled = await prisma.externalDispatch.findMany({
    where: {
      provider: "SPOKE",
      status: { in: ["PENDING", "STOP_CREATED", "SUBMITTED"] },
      scheduledDate: { gte: yesterdayStart, lt: deliveryDate.dayStart },
    },
    select: {
      patientName: true,
      deliveryAddress: true,
      deliveryCity: true,
      scheduledDate: true,
      status: true,
      storeId: true,
    },
  });

  for (const dispatch of stalled) {
    try {
      await prisma.notification.create({
        data: {
          type: "SPOKE_DISPATCH_STALLED",
          message: `Spoke stop for ${dispatch.patientName} (${dispatch.deliveryAddress}, ${dispatch.deliveryCity}) scheduled for ${dispatch.scheduledDate.toISOString().slice(0, 10)} was never allocated or delivered (status: ${dispatch.status}). Check Anchor's dashboard — this delivery may have been missed.`,
          storeId: dispatch.storeId,
        },
      });
    } catch (err) {
      console.error("[CRON] Failed to record stalled Spoke dispatch notification:", err);
    }
  }

  return stalled.length;
}

const PURGE_BATCH_SIZE = 500;

export async function purgeOldInvoicedOrders() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    let totalPurged = 0;

    // Process in batches to avoid memory/timeout issues on large datasets
    while (true) {
      const batch = await prisma.order.findMany({
        where: {
          isInvoiced: true,
          completedAt: { not: null, lt: threeMonthsAgo },
          status: { in: ["DELIVERED", "FAILED", "CANCELLED"] },
        },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });

      if (batch.length === 0) break;

      const batchIds = batch.map((o) => o.id);

      await prisma.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { orderId: { in: batchIds } } });
        await tx.invoiceLineItem.deleteMany({ where: { orderId: { in: batchIds } } });
        await tx.order.deleteMany({ where: { id: { in: batchIds } } });
      });

      totalPurged += batch.length;
      console.log(`[CRON] Purged batch of ${batch.length} old invoiced orders`);

      if (batch.length < PURGE_BATCH_SIZE) break;
    }

    // Settled external dispatches were previously never purged — the fastest-
    // growing table (large request/webhook JSON payloads). Same 3-month
    // retention policy as orders.
    let dispatchesPurged = 0;
    while (true) {
      const batch = await prisma.externalDispatch.findMany({
        where: {
          status: {
            in: ["DELIVERED", "CANCELLED", "DELIVERY_FAILED", "DISPATCH_FAILED"],
          },
          scheduledDate: { lt: threeMonthsAgo },
        },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      await prisma.externalDispatch.deleteMany({
        where: { id: { in: batch.map((d) => d.id) } },
      });
      dispatchesPurged += batch.length;
      console.log(`[CRON] Purged batch of ${batch.length} old external dispatches`);
      if (batch.length < PURGE_BATCH_SIZE) break;
    }

    // Store-level notifications (orderId = null, e.g. Spoke alerts) are not
    // covered by the order-based cleanup above.
    const orphanNotifications = await prisma.notification.deleteMany({
      where: { orderId: null, createdAt: { lt: threeMonthsAgo } },
    });
    if (dispatchesPurged > 0 || orphanNotifications.count > 0) {
      console.log(
        `[CRON] Purged ${dispatchesPurged} old external dispatches and ${orphanNotifications.count} orphan notifications`
      );
    }

    if (totalPurged === 0) {
      console.log("[CRON] No old invoiced orders to purge");
    } else {
      console.log(`[CRON] Total purged: ${totalPurged} old invoiced orders`);
    }
    return totalPurged;
  } catch (error) {
    console.error("[CRON] Data cleanup failed:", error);
    return 0;
  }
}
