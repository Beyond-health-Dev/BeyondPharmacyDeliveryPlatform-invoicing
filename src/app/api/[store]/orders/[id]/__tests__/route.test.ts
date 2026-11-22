import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findOrder: vi.fn(),
  updateOrder: vi.fn(),
  findUser: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => {
  const client = {
    order: { findUnique: mocks.findOrder, update: mocks.updateOrder },
    user: { findUnique: mocks.findUser },
    notification: { create: mocks.createNotification },
  };
  return { prisma: { ...client, $transaction: (run: (tx: typeof client) => unknown) => run(client) } };
});

import { PATCH } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };
const order = {
  id: "o1",
  storeId: store.id,
  status: "PENDING",
  patientName: "Riley Chen",
  deliveryAddress: "7380 120 St",
  deliveryCity: "Surrey",
  isInvoiced: false,
  cancelledAt: null,
  completedAt: null,
  failedReason: null,
  attemptCount: 1,
};
const activeDriver = { role: "DRIVER", isActive: true, storeId: store.id };

function patch(body: object) {
  return PATCH(
    new NextRequest("http://localhost/api/surrey/orders/o1", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ store: "surrey", id: "o1" }) }
  );
}

beforeEach(() => {
  vi.stubEnv("SPOKE_PROVIDER_USER_IDS", "anchor_1");
  mocks.resolveStore.mockResolvedValue(store);
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
  mocks.findOrder.mockResolvedValue(order);
  mocks.updateOrder.mockImplementation(async ({ data }) => ({ ...order, ...data }));
  mocks.findUser.mockResolvedValue(activeDriver);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("PATCH /api/[store]/orders/[id] driver assignment", () => {
  it("refuses Anchor, whose orders are made from New Order", async () => {
    const res = await patch({ assignedDriverId: "anchor_1", status: "ASSIGNED" });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("New Order");
    expect(mocks.updateOrder).not.toHaveBeenCalled();
  });

  it.each([
    ["another store's driver", { ...activeDriver, storeId: "store_langley" }],
    ["an inactive driver", { ...activeDriver, isActive: false }],
    ["someone who isn't a driver", { ...activeDriver, role: "PHARMACY_ADMIN" }],
    ["an unknown user", null],
  ])("refuses %s", async (_label, user) => {
    mocks.findUser.mockResolvedValue(user);

    const res = await patch({ assignedDriverId: "driver_2", status: "ASSIGNED" });

    expect(res.status).toBe(400);
    expect(mocks.updateOrder).not.toHaveBeenCalled();
  });

  it("assigns an active driver of this store", async () => {
    const res = await patch({ assignedDriverId: "driver_1", status: "ASSIGNED" });

    expect(res.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "driver_1" } }));
    expect(mocks.updateOrder.mock.calls[0][0].data).toMatchObject({ assignedDriverId: "driver_1", status: "ASSIGNED" });
  });

  it("still accepts a null driver", async () => {
    const res = await patch({ assignedDriverId: null });

    expect(res.status).toBe(200);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it("leaves a driver's own status updates alone", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "driver_1", role: "DRIVER", storeId: store.id } });
    mocks.findOrder.mockResolvedValue({ ...order, status: "ASSIGNED", assignedDriverId: "driver_1" });

    expect((await patch({ status: "PICKED_UP" })).status).toBe(200);
    expect((await patch({ status: "FAILED", failedReason: "No answer" })).status).toBe(200);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.createNotification).toHaveBeenCalledTimes(2);
  });
});
