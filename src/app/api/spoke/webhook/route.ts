import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  canAdvanceDispatchStatus,
  mapSpokeWebhookStatus,
  verifySpokeSignature,
} from "@/lib/spoke";

function asPrismaJson(value: unknown) {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function objectPayload(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readStopId(eventType: string, data: Record<string, unknown>) {
  if (eventType === "test.send_event") return null;
  const directId = data.id;
  return typeof directId === "string" && directId.trim() ? directId.trim() : null;
}

function readTrackingLink(data: Record<string, unknown>) {
  const value = data.trackingLink;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSellerOrderId(data: Record<string, unknown>) {
  const directOrderInfo = objectPayload(data.orderInfo);
  const directSellerOrderId = directOrderInfo?.sellerOrderId;
  if (typeof directSellerOrderId === "string" && directSellerOrderId.trim()) {
    return directSellerOrderId.trim();
  }

  const stop = objectPayload(data.stop);
  const stopOrderInfo = objectPayload(stop?.orderInfo);
  const stopSellerOrderId = stopOrderInfo?.sellerOrderId;
  return typeof stopSellerOrderId === "string" && stopSellerOrderId.trim()
    ? stopSellerOrderId.trim()
    : null;
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.SPOKE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Spoke webhook secret is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const isValid = verifySpokeSignature({
    rawBody,
    signature: req.headers.get("spoke-signature"),
    secret: webhookSecret,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventPayload = objectPayload(event);
  const eventType = typeof eventPayload?.type === "string" ? eventPayload.type : "";
  const data = objectPayload(eventPayload?.data) ?? {};

  if (eventType === "test.send_event") {
    return NextResponse.json({ ok: true });
  }

  const stopId = readStopId(eventType, data);
  if (!stopId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const mapped = mapSpokeWebhookStatus(eventType, data);
  const attemptTimestamps = {
    ...("deliveredAt" in mapped ? { deliveredAt: mapped.deliveredAt } : {}),
    ...("failedAt" in mapped ? { failedAt: mapped.failedAt } : {}),
  };
  // Tracking links are metadata, not lifecycle: recording one must never move
  // the status (a late tracking event used to regress IN_TRANSIT/DEPARTED).
  const isTrackingOnly = eventType.endsWith(".tracking_link_added");
  const sellerOrderId = readSellerOrderId(data);

  // Webhooks are not guaranteed to arrive in order, can be duplicated, and can
  // interleave with our own submission/cancel writes. Resolve the dispatch
  // first (stop id, falling back to sellerOrderId → idempotency key), then
  // apply a monotonic, optimistically-locked update: the status only moves
  // forward per canAdvanceDispatchStatus, and a concurrent writer triggers one
  // re-read + re-evaluation instead of a blind overwrite.
  for (let attempt = 0; attempt < 2; attempt++) {
    const dispatch = await prisma.externalDispatch.findFirst({
      where: {
        provider: "SPOKE",
        OR: [
          { spokeStopId: stopId },
          ...(sellerOrderId ? [{ idempotencyKey: sellerOrderId }] : []),
        ],
      },
      select: {
        id: true,
        status: true,
        storeId: true,
        patientName: true,
        deliveryAddress: true,
        deliveryCity: true,
      },
    });

    if (!dispatch) {
      console.warn(
        `[SPOKE] Webhook ${eventType} matched no dispatch (stop ${stopId})`
      );
      return NextResponse.json({ ok: true, matched: 0 });
    }

    // Settled handoffs stay exactly as recorded — late events can't even
    // touch their payload/metadata.
    if (dispatch.status === "DELIVERED" || dispatch.status === "CANCELLED") {
      return NextResponse.json({ ok: true, matched: 0, ignored: true });
    }

    const advanceStatus =
      !isTrackingOnly && canAdvanceDispatchStatus(dispatch.status, mapped.status);

    const updated = await prisma.externalDispatch.updateMany({
      where: { id: dispatch.id, status: dispatch.status },
      data: {
        ...(advanceStatus
          ? { status: mapped.status, ...attemptTimestamps, errorMessage: null }
          : {}),
        lastWebhookEventType: eventType,
        webhookPayload: asPrismaJson(eventPayload),
        trackingLink: readTrackingLink(data),
        spokeStopId: stopId,
        externalReference: stopId,
      },
    });

    if (updated.count > 0) {
      // Alert the store once, the same way an in-house failed delivery does.
      // A replay of the same event finds the row already failed.
      if (
        advanceStatus &&
        mapped.status === "DELIVERY_FAILED" &&
        dispatch.status !== "DELIVERY_FAILED"
      ) {
        try {
          await prisma.notification.create({
            data: {
              type: "DELIVERY_FAILED",
              message: `Anchor could not deliver to ${dispatch.patientName} at ${dispatch.deliveryAddress}, ${dispatch.deliveryCity}.`,
              storeId: dispatch.storeId,
            },
          });
        } catch (notifyErr) {
          console.error("[SPOKE] Failed to record failed-delivery notification:", notifyErr);
        }
      }

      return NextResponse.json({
        ok: true,
        matched: updated.count,
        advanced: advanceStatus,
      });
    }
    // Status changed between read and write (concurrent webhook or submission
    // write) — loop once to re-evaluate against the fresh status.
  }

  return NextResponse.json({ ok: true, matched: 0, raced: true });
}
