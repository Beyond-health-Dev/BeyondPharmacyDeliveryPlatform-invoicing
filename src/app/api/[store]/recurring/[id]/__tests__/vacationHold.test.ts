import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => ({
  prisma: { recurringOrder: { findUnique: mocks.findUnique, update: mocks.update } },
}));

import { PATCH } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

function patch(body: object) {
  return PATCH(
    new NextRequest("http://localhost/api/surrey/recurring/rec_1", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ store: "surrey", id: "rec_1" }) }
  );
}

describe("PATCH /api/[store]/recurring/[id] vacation hold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
    mocks.findUnique.mockResolvedValue({ id: "rec_1", storeId: store.id, isActive: true, activeDays: "[1,3,5]" });
    mocks.update.mockImplementation(async ({ data }) => ({ id: "rec_1", ...data }));
  });

  it("accepts a one-day hold (both days are included)", async () => {
    const res = await patch({ isOnHold: true, holdStart: "2026-10-30", holdEnd: "2026-10-30" });
    expect(res.status).toBe(200);
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      isOnHold: true,
      holdStart: new Date("2026-10-30T00:00:00.000Z"),
      holdEnd: new Date("2026-10-30T00:00:00.000Z"),
    });
  });

  it("rejects a hold that ends before it starts", async () => {
    const res = await patch({ isOnHold: true, holdStart: "2026-10-30", holdEnd: "2026-10-29" });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
