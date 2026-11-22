import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpokeDispatchError } from "@/lib/spoke";
import * as table from "@/lib/__tests__/fakeDispatchTable";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  deleteStop: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
vi.mock("@/lib/spoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spoke")>()),
  deleteSpokeUnassignedStop: mocks.deleteStop,
}));

import { DELETE } from "../route";

const STOP = "unassignedStops/u1";

async function cancel(id: string) {
  const res = await DELETE(
    new NextRequest(`http://localhost/api/surrey/external-dispatches/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ store: "surrey", id }) }
  );
  return { status: res.status, body: await res.json() };
}

const spokeError = (upstreamStatus: number) =>
  new SpokeDispatchError(
    `Spoke CANCEL_UNASSIGNED_STOP failed with status ${upstreamStatus}.`,
    502,
    { error: "upstream" },
    "CANCEL_UNASSIGNED_STOP",
    upstreamStatus
  );

beforeEach(() => {
  vi.stubEnv("SPOKE_API_KEY", "test-key");
  table.resetTable();
  mocks.resolveStore.mockResolvedValue({ ...table.STORE, isActive: true });
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: table.STORE.id } });
  mocks.deleteStop.mockResolvedValue({ requestPayload: null, responsePayload: { deleted: true } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("DELETE /api/[store]/external-dispatches/[id] access", () => {
  it("404s an unknown store", async () => {
    mocks.resolveStore.mockResolvedValue(null);
    expect((await cancel("d1")).status).toBe(404);
  });

  it("401s anyone but a pharmacy admin", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "driver_1", role: "DRIVER", storeId: table.STORE.id } });
    expect((await cancel("d1")).status).toBe(401);
  });

  it("403s another store's admin", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_2", role: "PHARMACY_ADMIN", storeId: table.OTHER_STORE.id } });
    expect((await cancel("d1")).status).toBe(403);
  });

  it("404s another store's order, and leaves it alone", async () => {
    const theirs = table.addRow({ status: "SCHEDULED", storeId: table.OTHER_STORE.id });
    expect((await cancel(theirs.id)).status).toBe(404);
    expect(table.row(theirs.id).status).toBe("SCHEDULED");
  });
});

describe("cancelling an order not yet sent to Anchor", () => {
  it("cancels a waiting order without calling Spoke", async () => {
    const waiting = table.addRow({ status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });

    const { status, body } = await cancel(waiting.id);

    expect(status).toBe(200);
    expect(body.message).toBe("Cancelled. It was never sent to Anchor.");
    expect(body.needsCheck).toBeUndefined();
    expect(body.dispatch.status).toBe("CANCELLED");
    expect(table.row(waiting.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });

  it("cancels a failed order with no stop, warning that the earlier send may have reached Anchor", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED", errorMessage: "Spoke timed out." });

    const { status, body } = await cancel(failed.id);

    expect(status).toBe(200);
    expect(body.message).toContain("may have reached Anchor");
    expect(body.needsCheck).toBe(true);
    expect(table.row(failed.id)).toMatchObject({ status: "CANCELLED", errorMessage: null });
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });

  it("gives the same warning when a send was under way", async () => {
    const sending = table.addRow({ status: "SCHEDULED", workflowStep: "SENDING" });

    const { body } = await cancel(sending.id);

    expect(body.message).toContain("may have reached Anchor");
    expect(body.needsCheck).toBe(true);
    expect(table.row(sending.id).status).toBe("CANCELLED");
  });

  it("gives the warning when a release starts sending between the read and the write", async () => {
    const waiting = table.addRow({ status: "SCHEDULED", workflowStep: "AWAITING_RELEASE" });
    table.externalDispatch.findUnique.mockImplementationOnce(async (args) => {
      const read = await table.impl.findUnique(args);
      // The release claims it and calls Spoke.
      table.row(waiting.id).workflowStep = "SENDING";
      return read;
    });

    const { status, body } = await cancel(waiting.id);

    expect(status).toBe(200);
    expect(body.message).toContain("may have reached Anchor");
    expect(body.needsCheck).toBe(true);
    expect(table.row(waiting.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });
});

describe("cancelling an order in Anchor's unassigned list", () => {
  it("removes the stop at Spoke, then marks it cancelled", async () => {
    const sent = table.addRow({ status: "SUBMITTED", spokeStopId: STOP, idempotencyKey: "order-1" });

    const { status, body } = await cancel(sent.id);

    expect(status).toBe(200);
    expect(body.message).toBe("Cancelled and removed from Anchor's list.");
    expect(body.needsCheck).toBeUndefined();
    expect(mocks.deleteStop).toHaveBeenCalledTimes(1);
    expect(mocks.deleteStop.mock.calls[0][1]).toEqual({ unassignedStopId: STOP, idempotencyKey: "order-1" });
    expect(table.row(sent.id)).toMatchObject({ status: "CANCELLED", responsePayload: { deleted: true } });
  });

  it("removes the stop of a failed order that has one", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED", spokeStopId: STOP });

    expect((await cancel(failed.id)).status).toBe(200);
    expect(mocks.deleteStop).toHaveBeenCalledTimes(1);
    expect(table.row(failed.id).status).toBe("CANCELLED");
  });

  it("marks it cancelled when Spoke says the stop is already gone", async () => {
    const sent = table.addRow({ status: "SUBMITTED", spokeStopId: STOP });
    mocks.deleteStop.mockRejectedValue(spokeError(404));

    const { status, body } = await cancel(sent.id);

    expect(status).toBe(200);
    expect(body.message).toContain("already gone");
    expect(body.needsCheck).toBeUndefined();
    expect(table.row(sent.id).status).toBe("CANCELLED");
  });

  it("leaves the status alone when Spoke fails", async () => {
    const sent = table.addRow({ status: "SUBMITTED", spokeStopId: STOP });
    mocks.deleteStop.mockRejectedValue(spokeError(500));

    const { status, body } = await cancel(sent.id);

    expect(status).toBe(502);
    expect(body).toMatchObject({ external: true, provider: "SPOKE" });
    expect(body.error).toContain("has not been cancelled");
    expect(table.row(sent.id)).toMatchObject({
      status: "SUBMITTED",
      errorMessage: "Spoke CANCEL_UNASSIGNED_STOP failed with status 500.",
    });
  });
});

describe("orders that can't be cancelled here", () => {
  it("refuses an order Anchor has allocated", async () => {
    const allocated = table.addRow({ status: "ALLOCATED", spokeStopId: STOP });

    const { status, body } = await cancel(allocated.id);

    expect(status).toBe(409);
    expect(body.error).toContain("Anchor");
    expect(table.row(allocated.id).status).toBe("ALLOCATED");
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });

  it("refuses a stop already on one of Anchor's routes", async () => {
    const planned = table.addRow({ status: "SUBMITTED", spokeStopId: "plans/p1/stops/s1" });

    expect((await cancel(planned.id)).status).toBe(409);
    expect(table.row(planned.id).status).toBe("SUBMITTED");
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });

  it("says an already cancelled order is cancelled", async () => {
    const cancelled = table.addRow({ status: "CANCELLED" });

    const { status, body } = await cancel(cancelled.id);

    expect(status).toBe(200);
    expect(body.message).toBe("Already cancelled.");
    expect(table.writeCount()).toBe(0);
  });

  it.each([
    [
      "CANCEL_CLEANUP_FAILED",
      "Already cancelled, but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it.",
    ],
    ["CANCELLED_BUT_ACTIVE", "Already cancelled, but Anchor has started on it. Contact Anchor so it isn't delivered."],
  ])("says what to do about an already cancelled order Anchor may still have (%s)", async (workflowStep, message) => {
    const cancelled = table.addRow({ status: "CANCELLED", workflowStep });

    const { status, body } = await cancel(cancelled.id);

    expect(status).toBe(200);
    expect(body).toMatchObject({ message, needsCheck: true });
    expect(table.writeCount()).toBe(0);
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });
});

describe("a cancel racing the sender or Anchor", () => {
  it("removes the stop at Spoke when the sender records one between the read and the write", async () => {
    const waiting = table.addRow({ status: "SCHEDULED", idempotencyKey: "order-1" });
    table.externalDispatch.findUnique.mockImplementationOnce(async (args) => {
      const read = await table.impl.findUnique(args);
      Object.assign(table.row(waiting.id), { status: "STOP_CREATED", spokeStopId: STOP, externalReference: STOP });
      return read;
    });

    const { status } = await cancel(waiting.id);

    expect(status).toBe(200);
    expect(mocks.deleteStop).toHaveBeenCalledTimes(1);
    expect(mocks.deleteStop.mock.calls[0][1]).toMatchObject({ unassignedStopId: STOP });
    expect(table.row(waiting.id)).toMatchObject({ status: "CANCELLED", spokeStopId: STOP });
  });

  it("refuses, without overwriting, when Anchor allocates it between the read and the write", async () => {
    const waiting = table.addRow({ status: "PENDING" });
    table.externalDispatch.findUnique.mockImplementationOnce(async (args) => {
      const read = await table.impl.findUnique(args);
      Object.assign(table.row(waiting.id), { status: "ALLOCATED", spokeStopId: "plans/p1/stops/s1" });
      return read;
    });

    expect((await cancel(waiting.id)).status).toBe(409);
    expect(table.row(waiting.id)).toMatchObject({ status: "ALLOCATED", spokeStopId: "plans/p1/stops/s1" });
    expect(mocks.deleteStop).not.toHaveBeenCalled();
  });

  it("refuses, without overwriting, when Anchor's update lands while Spoke removes the stop", async () => {
    const sent = table.addRow({ status: "SUBMITTED", spokeStopId: STOP });
    mocks.deleteStop.mockImplementation(async () => {
      table.row(sent.id).status = "ALLOCATED";
      return { requestPayload: null, responsePayload: null };
    });

    const { status, body } = await cancel(sent.id);

    expect(status).toBe(409);
    expect(body.error).toContain("Anchor picked up this order");
    expect(table.row(sent.id).status).toBe("ALLOCATED");
  });
});
