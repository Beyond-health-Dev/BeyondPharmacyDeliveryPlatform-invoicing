import { NextRequest, NextResponse } from "next/server";
import { Prisma, type ExternalDispatch } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CANCELLABLE_EXTERNAL_STATUSES,
  IN_FLIGHT_STEP,
  isCancellableExternalStatus,
  mayStillBeWithAnchorAfterCancel,
  stillWithAnchorAfterCancel,
} from "@/lib/externalDispatchStatus";
import { deleteSpokeUnassignedStop, getSpokeConfig, SpokeDispatchError } from "@/lib/spoke";
import { resolveStore } from "@/lib/store";

const ALREADY_CANCELLED = "Already cancelled.";

function asPrismaJson(value: unknown) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

// Already cancelled here. If Anchor may still have it, say what to do (the
// screen keeps that up until staff dismiss it).
function alreadyCancelled(dispatch: ExternalDispatch) {
  if (!mayStillBeWithAnchorAfterCancel(dispatch)) {
    return NextResponse.json({ message: ALREADY_CANCELLED, dispatch });
  }
  const { why, fix } = stillWithAnchorAfterCancel(dispatch.workflowStep);
  return NextResponse.json({ message: `Already cancelled, but ${why}. ${fix}.`, needsCheck: true, dispatch });
}

// Records the cancel after the stop is gone at Spoke, unless Anchor's update
// landed first: then the row keeps Anchor's status and staff are told.
async function recordCancelAfterSpoke(dispatch: ExternalDispatch, message: string, responsePayload?: unknown) {
  const cancelled = await prisma.externalDispatch.updateMany({
    where: { id: dispatch.id, status: { in: CANCELLABLE_EXTERNAL_STATUSES } },
    data: {
      status: "CANCELLED",
      workflowStep: "CANCEL_UNASSIGNED_STOP",
      ...(responsePayload !== undefined ? { responsePayload: asPrismaJson(responsePayload) } : {}),
      errorMessage: null,
    },
  });
  const latest = await prisma.externalDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });

  if (cancelled.count > 0) {
    return NextResponse.json({ message, dispatch: latest });
  }
  if (latest.status === "CANCELLED") {
    return alreadyCancelled(latest);
  }
  return NextResponse.json(
    {
      error:
        "Anchor picked up this order while it was being cancelled, so it was not cancelled here. Check Anchor's list in Spoke.",
    },
    { status: 409 }
  );
}

export async function DELETE(
  _req: NextRequest,
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

  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The sender may be writing this row at the same moment. A cancel that loses
  // the race re-reads and goes round once more: a stop created meanwhile is
  // then removed at Spoke, and a row Anchor has moved on is refused.
  for (let pass = 0; pass < 2; pass++) {
    const dispatch = await prisma.externalDispatch.findUnique({
      where: { id },
    });

    if (!dispatch || dispatch.storeId !== store.id || dispatch.provider !== "SPOKE") {
      return NextResponse.json({ error: "This Anchor order wasn't found. Refresh the page." }, { status: 404 });
    }

    if (dispatch.status === "CANCELLED") {
      return alreadyCancelled(dispatch);
    }

    if (!isCancellableExternalStatus(dispatch.status)) {
      return NextResponse.json(
        {
          error:
            "Anchor has already started on this order, so it can't be cancelled here. Contact Anchor to stop it.",
        },
        { status: 409 }
      );
    }

    if (!dispatch.spokeStopId) {
      // One guarded statement: if the sender records a stop first, this
      // matches nothing and the next pass removes that stop at Spoke instead.
      // If this wins, the sender sees the cancel and removes its own stop.
      // The step read above is part of the guard: a release that started
      // sending since then forces the re-read, so the reply below says the
      // send may have reached Anchor.
      const cancelled = await prisma.externalDispatch.updateMany({
        where: {
          id: dispatch.id,
          status: { in: CANCELLABLE_EXTERNAL_STATUSES },
          spokeStopId: null,
          workflowStep: dispatch.workflowStep,
        },
        data: {
          status: "CANCELLED",
          workflowStep: "CANCEL_UNASSIGNED_STOP",
          errorMessage: null,
        },
      });
      if (cancelled.count === 0) continue;

      // A failed send, or one cut short, may have reached Spoke without the
      // stop being recorded here.
      const mayHaveReachedAnchor =
        dispatch.status === "DISPATCH_FAILED" || dispatch.workflowStep === IN_FLIGHT_STEP;
      // needsCheck: the screen keeps this reply up until staff dismiss it.
      return NextResponse.json({
        message: mayHaveReachedAnchor
          ? "Cancelled here, but the earlier send may have reached Anchor. Check Anchor's list in Spoke and remove it there if it shows up."
          : "Cancelled. It was never sent to Anchor.",
        ...(mayHaveReachedAnchor ? { needsCheck: true } : {}),
        dispatch: await prisma.externalDispatch.findUniqueOrThrow({ where: { id: dispatch.id } }),
      });
    }

    if (!dispatch.spokeStopId.startsWith("unassignedStops/")) {
      return NextResponse.json(
        {
          error:
            "Anchor has already put this order on a route, so it can't be cancelled here. Contact Anchor to stop it.",
        },
        { status: 409 }
      );
    }

    try {
      const spokeConfig = getSpokeConfig();
      const result = await deleteSpokeUnassignedStop(spokeConfig, {
        unassignedStopId: dispatch.spokeStopId,
        idempotencyKey: dispatch.idempotencyKey,
      });

      return await recordCancelAfterSpoke(
        dispatch,
        "Cancelled and removed from Anchor's list.",
        result.responsePayload
      );
    } catch (err) {
      const spokeError =
        err instanceof SpokeDispatchError
          ? err
          : new SpokeDispatchError("Failed to cancel Spoke handoff.", 502);

      // The stop is already gone on Spoke's side (removed in Anchor's dashboard,
      // or a previous cancel attempt succeeded upstream) — deleting a missing
      // stop IS the desired outcome, so record the cancellation instead of
      // leaving a handoff that can never be cancelled.
      if (spokeError.upstreamStatus === 404) {
        return await recordCancelAfterSpoke(
          dispatch,
          "Cancelled. It was already gone from Anchor's list."
        );
      }

      // Not cancelled: note why on the row, without touching its status.
      await prisma.externalDispatch.updateMany({
        where: { id: dispatch.id, status: { in: CANCELLABLE_EXTERNAL_STATUSES } },
        data: {
          workflowStep: spokeError.workflowStep,
          responsePayload: asPrismaJson(spokeError.responsePayload),
          errorMessage: spokeError.message,
        },
      });

      return NextResponse.json(
        {
          error:
            "Couldn't remove this order from Anchor's list in Spoke, so it has not been cancelled. Try again in a minute.",
          external: true,
          provider: "SPOKE",
        },
        { status: spokeError.statusCode }
      );
    }
  }

  return NextResponse.json(
    { error: "This order changed while it was being cancelled. Refresh the page and try again." },
    { status: 409 }
  );
}
