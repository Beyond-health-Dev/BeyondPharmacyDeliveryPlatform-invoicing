import { Prisma, type ExternalDispatch } from "@prisma/client";
import { prisma } from "./db";
import {
  alreadySavedMessage,
  CANCEL_ALERT_NOT_RAISED,
  CANCEL_CLEANUP_FAILED_STEP,
  CANCELLED_BUT_ACTIVE_STEP,
  IN_FLIGHT_STEP,
  isHeldForRelease,
  isSendableExternalStatus,
  SENDABLE_EXTERNAL_STATUSES,
} from "./externalDispatchStatus";
import {
  buildSpokeStopPayload,
  createSpokeUnassignedStop,
  deleteSpokeUnassignedStop,
  getSpokeConfig,
  getSpokeProviderUserIds,
  SpokeDispatchError,
  type SpokeConfig,
  type SpokeOrderInput,
} from "./spoke";
import { vancouverTodayKey } from "./vancouverDate";

interface SpokeProviderUser {
  id: string;
  name: string;
  email: string;
}

interface SpokeDispatchInput {
  idempotencyKey: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPostalCode: string;
  deliveryAddressId: string | null;
  deliveryZoneId: string;
  deliveryZoneName: string;
  priceAtCreation: number;
  instructions: string | null;
  scheduledDate: Date;
  scheduledDateKey: string;
  store: {
    id: string;
    slug: string;
    name: string;
  };
  selectedProviderUser: SpokeProviderUser | null;
  createdById: string;
  onBeforeComplete?: (
    tx: Prisma.TransactionClient
  ) => Promise<{ patientId: string | null; deliveryAddressId: string | null }>;
}

export function buildRecurringSpokeIdempotencyKey(
  recurringOrderId: string,
  scheduledDateKey: string
) {
  return `recurring:${recurringOrderId}:${scheduledDateKey}`;
}

export interface SpokeDispatchResult {
  dispatch: ExternalDispatch;
  alreadyDispatched: boolean;
}

function asPrismaJson(value: unknown) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function spokeOrderInput(input: SpokeDispatchInput): SpokeOrderInput {
  return {
    idempotencyKey: input.idempotencyKey,
    patientId: input.patientId,
    store: input.store,
    providerUser: input.selectedProviderUser,
    patientName: input.patientName,
    patientPhone: input.patientPhone,
    deliveryAddress: input.deliveryAddress,
    deliveryCity: input.deliveryCity,
    deliveryPostalCode: input.deliveryPostalCode,
    deliveryZoneName: input.deliveryZoneName,
    instructions: input.instructions,
    scheduledDate: input.scheduledDate,
    scheduledDateKey: input.scheduledDateKey,
  };
}

// The order's details as they are sent to Spoke. Deliberately none of the
// lifecycle columns (status, step, stop id, responses): writing back a copy
// of those read earlier would undo a cancel or a webhook that landed since.
function dispatchSnapshotData(input: SpokeDispatchInput, stopPayload: unknown) {
  return {
    selectedProviderUserId: input.selectedProviderUser?.id ?? null,
    patientId: input.patientId,
    patientName: input.patientName,
    patientPhone: input.patientPhone,
    deliveryAddress: input.deliveryAddress,
    deliveryCity: input.deliveryCity,
    deliveryPostalCode: input.deliveryPostalCode,
    deliveryAddressId: input.deliveryAddressId,
    deliveryZoneId: input.deliveryZoneId,
    deliveryZoneName: input.deliveryZoneName,
    priceAtCreation: input.priceAtCreation,
    instructions: input.instructions,
    scheduledDate: input.scheduledDate,
    requestPayload: asPrismaJson(stopPayload),
  };
}

function newDispatchData(
  input: SpokeDispatchInput,
  stopPayload: unknown,
  lifecycle: { status: string; workflowStep: string }
) {
  return {
    idempotencyKey: input.idempotencyKey,
    provider: "SPOKE",
    status: lifecycle.status,
    workflowStep: lifecycle.workflowStep,
    storeId: input.store.id,
    createdById: input.createdById,
    errorMessage: null,
    ...dispatchSnapshotData(input, stopPayload),
  };
}

function idempotencyConflict() {
  return new SpokeDispatchError("Idempotency key conflict", 409, null, "IDEMPOTENCY");
}

function dateKeyOf(dispatch: Pick<ExternalDispatch, "scheduledDate">) {
  return dispatch.scheduledDate.toISOString().slice(0, 10);
}

// The form keeps its request key after a server or network error, so a save
// that failed and is then made for another day arrives with the same key.
// The row stays exactly as it is; the order route answers 409 with this, and
// the form starts a new request for the next save.
export function alreadySavedConflict(dispatch: ExternalDispatch) {
  return new SpokeDispatchError(
    alreadySavedMessage(
      { status: dispatch.status, scheduledDateKey: dateKeyOf(dispatch) },
      vancouverTodayKey()
    ),
    409,
    null,
    "IDEMPOTENCY"
  );
}

// A row already saved under this request key, before anything is sent or
// written: it must be this store's and for the same delivery day.
function checkExistingRow(dispatch: ExternalDispatch, input: SpokeDispatchInput) {
  if (dispatch.storeId !== input.store.id) throw idempotencyConflict();
  if (dateKeyOf(dispatch) !== input.scheduledDateKey) throw alreadySavedConflict(dispatch);
}

function cancelIncompleteMessage(dispatch: ExternalDispatch) {
  return `The order for ${dispatch.patientName} (${dispatch.deliveryAddress}, ${dispatch.deliveryCity}) was cancelled here while it was being sent, but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it.`;
}

async function alertCancelIncomplete(dispatch: ExternalDispatch) {
  try {
    await prisma.notification.create({
      data: {
        type: "SPOKE_CANCEL_INCOMPLETE",
        message: cancelIncompleteMessage(dispatch),
        storeId: dispatch.storeId,
      },
    });
  } catch (err) {
    console.error("[SPOKE] Failed to record cancel-incomplete notification:", err);
  }
}

// Spoke may have made the stop even though the create call failed: no answer
// (timeout or network), a server error, or a conflict. A refusal (400, 401,
// 403, 404, 422, 429) means it didn't.
function stopMayExistAfterFailure(err: SpokeDispatchError) {
  const status = err.upstreamStatus;
  return status === null || status >= 500 || status === 409;
}

// The row as it now stands, or as it was last read if it can't be read.
async function reread(dispatch: ExternalDispatch) {
  try {
    return (await prisma.externalDispatch.findUnique({ where: { id: dispatch.id } })) ?? dispatch;
  } catch {
    return dispatch;
  }
}

// Two saves with the same key at once: the other one created the row first.
async function findKeyRaceWinner(err: unknown, idempotencyKey: string) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return null;
  }
  return prisma.externalDispatch.findUnique({ where: { idempotencyKey } });
}

export function buildExternalDispatchResponse(
  dispatch: Pick<
    ExternalDispatch,
    "id" | "provider" | "externalReference" | "spokePlanId" | "spokeStopId" | "status"
  >
) {
  return {
    external: true,
    provider: dispatch.provider,
    externalReference: dispatch.externalReference,
    spokePlanId: dispatch.spokePlanId,
    spokeStopId: dispatch.spokeStopId,
    dispatchId: dispatch.id,
    status: dispatch.status,
  };
}

export function isSelectedSpokeProvider(userId: string | null | undefined) {
  return userId ? getSpokeProviderUserIds().has(userId) : false;
}

function toSpokeDispatchError(err: unknown) {
  if (err instanceof SpokeDispatchError) return err;

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2021" || err.code === "P2022")
  ) {
    return new SpokeDispatchError(
      "Spoke dispatch audit is unavailable. Please confirm the Spoke database migration has run.",
      500,
      null,
      "SETUP"
    );
  }

  return new SpokeDispatchError("Failed to contact Spoke.", 502);
}

// The order was cancelled here while its stop was being created at Spoke. The
// cancel saw no stop to remove, so the sender removes it. Never throws: the
// cancel is already recorded, and if the stop can't be removed staff are told
// to remove it in Spoke themselves.
async function withdrawStopAfterCancel(
  config: SpokeConfig,
  dispatch: ExternalDispatch,
  stopId: string
): Promise<ExternalDispatch> {
  let removed = false;
  try {
    // Same idempotency key the cancel route uses.
    await deleteSpokeUnassignedStop(config, {
      unassignedStopId: stopId,
      idempotencyKey: dispatch.idempotencyKey,
    });
    removed = true;
  } catch (err) {
    // Already gone at Spoke is the outcome we wanted.
    removed = err instanceof SpokeDispatchError && err.upstreamStatus === 404;
    if (!removed) {
      console.warn(`[SPOKE] Could not remove the stop of cancelled order ${dispatch.id}:`, err);
    }
  }

  // Staff are told when the stop is left at Anchor, once per order; if the
  // row can't be marked, they are told anyway.
  let alert = !removed;
  try {
    await prisma.externalDispatch.updateMany({
      where: { id: dispatch.id, status: "CANCELLED" },
      data: { spokeStopId: stopId, externalReference: stopId },
    });
    if (removed) {
      // Anchor's own update may have marked the row already (it went on to
      // handle the order); that marker stays.
      await prisma.externalDispatch.updateMany({
        where: {
          id: dispatch.id,
          status: "CANCELLED",
          OR: [{ workflowStep: null }, { workflowStep: { not: CANCELLED_BUT_ACTIVE_STEP } }],
        },
        data: { workflowStep: "CANCEL_UNASSIGNED_STOP" },
      });
    } else {
      const flagged = await prisma.externalDispatch.updateMany({
        where: { id: dispatch.id, status: "CANCELLED", ...CANCEL_ALERT_NOT_RAISED },
        data: { workflowStep: CANCEL_CLEANUP_FAILED_STEP },
      });
      alert = flagged.count > 0;
    }
  } catch (err) {
    console.error(`[SPOKE] Failed to record the stop of cancelled order ${dispatch.id}:`, err);
  }

  if (alert) await alertCancelIncomplete(dispatch);

  return reread(dispatch);
}

// Sends an order to Spoke, or resumes a send (release of a SCHEDULED row,
// Retry of a DISPATCH_FAILED one) under the same idempotency key. Cancel
// always wins: every write is guarded by the sendable statuses, so a cancel or
// Anchor's own update that lands mid-send is never overwritten.
export async function dispatchOrderToSpoke(
  input: SpokeDispatchInput
): Promise<SpokeDispatchResult> {
  // Set once the row is known to be this store's; the catch block marks it.
  let dispatchId: string | null = null;
  // True while the create-stop call is out, so the catch knows a stop may
  // exist at Spoke.
  let creatingStop = false;

  try {
    let dispatch = await prisma.externalDispatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (dispatch) {
      checkExistingRow(dispatch, input);
      // Already sent, cancelled, or Anchor has it.
      if (!isSendableExternalStatus(dispatch.status)) {
        return { dispatch, alreadyDispatched: true };
      }
      dispatchId = dispatch.id;
    }

    const spokeConfig = getSpokeConfig();
    const stopPayload = buildSpokeStopPayload(
      spokeOrderInput(input),
      spokeConfig.circuitClientId
    );

    if (!dispatch) {
      try {
        dispatch = await prisma.externalDispatch.create({
          data: newDispatchData(input, stopPayload, {
            status: "PENDING",
            workflowStep: "PENDING",
          }),
        });
      } catch (err) {
        const winner = await findKeyRaceWinner(err, input.idempotencyKey);
        if (!winner) throw err;
        checkExistingRow(winner, input);
        dispatch = winner;
      }
    }

    const id = dispatch.id;
    dispatchId = id;

    // One statement just before calling Spoke: a cancel that landed since the
    // read above stops the send here. The status is left as it is (a SCHEDULED
    // row stays SCHEDULED), so a send cut short is picked up again by the next
    // release run.
    const claimed = await prisma.externalDispatch.updateMany({
      where: { id, status: { in: SENDABLE_EXTERNAL_STATUSES } },
      data: {
        ...dispatchSnapshotData(input, stopPayload),
        workflowStep: IN_FLIGHT_STEP,
        errorMessage: null,
      },
    });
    dispatch = await prisma.externalDispatch.findUniqueOrThrow({
      where: { id },
    });
    if (claimed.count === 0 || !isSendableExternalStatus(dispatch.status)) {
      return { dispatch, alreadyDispatched: true };
    }

    let spokeStopId = dispatch.spokeStopId;
    if (!spokeStopId) {
      creatingStop = true;
      const stopResult = await createSpokeUnassignedStop(spokeConfig, {
        stopPayload,
        idempotencyKey: input.idempotencyKey,
      });
      creatingStop = false;
      spokeStopId = stopResult.stopId;

      const recorded = await prisma.externalDispatch.updateMany({
        where: { id, status: { in: SENDABLE_EXTERNAL_STATUSES } },
        data: {
          status: "STOP_CREATED",
          workflowStep: "CREATE_UNASSIGNED_STOP",
          spokePlanId: null,
          spokeStopId,
          externalReference: spokeStopId,
          responsePayload: asPrismaJson(stopResult.responsePayload),
          errorMessage: null,
        },
      });

      if (recorded.count === 0) {
        const latest = await prisma.externalDispatch.findUniqueOrThrow({
          where: { id },
        });
        // Cancelled while Spoke was creating the stop: take it back out.
        if (latest.status === "CANCELLED") {
          return {
            dispatch: await withdrawStopAfterCancel(spokeConfig, latest, spokeStopId),
            alreadyDispatched: true,
          };
        }
        // Otherwise Anchor's update (e.g. stop.allocated) arrived first; its
        // status and stop id are kept by the guarded writes below.
      }
    }

    const finalDispatch = await prisma.$transaction(async (tx) => {
      const finalSnapshot = input.onBeforeComplete
        ? await input.onBeforeComplete(tx)
        : {
            patientId: input.patientId,
            deliveryAddressId: input.deliveryAddressId,
          };

      // Only a still-sendable row advances to SUBMITTED. A fast webhook (e.g.
      // stop.allocated seconds after creation) or a staff cancel can land
      // during the send; then only the patient links are saved, and the stop
      // id only if none is recorded yet, so a webhook's stop id is never
      // replaced and the newer status is kept.
      const advanced = await tx.externalDispatch.updateMany({
        where: { id, status: { in: SENDABLE_EXTERNAL_STATUSES } },
        data: {
          status: "SUBMITTED",
          workflowStep: "CREATE_UNASSIGNED_STOP",
          externalReference: spokeStopId,
          spokePlanId: null,
          spokeStopId,
          spokeDriverId: null,
          patientId: finalSnapshot.patientId,
          deliveryAddressId: finalSnapshot.deliveryAddressId,
          errorMessage: null,
        },
      });

      if (advanced.count === 0) {
        await tx.externalDispatch.updateMany({
          where: { id },
          data: {
            patientId: finalSnapshot.patientId,
            deliveryAddressId: finalSnapshot.deliveryAddressId,
          },
        });
        await tx.externalDispatch.updateMany({
          where: { id, spokeStopId: null },
          data: { spokeStopId, externalReference: spokeStopId },
        });
        // Don't leave the row looking mid-send under Anchor's status.
        await tx.externalDispatch.updateMany({
          where: { id, workflowStep: IN_FLIGHT_STEP },
          data: { workflowStep: "CREATE_UNASSIGNED_STOP" },
        });
      }

      return tx.externalDispatch.findUniqueOrThrow({
        where: { id },
      });
    });

    // Cancelled after the stop was recorded: the cancel route removes the
    // stop itself. Not counted as sent.
    return { dispatch: finalDispatch, alreadyDispatched: finalDispatch.status === "CANCELLED" };
  } catch (err) {
    const spokeError = toSpokeDispatchError(err);

    if (dispatchId) {
      let marked: boolean;
      try {
        // Only a row that could still be sent is marked failed (a failed
        // retry is re-marked with the new message). A cancel or webhook that
        // moved the row on in the meantime is kept.
        const failed = await prisma.externalDispatch.updateMany({
          where: { id: dispatchId, status: { in: SENDABLE_EXTERNAL_STATUSES } },
          data: {
            status: "DISPATCH_FAILED",
            workflowStep: spokeError.workflowStep,
            responsePayload: asPrismaJson(spokeError.responsePayload),
            errorMessage: spokeError.message,
          },
        });
        marked = failed.count > 0;
      } catch (auditError) {
        console.warn("[SPOKE] Failed to update dispatch failure audit:", auditError);
        throw spokeError;
      }

      // The row moved on while this send failed: cancelled here, or sent by
      // another run (or Anchor has it). That outcome stands; this failure
      // isn't the order's.
      const latest = marked
        ? null
        : await prisma.externalDispatch.findUnique({ where: { id: dispatchId } }).catch(() => null);
      if (latest && !isSendableExternalStatus(latest.status)) {
        console.warn(
          `[SPOKE] Send of order ${latest.id} failed after it became ${latest.status}; keeping ${latest.status}:`,
          spokeError.message
        );
        if (
          latest.status === "CANCELLED" &&
          creatingStop &&
          stopMayExistAfterFailure(spokeError)
        ) {
          return { dispatch: await flagCancelledStopMayExist(latest), alreadyDispatched: true };
        }
        return { dispatch: latest, alreadyDispatched: true };
      }
    }

    throw spokeError;
  }
}

// Cancelled during a create-stop call that failed in a way that may still
// have made the stop at Spoke. Nobody knows its id, so staff remove it in
// Spoke themselves. Never throws; returns the row as flagged.
async function flagCancelledStopMayExist(dispatch: ExternalDispatch): Promise<ExternalDispatch> {
  try {
    const flagged = await prisma.externalDispatch.updateMany({
      where: { id: dispatch.id, status: "CANCELLED", ...CANCEL_ALERT_NOT_RAISED },
      data: { workflowStep: CANCEL_CLEANUP_FAILED_STEP },
    });
    if (flagged.count > 0) await alertCancelIncomplete(dispatch);
  } catch (err) {
    console.error(`[SPOKE] Failed to flag cancelled order ${dispatch.id}:`, err);
  }
  return reread(dispatch);
}

// A replayed hold (same request key): the row is returned exactly as it is
// only while it is still held for that same day. Rewriting it could undo a
// cancel, or put an order already sent back on hold, so anything else is
// refused and staff sort out the earlier save first.
function replayedHold(existing: ExternalDispatch, input: SpokeDispatchInput) {
  checkExistingRow(existing, input);
  if (!isHeldForRelease(existing.status)) throw alreadySavedConflict(existing);
  return existing;
}

// Records a Spoke handoff WITHOUT contacting Spoke, for orders whose delivery
// day hasn't arrived yet. Unassigned stops carry no machine-readable date, so a
// stop created days early sits in Anchor's queue and never lands on the right
// day's plan (Shirley Heap, Jul 6 2026). The daily cron releases these through
// dispatchOrderToSpoke (same idempotency key) on the morning of delivery —
// "SCHEDULED" is deliberately a sendable status, so the release proceeds.
export async function scheduleDeferredSpokeDispatch(
  input: SpokeDispatchInput
): Promise<SpokeDispatchResult> {
  try {
    const existing = await prisma.externalDispatch.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
      return { dispatch: replayedHold(existing, input), alreadyDispatched: true };
    }

    // Build the same payload the release step will send, for the audit trail
    // (also surfaces a missing SPOKE_API_KEY now rather than at 6 AM).
    const spokeConfig = getSpokeConfig();
    const stopPayload = buildSpokeStopPayload(
      spokeOrderInput(input),
      spokeConfig.circuitClientId
    );

    try {
      const dispatch = await prisma.$transaction(async (tx) => {
        const snapshot = input.onBeforeComplete
          ? await input.onBeforeComplete(tx)
          : {
              patientId: input.patientId,
              deliveryAddressId: input.deliveryAddressId,
            };

        return tx.externalDispatch.create({
          data: {
            ...newDispatchData(input, stopPayload, {
              status: "SCHEDULED",
              workflowStep: "AWAITING_RELEASE",
            }),
            patientId: snapshot.patientId,
            deliveryAddressId: snapshot.deliveryAddressId,
          },
        });
      });

      return { dispatch, alreadyDispatched: false };
    } catch (err) {
      const winner = await findKeyRaceWinner(err, input.idempotencyKey);
      if (!winner) throw err;
      return { dispatch: replayedHold(winner, input), alreadyDispatched: true };
    }
  } catch (err) {
    throw toSpokeDispatchError(err);
  }
}
