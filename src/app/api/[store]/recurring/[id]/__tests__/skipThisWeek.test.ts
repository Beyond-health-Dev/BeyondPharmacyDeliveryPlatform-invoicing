import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => ({
  prisma: {
    recurringOrder: { findUnique: mocks.findUnique },
    recurringOrderSkip: { upsert: mocks.upsert, deleteMany: mocks.deleteMany },
    order: { updateMany: mocks.updateMany },
  },
}));

import { POST as skip } from "../skip/route";
import { POST as unskip } from "../unskip/route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };
const context = { params: Promise.resolve({ store: "surrey", id: "rec_1" }) };

function post(action: "skip" | "unskip", body?: object) {
  return new NextRequest(`http://localhost/api/surrey/recurring/rec_1/${action}`, {
    method: "POST",
    ...(body && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);

// "Skip This Week" and "Unskip" send no date, so the server picks the week.
describe("Skip This Week / Unskip use the pharmacy's week", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
    mocks.findUnique.mockResolvedValue({ id: "rec_1", storeId: store.id });
    mocks.upsert.mockImplementation(async (args) => args.create);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    ["Saturday 7 PM PDT (UTC is already Sunday)", "2026-10-25T02:00:00Z", "2026-10-18"],
    ["Saturday 11 PM PST", "2026-11-29T07:00:00Z", "2026-11-22"],
    ["Sunday 12:30 AM PDT", "2026-10-25T07:30:00Z", "2026-10-25"],
  ])("skips the current Vancouver week on %s", async (_label, now, weekKey) => {
    vi.setSystemTime(new Date(now));
    const res = await skip(post("skip"), context);
    expect(res.status).toBe(201);

    const upsert = mocks.upsert.mock.calls[0][0];
    expect(upsert.where.recurringOrderId_skipDate.skipDate).toEqual(midnight(weekKey));
    expect(upsert.create.skipDate).toEqual(midnight(weekKey));
    // Cancels that week's open orders, not the next week's.
    const cancelled = mocks.updateMany.mock.calls[0][0];
    expect(cancelled.where.scheduledDate.gte).toEqual(midnight(weekKey));
    expect(cancelled.where.scheduledDate.lt.getTime() - midnight(weekKey).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("unskips the current Vancouver week on Saturday evening", async () => {
    vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
    const res = await unskip(post("unskip"), context);
    expect(res.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { recurringOrderId: "rec_1", skipDate: midnight("2026-10-18") },
    });
  });

  it("still uses the date the calendar sends for a one-day hold", async () => {
    vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
    await skip(post("skip", { skipDate: "2026-10-27", reason: "In hospital" }), context);
    expect(mocks.upsert.mock.calls[0][0].create.skipDate).toEqual(midnight("2026-10-27"));
    const cancelled = mocks.updateMany.mock.calls[0][0];
    expect(cancelled.where.scheduledDate).toEqual({ gte: midnight("2026-10-27"), lt: midnight("2026-10-28") });
  });
});
