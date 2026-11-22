import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as table from "@/lib/__tests__/fakeDispatchTable";
import { SpokeDispatchError } from "@/lib/spoke";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  createStop: vi.fn(),
  deleteStop: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
vi.mock("@/lib/spoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spoke")>()),
  createSpokeUnassignedStop: mocks.createStop,
  deleteSpokeUnassignedStop: mocks.deleteStop,
}));

import { POST } from "../route";

const STOP = "unassignedStops/u1";

async function retry(id: string) {
  const res = await POST(
    new NextRequest(`http://localhost/api/surrey/external-dispatches/${id}/retry`, { method: "POST" }),
    { params: Promise.resolve({ store: "surrey", id }) }
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.stubEnv("SPOKE_API_KEY", "test-key");
  table.resetTable();
  mocks.resolveStore.mockResolvedValue({ ...table.STORE, isActive: true });
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: table.STORE.id } });
  mocks.createStop.mockResolvedValue({ stopId: STOP, pending: false, requestPayload: {}, responsePayload: { id: STOP } });
  mocks.deleteStop.mockResolvedValue({ requestPayload: null, responsePayload: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/[store]/external-dispatches/[id]/retry", () => {
  it("sends a failed order that has no stop yet", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED", errorMessage: "Spoke timed out." });

    const { status, body } = await retry(failed.id);

    expect(status).toBe(200);
    expect(body.dispatch).toMatchObject({ status: "SUBMITTED", spokeStopId: STOP });
    expect(mocks.createStop).toHaveBeenCalledTimes(1);
    expect(mocks.createStop.mock.calls[0][1]).toMatchObject({ idempotencyKey: failed.idempotencyKey });
  });

  it("finishes a failed order whose stop already exists, without a second stop", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED", spokeStopId: STOP });

    const { status } = await retry(failed.id);

    expect(status).toBe(200);
    expect(mocks.createStop).not.toHaveBeenCalled();
    expect(table.row(failed.id)).toMatchObject({ status: "SUBMITTED", spokeStopId: STOP });
  });

  it("refuses a cancelled order", async () => {
    const cancelled = table.addRow({ status: "CANCELLED" });

    const { status, body } = await retry(cancelled.id);

    expect(status).toBe(409);
    expect(body.error).toBe("This order was cancelled, so it won't be sent to Anchor.");
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it.each([
    [
      "CANCEL_CLEANUP_FAILED",
      "This order was cancelled, but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it.",
    ],
    ["CANCELLED_BUT_ACTIVE", "This order was cancelled, but Anchor has started on it. Contact Anchor so it isn't delivered."],
  ])("says what to do about a cancelled order Anchor may still have (%s)", async (workflowStep, message) => {
    const cancelled = table.addRow({ status: "CANCELLED", workflowStep });

    const { status, body } = await retry(cancelled.id);

    expect(status).toBe(409);
    expect(body.error).toBe(message);
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it("says plainly that only an order that didn't reach Anchor can be sent again", async () => {
    const sent = table.addRow({ status: "SUBMITTED", spokeStopId: STOP });

    const { status, body } = await retry(sent.id);

    expect(status).toBe(409);
    expect(body.error).toContain("didn't reach Anchor");
    expect(body.error).not.toMatch(/Spoke|handoff/);
  });

  it("says the order wasn't found in plain words", async () => {
    const { status, body } = await retry("missing");

    expect(status).toBe(404);
    expect(body.error).toBe("This Anchor order wasn't found. Refresh the page.");
  });

  it("says the cleanup may have failed when a cancel lands mid-retry and the stop can't be removed", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED" });
    mocks.createStop.mockImplementation(async () => {
      Object.assign(table.row(failed.id), { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
      return { stopId: STOP, pending: false, requestPayload: {}, responsePayload: { id: STOP } };
    });
    mocks.deleteStop.mockRejectedValue(new Error("Spoke is down"));

    const { status, body } = await retry(failed.id);

    expect(status).toBe(409);
    expect(body.error).toContain("may still be in Anchor's list");
  });

  it("says the order may still be in Anchor's list when a cancel lands mid-retry and the call times out", async () => {
    // Spoke may have made the stop, but nobody knows its id.
    const failed = table.addRow({ status: "DISPATCH_FAILED" });
    mocks.createStop.mockImplementation(async () => {
      Object.assign(table.row(failed.id), { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
      throw new SpokeDispatchError("Spoke CREATE_UNASSIGNED_STOP request timed out.", 502, null, "CREATE_UNASSIGNED_STOP", null);
    });

    const { status, body } = await retry(failed.id);

    expect(status).toBe(409);
    expect(body.error).toBe(
      "This order was cancelled, but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it."
    );
    expect(table.row(failed.id)).toMatchObject({ status: "CANCELLED", workflowStep: "CANCEL_CLEANUP_FAILED" });
    expect(table.notifications).toHaveLength(1);
  });

  it("says so when the order is cancelled while the retry is out", async () => {
    const failed = table.addRow({ status: "DISPATCH_FAILED" });
    mocks.createStop.mockImplementation(async () => {
      Object.assign(table.row(failed.id), { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
      return { stopId: STOP, pending: false, requestPayload: {}, responsePayload: { id: STOP } };
    });

    const { status, body } = await retry(failed.id);

    expect(status).toBe(409);
    expect(body.error).toContain("cancelled");
    expect(mocks.deleteStop).toHaveBeenCalledTimes(1);
    expect(table.row(failed.id).status).toBe("CANCELLED");
  });
});
