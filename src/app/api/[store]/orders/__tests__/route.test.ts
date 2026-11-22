import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as table from "@/lib/__tests__/fakeDispatchTable";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  createStop: vi.fn(),
  deleteStop: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
// The Anchor table, plus the few other lookups the order POST makes. No
// in-house orders and no other same-day deliveries exist.
vi.mock("@/lib/db", async () => {
  const fake = await import("@/lib/__tests__/fakeDispatchTable");
  return {
    prisma: {
      ...fake.dbModule.prisma,
      externalDispatch: { ...fake.externalDispatch, findMany: vi.fn(async () => []) },
      order: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
      deliveryZone: {
        findUnique: vi.fn(async () => ({ id: "zone_1", name: "Surrey North", price: 8, storeId: fake.STORE.id })),
      },
      user: {
        findUnique: vi.fn(async () => ({ ...fake.ANCHOR, role: "DRIVER", isActive: true, storeId: fake.STORE.id })),
      },
    },
  };
});
vi.mock("@/lib/spoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spoke")>()),
  createSpokeUnassignedStop: mocks.createStop,
  deleteSpokeUnassignedStop: mocks.deleteStop,
}));

import { POST } from "../route";

const KEY = "5b0c2a52-8f0e-4a39-9d8e-3f1c5d2b7a10";
// 11 AM on Sun, Nov 22 in Vancouver.
const NOW = new Date("2026-11-22T19:00:00Z");

async function save(scheduledDate: string) {
  const res = await POST(
    new NextRequest("http://localhost/api/surrey/orders", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: KEY,
        patientName: "Riley Chen",
        patientPhone: "604-555-0101",
        deliveryAddress: "7380 120 St",
        deliveryCity: "Surrey",
        deliveryPostalCode: "V3W 3M8",
        deliveryZoneId: "zone_1",
        assignedDriverId: table.ANCHOR.id,
        scheduledDate,
      }),
    }),
    { params: Promise.resolve({ store: "surrey" }) }
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("SPOKE_API_KEY", "test-key");
  vi.stubEnv("SPOKE_PROVIDER_USER_IDS", table.ANCHOR.id);
  table.resetTable();
  mocks.resolveStore.mockResolvedValue({ ...table.STORE, isActive: true });
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: table.STORE.id } });
  mocks.createStop.mockResolvedValue({ stopId: "unassignedStops/u1", pending: false, requestPayload: {}, responsePayload: {} });
  mocks.deleteStop.mockResolvedValue({ requestPayload: null, responsePayload: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/[store]/orders, Anchor order saved again with the same request key", () => {
  it("answers 409 with a message for staff when a failed same-day send is saved again for tomorrow", async () => {
    const failed = table.addRow({
      idempotencyKey: KEY,
      status: "DISPATCH_FAILED",
      scheduledDate: new Date("2026-11-22T00:00:00.000Z"),
    });
    const before = { ...failed };

    const { status, body } = await save("2026-11-23");

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error:
        "This order was already saved for Sun, Nov 22 and didn't reach Anchor. Cancel that one on Orders first (and check Anchor's list if it may have been sent), then save it again for the new day.",
      external: true,
    });
    expect(table.rows).toEqual([before]);
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it("answers 409 when a same-day save is repeated after the order was cancelled", async () => {
    const cancelled = table.addRow({
      idempotencyKey: KEY,
      status: "CANCELLED",
      workflowStep: "CANCEL_UNASSIGNED_STOP",
      scheduledDate: new Date("2026-11-22T00:00:00.000Z"),
    });
    const before = { ...cancelled };

    const { status, body } = await save("2026-11-22");

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: "This order was already saved for Sun, Nov 22 and then cancelled. Save it again to make a new order.",
      external: true,
    });
    expect(table.rows).toEqual([before]);
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it("answers 409 when the order is cancelled while this save sends it", async () => {
    mocks.createStop.mockImplementation(async () => {
      // The row this save made, as the cancel route leaves it.
      Object.assign(table.rows[0], { status: "CANCELLED", workflowStep: "CANCEL_UNASSIGNED_STOP" });
      return { stopId: "unassignedStops/u1", pending: false, requestPayload: {}, responsePayload: {} };
    });

    const { status, body } = await save("2026-11-22");

    expect(status).toBe(409);
    expect(body.error).toBe(
      "This order was already saved for Sun, Nov 22 and then cancelled. Save it again to make a new order."
    );
    // The stop it had just made is taken back out of Anchor's list.
    expect(mocks.deleteStop).toHaveBeenCalledTimes(1);
  });

  it("answers 201 for a new same-day order sent to Anchor", async () => {
    const { status, body } = await save("2026-11-22");

    expect(status).toBe(201);
    expect(body).toMatchObject({ external: true, status: "SUBMITTED", spokeStopId: "unassignedStops/u1" });
  });

  it("holds a new order for tomorrow", async () => {
    const { status, body } = await save("2026-11-23");

    expect(status).toBe(201);
    expect(body).toMatchObject({ external: true, status: "SCHEDULED" });
    expect(mocks.createStop).not.toHaveBeenCalled();
  });

  it("returns the held order for a replay of the same save", async () => {
    table.addRow({ idempotencyKey: KEY, status: "SCHEDULED", scheduledDate: new Date("2026-11-23T00:00:00.000Z") });

    const { status, body } = await save("2026-11-23");

    expect(status).toBe(200);
    expect(body).toMatchObject({ external: true, status: "SCHEDULED" });
  });
});
