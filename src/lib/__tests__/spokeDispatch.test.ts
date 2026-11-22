import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalDispatch } from "@prisma/client";
import { SpokeDispatchError } from "@/lib/spoke";
import * as table from "./fakeDispatchTable";

const spoke = vi.hoisted(() => ({
  createStop: vi.fn(),
  deleteStop: vi.fn(),
}));

vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
vi.mock("@/lib/spoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spoke")>()),
  createSpokeUnassignedStop: spoke.createStop,
  deleteSpokeUnassignedStop: spoke.deleteStop,
}));

import { dispatchOrderToSpoke, scheduleDeferredSpokeDispatch } from "@/lib/spokeDispatch";

const KEY = "order-1";
const NEW_STOP = "unassignedStops/u1";

function sendInput(overrides: Partial<Parameters<typeof dispatchOrderToSpoke>[0]> = {}) {
  return {
    idempotencyKey: KEY,
    patientId: null,
    patientName: "Riley Chen",
    patientPhone: "604-555-0101",
    deliveryAddress: "7380 120 St",
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3M8",
    deliveryAddressId: null,
    deliveryZoneId: "zone_1",
    deliveryZoneName: "Surrey North",
    priceAtCreation: 8,
    instructions: null,
    scheduledDate: new Date("2026-11-23T00:00:00.000Z"),
    scheduledDateKey: "2026-11-23",
    store: table.STORE,
    selectedProviderUser: table.ANCHOR,
    createdById: "admin_1",
    ...overrides,
  };
}

const stopCreated = (stopId = NEW_STOP) => ({
  stopId,
  pending: false,
  requestPayload: {},
  responsePayload: { id: stopId },
});

const byKey = (key = KEY) => {
  const found = table.rows.find((r) => r.idempotencyKey === key);
  if (!found) throw new Error(`No row for ${key}`);
  return found;
};

// What the cancel route writes when it wins: cancelled here, no stop known.
function cancelHere(row: ExternalDispatch) {
  Object.assign(row, { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP", errorMessage: null });
}

beforeEach(() => {
  vi.stubEnv("SPOKE_API_KEY", "test-key");
  table.resetTable();
  spoke.createStop.mockResolvedValue(stopCreated());
  spoke.deleteStop.mockResolvedValue({ requestPayload: null, responsePayload: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("dispatchOrderToSpoke sends", () => {
  it("a new same-day order and ends SUBMITTED with the stop id", async () => {
    const result = await dispatchOrderToSpoke(
      sendInput({ onBeforeComplete: async () => ({ patientId: "p1", deliveryAddressId: "a1" }) })
    );

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.createStop).toHaveBeenCalledTimes(1);
    expect(spoke.createStop.mock.calls[0][1]).toMatchObject({ idempotencyKey: KEY });
    expect(byKey()).toMatchObject({
      status: "SUBMITTED",
      workflowStep: "CREATE_UNASSIGNED_STOP",
      spokeStopId: NEW_STOP,
      externalReference: NEW_STOP,
      patientId: "p1",
      deliveryAddressId: "a1",
      storeId: table.STORE.id,
      selectedProviderUserId: table.ANCHOR.id,
    });
    expect(result.dispatch.status).toBe("SUBMITTED");
  });

  it("a waiting order on release day, keeping it SCHEDULED while the call is out", async () => {
    const waiting = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });
    spoke.createStop.mockImplementation(async () => {
      expect(table.row(waiting.id)).toMatchObject({ status: "SCHEDULED", workflowStep: "SENDING" });
      return stopCreated();
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.createStop).toHaveBeenCalledTimes(1);
    expect(table.row(waiting.id)).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP });
  });

  it("a retry of a failed order with no stop yet", async () => {
    const failed = table.addRow({ idempotencyKey: KEY, status: "DISPATCH_FAILED", errorMessage: "Spoke timed out." });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.createStop).toHaveBeenCalledTimes(1);
    expect(table.row(failed.id)).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP, errorMessage: null });
  });

  it("a retry of a failed order whose stop already exists, without creating another", async () => {
    const failed = table.addRow({
      idempotencyKey: KEY,
      status: "DISPATCH_FAILED",
      spokeStopId: "unassignedStops/u9",
      externalReference: "unassignedStops/u9",
      errorMessage: "Could not save the patient.",
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(table.row(failed.id)).toMatchObject({
      status: "SUBMITTED",
      spokeStopId: "unassignedStops/u9",
      errorMessage: null,
    });
  });

  it("once when two saves with the same key race to create the row", async () => {
    table.externalDispatch.create.mockImplementationOnce(async (args) => {
      table.addRow({ idempotencyKey: KEY, status: "PENDING" });
      return table.impl.create(args);
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result.alreadyDispatched).toBe(false);
    expect(table.rows).toHaveLength(1);
    expect(byKey()).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP });
  });
});

describe("dispatchOrderToSpoke never sends", () => {
  it.each(["SUBMITTED", "ALLOCATED", "CANCELLED", "WEBHOOK_RECEIVED"])(
    "a %s order, and writes nothing",
    async (status) => {
      const existing = table.addRow({ idempotencyKey: KEY, status, spokeStopId: "unassignedStops/u7" });
      const before = { ...existing };

      const result = await dispatchOrderToSpoke(sendInput());

      expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status } });
      expect(spoke.createStop).not.toHaveBeenCalled();
      expect(table.writeCount()).toBe(0);
      expect(table.row(existing.id)).toEqual(before);
    }
  );

  it("an order cancelled between the first read and the check before calling Spoke", async () => {
    const waiting = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });
    let afterCancel: ExternalDispatch | null = null;
    table.externalDispatch.findUnique.mockImplementationOnce(async (args) => {
      const read = await table.impl.findUnique(args);
      cancelHere(table.row(waiting.id));
      afterCancel = { ...table.row(waiting.id) };
      return read;
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(table.row(waiting.id)).toEqual(afterCancel);
    expect(table.row(waiting.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
  });

  it("another store's key, and leaves that store's row alone", async () => {
    const theirs = table.addRow({ idempotencyKey: KEY, status: "PENDING", storeId: table.OTHER_STORE.id });
    const before = { ...theirs };

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toMatchObject({ statusCode: 409 });
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(table.row(theirs.id)).toEqual(before);
  });
});

describe("a cancel during the Spoke call wins", () => {
  // The cancel route sees no stop yet, so it marks the row cancelled; the
  // sender must take its new stop back out of Anchor's list.
  it.each([
    ["a new order", () => null],
    ["a waiting order on release day", () => table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" })],
  ])("removes the stop it just made for %s", async (_label, seed) => {
    seed();
    spoke.createStop.mockImplementation(async () => {
      cancelHere(byKey());
      return stopCreated();
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(spoke.deleteStop).toHaveBeenCalledTimes(1);
    expect(spoke.deleteStop.mock.calls[0][1]).toEqual({ unassignedStopId: NEW_STOP, idempotencyKey: KEY });
    expect(byKey()).toMatchObject({
      status: "CANCELLED",
      spokeStopId: NEW_STOP,
      workflowStep: "CANCEL_UNASSIGNED_STOP",
    });
    expect(table.notifications).toEqual([]);
  });

  it("alerts staff, without throwing, when the stop can't be removed", async () => {
    spoke.createStop.mockImplementation(async () => {
      cancelHere(byKey());
      return stopCreated();
    });
    spoke.deleteStop.mockRejectedValue(
      new SpokeDispatchError("Spoke CANCEL_UNASSIGNED_STOP failed with status 500.", 502, null, "CANCEL_UNASSIGNED_STOP", 500)
    );

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(byKey()).toMatchObject({
      status: "CANCELLED",
      spokeStopId: NEW_STOP,
      workflowStep: "CANCEL_CLEANUP_FAILED",
    });
    expect(table.notifications).toHaveLength(1);
    expect(table.notifications[0]).toMatchObject({ type: "SPOKE_CANCEL_INCOMPLETE", storeId: table.STORE.id });
    expect(table.notifications[0].message).toContain("Riley Chen (7380 120 St, Surrey)");
    expect(table.notifications[0].message).toContain("Anchor's list");
  });

  it("treats a stop Spoke says is already gone as removed", async () => {
    spoke.createStop.mockImplementation(async () => {
      cancelHere(byKey());
      return stopCreated();
    });
    spoke.deleteStop.mockRejectedValue(
      new SpokeDispatchError("Spoke CANCEL_UNASSIGNED_STOP failed with status 404.", 502, null, "CANCEL_UNASSIGNED_STOP", 404)
    );

    await dispatchOrderToSpoke(sendInput());

    expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
    expect(table.notifications).toEqual([]);
  });
});

describe("Anchor's update during the Spoke call", () => {
  it("keeps the webhook's status and stop id, and removes nothing", async () => {
    const waiting = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      Object.assign(table.row(waiting.id), {
        status: "ALLOCATED",
        spokeStopId: "plans/p1/stops/s1",
        externalReference: "plans/p1/stops/s1",
      });
      return stopCreated();
    });

    const result = await dispatchOrderToSpoke(
      sendInput({ onBeforeComplete: async () => ({ patientId: "p1", deliveryAddressId: "a1" }) })
    );

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.deleteStop).not.toHaveBeenCalled();
    expect(table.row(waiting.id)).toMatchObject({
      status: "ALLOCATED",
      spokeStopId: "plans/p1/stops/s1",
      externalReference: "plans/p1/stops/s1",
      patientId: "p1",
      deliveryAddressId: "a1",
      workflowStep: "CREATE_UNASSIGNED_STOP",
    });
  });
});

describe("a failed Spoke call", () => {
  const failure = () =>
    new SpokeDispatchError("Spoke CREATE_UNASSIGNED_STOP failed with status 503.", 502, { error: "busy" }, "CREATE_UNASSIGNED_STOP", 503);

  it.each(["SCHEDULED", "PENDING", "DISPATCH_FAILED"])("marks a %s order failed with the new message", async (status) => {
    const existing = table.addRow({ idempotencyKey: KEY, status, errorMessage: status === "DISPATCH_FAILED" ? "Old failure." : null });
    spoke.createStop.mockRejectedValue(failure());

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toMatchObject({ statusCode: 502 });

    expect(table.row(existing.id)).toMatchObject({
      status: "DISPATCH_FAILED",
      workflowStep: "CREATE_UNASSIGNED_STOP",
      errorMessage: "Spoke CREATE_UNASSIGNED_STOP failed with status 503.",
    });
  });

  it("marks a waiting order failed when Spoke isn't set up", async () => {
    const waiting = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    vi.stubEnv("SPOKE_API_KEY", "");

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toMatchObject({ statusCode: 500 });
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(table.row(waiting.id)).toMatchObject({ status: "DISPATCH_FAILED", workflowStep: "SETUP" });
  });

  it("marks a new order failed", async () => {
    spoke.createStop.mockRejectedValue(failure());

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toBeInstanceOf(SpokeDispatchError);
    expect(byKey().status).toBe("DISPATCH_FAILED");
  });

  it("leaves an order cancelled during the call cancelled", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      cancelHere(byKey());
      throw failure();
    });

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toBeInstanceOf(SpokeDispatchError);
    expect(byKey()).toMatchObject({ status: "CANCELLED", errorMessage: null });
  });
});

describe("scheduleDeferredSpokeDispatch", () => {
  it("holds a future-dated order as SCHEDULED without calling Spoke", async () => {
    const result = await scheduleDeferredSpokeDispatch(
      sendInput({ onBeforeComplete: async () => ({ patientId: "p1", deliveryAddressId: "a1" }) })
    );

    expect(result.alreadyDispatched).toBe(false);
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(byKey()).toMatchObject({
      status: "SCHEDULED",
      workflowStep: "AWAITING_RELEASE",
      spokeStopId: null,
      patientId: "p1",
      deliveryAddressId: "a1",
      requestPayload: expect.objectContaining({ orderInfo: expect.objectContaining({ sellerOrderId: KEY }) }),
    });
  });

  it.each(["SCHEDULED", "CANCELLED", "SUBMITTED", "DISPATCH_FAILED"])(
    "leaves an existing %s row exactly as it is",
    async (status) => {
      const existing = table.addRow({ idempotencyKey: KEY, status });
      const before = { ...existing };

      const result = await scheduleDeferredSpokeDispatch(sendInput());

      expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { id: existing.id, status } });
      expect(table.writeCount()).toBe(0);
      expect(table.row(existing.id)).toEqual(before);
    }
  );

  it("returns the other save's row when two race to create it", async () => {
    table.externalDispatch.create.mockImplementationOnce(async (args) => {
      table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
      return table.impl.create(args);
    });

    const result = await scheduleDeferredSpokeDispatch(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "SCHEDULED" } });
    expect(table.rows).toHaveLength(1);
  });

  it("refuses another store's key", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", storeId: table.OTHER_STORE.id });

    await expect(scheduleDeferredSpokeDispatch(sendInput())).rejects.toMatchObject({ statusCode: 409 });
  });
});
