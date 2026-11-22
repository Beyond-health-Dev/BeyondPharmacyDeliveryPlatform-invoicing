import crypto from "crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as table from "@/lib/__tests__/fakeDispatchTable";

vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);

import { POST } from "../route";

const SECRET = "test-webhook-secret";
const STOP = "unassignedStops/u1";

// Signed with the test secret, so the route's real signature check runs.
function post(event: object, secret = SECRET) {
  const body = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return POST(
    new NextRequest("http://localhost/api/spoke/webhook", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", "spoke-signature": `sha256=${signature}` },
    })
  );
}

const attempted = (succeeded: boolean) => ({
  type: "stop.attempted_delivery",
  data: { id: STOP, deliveryInfo: { succeeded }, orderInfo: { sellerOrderId: "order-1" } },
});

beforeEach(() => {
  vi.stubEnv("SPOKE_WEBHOOK_SECRET", SECRET);
  table.resetTable();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("Spoke webhook failed-delivery alert", () => {
  it("alerts the store once when Anchor reports a failed delivery", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    const res = await post(attempted(false));

    expect(res.status).toBe(200);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
    expect(table.notifications).toEqual([
      {
        type: "DELIVERY_FAILED",
        message: "Anchor could not deliver to Riley Chen at 7380 120 St, Surrey.",
        storeId: table.STORE.id,
      },
    ]);
  });

  it("doesn't alert again for a replay of the same event", async () => {
    table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    await post(attempted(false));
    await post(attempted(false));

    expect(table.notifications).toHaveLength(1);
  });

  it("doesn't alert for a successful delivery", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    await post(attempted(true));

    expect(table.row(sent.id).status).toBe("DELIVERED");
    expect(table.notifications).toEqual([]);
  });

  it("alerts when the failure lands on the second try, after another update raced it", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "SUBMITTED", spokeStopId: STOP });
    table.externalDispatch.findFirst.mockImplementationOnce(async (args) => {
      const read = await table.impl.findFirst(args);
      table.row(sent.id).status = "IN_TRANSIT";
      return read;
    });

    await post(attempted(false));

    expect(table.externalDispatch.updateMany).toHaveBeenCalledTimes(2);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
    expect(table.notifications).toHaveLength(1);
  });

  it("still answers Spoke when the alert can't be saved", async () => {
    const sent = table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });
    table.notification.create.mockRejectedValueOnce(new Error("database is busy"));

    const res = await post(attempted(false));

    expect(res.status).toBe(200);
    expect(table.row(sent.id).status).toBe("DELIVERY_FAILED");
  });

  it("rejects a body signed with another secret", async () => {
    table.addRow({ idempotencyKey: "order-1", status: "IN_TRANSIT", spokeStopId: STOP });

    expect((await post(attempted(false), "wrong-secret")).status).toBe(401);
    expect(table.notifications).toEqual([]);
  });
});

describe("Spoke webhook for an order cancelled here", () => {
  const PLAN_STOP = "plans/p1/stops/s1";
  // Anchor moved the stop onto a route, so its events carry the route's stop
  // id; the order is found by its key (sellerOrderId).
  const event = (type: string, data: Record<string, unknown> = {}) => ({
    type,
    data: { id: PLAN_STOP, orderInfo: { sellerOrderId: "order-1" }, ...data },
  });

  function cancelledRow() {
    return table.addRow({
      idempotencyKey: "order-1",
      status: "CANCELLED",
      workflowStep: "CANCEL_UNASSIGNED_STOP",
      spokeStopId: STOP,
      externalReference: STOP,
    });
  }

  it("keeps it cancelled, records the event and alerts staff once", async () => {
    const cancelled = cancelledRow();

    const res = await post(event("stop.allocated"));

    expect(res.status).toBe(200);
    expect(table.row(cancelled.id)).toMatchObject({
      status: "CANCELLED",
      workflowStep: "CANCELLED_BUT_ACTIVE",
      lastWebhookEventType: "stop.allocated",
      webhookPayload: expect.objectContaining({ type: "stop.allocated" }),
      spokeStopId: STOP,
    });
    expect(table.notifications).toEqual([
      {
        type: "SPOKE_CANCEL_INCOMPLETE",
        message:
          "Anchor has started handling an order that was cancelled here (Riley Chen, 7380 120 St, Surrey). Contact Anchor so it isn't delivered.",
        storeId: table.STORE.id,
      },
    ]);

    await post(event("stop.out_for_delivery"));

    expect(table.notifications).toHaveLength(1);
    expect(table.row(cancelled.id)).toMatchObject({
      status: "CANCELLED",
      workflowStep: "CANCELLED_BUT_ACTIVE",
      lastWebhookEventType: "stop.out_for_delivery",
      spokeStopId: STOP,
    });
  });

  it("alerts for a cancelled row whose step was never set", async () => {
    const cancelled = cancelledRow();
    table.row(cancelled.id).workflowStep = null;

    await post(event("stop.attempted_delivery", { deliveryInfo: { succeeded: true } }));

    expect(table.row(cancelled.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" });
    expect(table.notifications).toHaveLength(1);
  });

  it("ignores unknown events and tracking links", async () => {
    const cancelled = cancelledRow();
    const before = { ...cancelled };

    await post(event("stop.something_new"));
    await post(event("stop.tracking_link_added", { trackingLink: "https://track.example/s1" }));

    expect(table.notifications).toEqual([]);
    expect(table.row(cancelled.id)).toEqual(before);
  });

  it("still ignores everything for a delivered order", async () => {
    const delivered = table.addRow({ idempotencyKey: "order-1", status: "DELIVERED", spokeStopId: STOP });
    const before = { ...delivered };

    await post(event("stop.attempted_delivery", { deliveryInfo: { succeeded: false } }));

    expect(table.row(delivered.id)).toEqual(before);
    expect(table.notifications).toEqual([]);
  });
});
