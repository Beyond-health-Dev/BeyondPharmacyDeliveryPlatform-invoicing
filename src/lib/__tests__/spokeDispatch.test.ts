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

  it("a save for today onto a request already held for tomorrow, and writes nothing", async () => {
    const held = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", scheduledDate: new Date("2026-11-23T00:00:00.000Z") });
    const before = { ...held };
    const onBeforeComplete = vi.fn(async () => ({ patientId: "p1", deliveryAddressId: "a1" }));

    const err = await dispatchOrderToSpoke(
      sendInput({ scheduledDate: new Date("2026-11-22T00:00:00.000Z"), scheduledDateKey: "2026-11-22", onBeforeComplete })
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SpokeDispatchError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/^This order was already saved for Mon, Nov 23 and is waiting to go to Anchor\./);
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(onBeforeComplete).not.toHaveBeenCalled();
    expect(table.writeCount()).toBe(0);
    expect(table.row(held.id)).toEqual(before);
  });

  it("a replay for another day onto a row that is already sent, instead of quietly returning it", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SUBMITTED", scheduledDate: new Date("2026-11-21T00:00:00.000Z") });

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toMatchObject({ statusCode: 409 });
    expect(table.writeCount()).toBe(0);
  });

  it("when the other save won the race for another day", async () => {
    table.externalDispatch.create.mockImplementationOnce(async (args) => {
      table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", scheduledDate: new Date("2026-11-24T00:00:00.000Z") });
      return table.impl.create(args);
    });

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toMatchObject({ statusCode: 409 });
    expect(spoke.createStop).not.toHaveBeenCalled();
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ status: "SCHEDULED", workflowStep: null });
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

  it("keeps the mark Anchor's update left, recording the stop", async () => {
    // Cancelled here, then Anchor reported the stop active, before the
    // sender got its answer back.
    spoke.createStop.mockImplementation(async () => {
      Object.assign(byKey(), { status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" });
      return stopCreated();
    });

    await dispatchOrderToSpoke(sendInput());

    expect(byKey()).toMatchObject({
      status: "CANCELLED",
      workflowStep: "CANCELLED_BUT_ACTIVE",
      spokeStopId: NEW_STOP,
    });
  });

  it("counts an order cancelled after its stop was recorded as not sent", async () => {
    // The cancel route saw the stop and removes it at Spoke itself.
    const result = await dispatchOrderToSpoke(
      sendInput({
        onBeforeComplete: async () => {
          Object.assign(byKey(), { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
          return { patientId: "p1", deliveryAddressId: "a1" };
        },
      })
    );

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(spoke.deleteStop).not.toHaveBeenCalled();
    expect(byKey()).toMatchObject({ status: "CANCELLED", spokeStopId: NEW_STOP, patientId: "p1" });
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

  it("throws when the failure can't be recorded", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockRejectedValue(failure());
    table.externalDispatch.updateMany
      .mockImplementationOnce(table.impl.updateMany)
      .mockRejectedValueOnce(new Error("database is busy"));

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toBeInstanceOf(SpokeDispatchError);
  });

  it("throws when the row is gone", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      table.rows.splice(0, table.rows.length);
      throw failure();
    });

    await expect(dispatchOrderToSpoke(sendInput())).rejects.toBeInstanceOf(SpokeDispatchError);
  });
});

describe("a failed Spoke call after the order moved on", () => {
  const failed = (upstreamStatus: number | null) =>
    new SpokeDispatchError(
      upstreamStatus === null
        ? "Spoke CREATE_UNASSIGNED_STOP request timed out."
        : `Spoke CREATE_UNASSIGNED_STOP failed with status ${upstreamStatus}.`,
      502,
      null,
      "CREATE_UNASSIGNED_STOP",
      upstreamStatus
    );

  function cancelledDuringCall(error: SpokeDispatchError) {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      cancelHere(byKey());
      throw error;
    });
  }

  it.each([
    ["timed out", null],
    ["a server error", 503],
    ["a conflict", 409],
  ])(
    "keeps a cancel, and asks staff to check Anchor's list when the call %s",
    async (_label, upstreamStatus) => {
      cancelledDuringCall(failed(upstreamStatus));

      const result = await dispatchOrderToSpoke(sendInput());

      // The row as flagged, so callers word it as possibly left at Anchor.
      expect(result).toMatchObject({
        alreadyDispatched: true,
        dispatch: { status: "CANCELLED", workflowStep: "CANCEL_CLEANUP_FAILED" },
      });
      expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_CLEANUP_FAILED", errorMessage: null });
      expect(table.notifications).toHaveLength(1);
      expect(table.notifications[0]).toMatchObject({ type: "SPOKE_CANCEL_INCOMPLETE", storeId: table.STORE.id });
      expect(table.notifications[0].message).toContain("Riley Chen (7380 120 St, Surrey)");
    }
  );

  it("still alerts staff, without throwing, when the cancel can't be flagged", async () => {
    cancelledDuringCall(failed(null));
    table.externalDispatch.updateMany.mockImplementation(async (args) => {
      if (args.data.workflowStep === "CANCEL_CLEANUP_FAILED") throw new Error("database is busy");
      return table.impl.updateMany(args);
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
    expect(table.notifications).toHaveLength(1);
    expect(table.notifications[0]).toMatchObject({ type: "SPOKE_CANCEL_INCOMPLETE", storeId: table.STORE.id });
    expect(table.notifications[0].message).toContain("Remove it in Spoke");
  });

  it.each([400, 401, 403, 404, 422, 429])(
    "keeps a cancel quietly when Spoke refused the stop (%s)",
    async (upstreamStatus) => {
      cancelledDuringCall(failed(upstreamStatus));

      const result = await dispatchOrderToSpoke(sendInput());

      expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
      expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
      expect(table.notifications).toEqual([]);
    }
  );

  it("doesn't alert twice when Anchor's update already said it is active", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      Object.assign(byKey(), { status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" });
      throw failed(503);
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result.alreadyDispatched).toBe(true);
    expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCELLED_BUT_ACTIVE" });
    expect(table.notifications).toEqual([]);
  });

  it("doesn't flag a cancel when the failure came after the stop was recorded", async () => {
    // The cancel route saw the stop, so it removes it itself.
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });

    const result = await dispatchOrderToSpoke(
      sendInput({
        onBeforeComplete: async () => {
          cancelHere(byKey());
          throw new Error("Could not save the patient.");
        },
      })
    );

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "CANCELLED" } });
    expect(byKey()).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP", spokeStopId: NEW_STOP });
    expect(table.notifications).toEqual([]);
  });

  it("keeps an order another run sent meanwhile", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
    spoke.createStop.mockImplementation(async () => {
      Object.assign(byKey(), { status: "SUBMITTED", workflowStep: "CREATE_UNASSIGNED_STOP", spokeStopId: NEW_STOP });
      throw failed(503);
    });

    const result = await dispatchOrderToSpoke(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "SUBMITTED" } });
    expect(byKey()).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP, errorMessage: null });
    expect(table.notifications).toEqual([]);
  });
});

describe("two runs sending one waiting order", () => {
  // Both claim it and call Spoke under the same idempotency key (Spoke makes
  // one stop). The loser's call fails; the winner's succeeds.
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function startBoth() {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });
    const calls: Array<ReturnType<typeof deferred<ReturnType<typeof stopCreated>>>> = [];
    spoke.createStop.mockImplementation(() => {
      const call = deferred<ReturnType<typeof stopCreated>>();
      calls.push(call);
      return call.promise;
    });
    const winner = dispatchOrderToSpoke(sendInput());
    const loser = dispatchOrderToSpoke(sendInput());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const timeout = new SpokeDispatchError("Spoke CREATE_UNASSIGNED_STOP request timed out.", 502, null, "CREATE_UNASSIGNED_STOP", null);
    return {
      winner,
      loser,
      succeed: () => calls[0].resolve(stopCreated()),
      fail: () => calls[1].reject(timeout),
    };
  }

  it("ends SUBMITTED when the loser records its failure first", async () => {
    const run = await startBoth();

    run.fail();
    await expect(run.loser).rejects.toBeInstanceOf(SpokeDispatchError);
    expect(byKey().status).toBe("DISPATCH_FAILED");
    run.succeed();
    const result = await run.winner;

    expect(result).toMatchObject({ alreadyDispatched: false, dispatch: { status: "SUBMITTED" } });
    expect(byKey()).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP, errorMessage: null });
  });

  it("ends SUBMITTED when the loser records its failure after the winner's writes", async () => {
    const run = await startBoth();

    run.succeed();
    expect(await run.winner).toMatchObject({ alreadyDispatched: false });
    run.fail();
    const late = await run.loser;

    expect(late).toMatchObject({ alreadyDispatched: true, dispatch: { status: "SUBMITTED" } });
    expect(byKey()).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP, errorMessage: null });
    expect(table.notifications).toEqual([]);
  });

  it("ends SUBMITTED when the loser's failure lands between the winner's two writes", async () => {
    const run = await startBoth();
    let between: string | null = null;
    table.externalDispatch.updateMany.mockImplementation(async (args) => {
      const result = await table.impl.updateMany(args);
      if (args.data.status === "STOP_CREATED") {
        run.fail();
        await expect(run.loser).rejects.toBeInstanceOf(SpokeDispatchError);
        between = byKey().status;
      }
      return result;
    });

    run.succeed();
    const result = await run.winner;

    expect(between).toBe("DISPATCH_FAILED");
    expect(result).toMatchObject({ alreadyDispatched: false, dispatch: { status: "SUBMITTED" } });
    expect(byKey()).toMatchObject({ status: "SUBMITTED", spokeStopId: NEW_STOP, errorMessage: null });
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

  it("returns a replayed hold for the same day exactly as it is", async () => {
    const existing = table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });
    const before = { ...existing };

    const result = await scheduleDeferredSpokeDispatch(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { id: existing.id, status: "SCHEDULED" } });
    expect(table.writeCount()).toBe(0);
    expect(table.row(existing.id)).toEqual(before);
  });

  it.each(["CANCELLED", "SUBMITTED", "DISPATCH_FAILED", "PENDING"])(
    "refuses a same-day replay onto a %s row, leaving it exactly as it is",
    async (status) => {
      const existing = table.addRow({ idempotencyKey: KEY, status });
      const before = { ...existing };

      const err = await scheduleDeferredSpokeDispatch(sendInput()).catch((e) => e);

      expect(err).toBeInstanceOf(SpokeDispatchError);
      expect(err.statusCode).toBe(409);
      expect(err.message).toMatch(/^This order was already saved for Mon, Nov 23/);
      expect(table.writeCount()).toBe(0);
      expect(table.row(existing.id)).toEqual(before);
    }
  );

  it.each([
    ["CANCEL_CLEANUP_FAILED", "but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it, then save it again."],
    ["CANCELLED_BUT_ACTIVE", "but Anchor has started on it. Contact Anchor so it isn't delivered, then save it again."],
  ])("refuses a replay onto a cancelled row Anchor may still have (%s), saying to sort that out first", async (workflowStep, ending) => {
    table.addRow({ idempotencyKey: KEY, status: "CANCELLED", workflowStep });

    const err = await scheduleDeferredSpokeDispatch(sendInput()).catch((e) => e);

    expect(err).toBeInstanceOf(SpokeDispatchError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toMatch(/^This order was already saved for Mon, Nov 23 and then cancelled, /);
    expect(err.message.endsWith(ending)).toBe(true);
    expect(err.message).not.toContain("make a new order");
    expect(table.writeCount()).toBe(0);
  });

  it("refuses a save for tomorrow whose same-day send failed, so it isn't taken as held", async () => {
    // Saved for today, the send failed (or was cut short), then staff moved
    // the date to tomorrow and saved again with the same request key.
    const failed = table.addRow({
      idempotencyKey: KEY,
      status: "DISPATCH_FAILED",
      scheduledDate: new Date("2026-11-22T00:00:00.000Z"),
    });
    const before = { ...failed };

    const err = await scheduleDeferredSpokeDispatch(
      sendInput({ scheduledDate: new Date("2026-11-23T00:00:00.000Z"), scheduledDateKey: "2026-11-23" })
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SpokeDispatchError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe(
      "This order was already saved for Sun, Nov 22 and didn't reach Anchor. Cancel that one on Orders first (and check Anchor's list if it may have been sent), then save it again for the new day."
    );
    expect(table.writeCount()).toBe(0);
    expect(table.rows).toHaveLength(1);
    expect(table.row(failed.id)).toEqual(before);
  });

  it("refuses the same for a send that was cut short", async () => {
    table.addRow({
      idempotencyKey: KEY,
      status: "PENDING",
      workflowStep: "SENDING",
      scheduledDate: new Date("2026-11-22T00:00:00.000Z"),
    });

    await expect(scheduleDeferredSpokeDispatch(sendInput())).rejects.toMatchObject({ statusCode: 409 });
    expect(table.writeCount()).toBe(0);
  });

  it("returns the other save's row when two race to create it", async () => {
    table.externalDispatch.create.mockImplementationOnce(async (args) => {
      table.addRow({ idempotencyKey: KEY, status: "SCHEDULED" });
      return table.impl.create(args);
    });

    const result = await scheduleDeferredSpokeDispatch(sendInput());

    expect(result).toMatchObject({ alreadyDispatched: true, dispatch: { status: "SCHEDULED" } });
    expect(table.rows).toHaveLength(1);
  });

  it("refuses when the other save won the race for another day", async () => {
    table.externalDispatch.create.mockImplementationOnce(async (args) => {
      table.addRow({ idempotencyKey: KEY, status: "PENDING", scheduledDate: new Date("2026-11-22T00:00:00.000Z") });
      return table.impl.create(args);
    });

    await expect(scheduleDeferredSpokeDispatch(sendInput())).rejects.toMatchObject({ statusCode: 409 });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ status: "PENDING", scheduledDate: new Date("2026-11-22T00:00:00.000Z") });
  });

  it("refuses another store's key", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", storeId: table.OTHER_STORE.id });

    await expect(scheduleDeferredSpokeDispatch(sendInput())).rejects.toMatchObject({ statusCode: 409 });
  });
});
