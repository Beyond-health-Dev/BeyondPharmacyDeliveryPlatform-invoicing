import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => {
  const tx = {
    order: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    notification: { create: mocks.createNotification },
  };
  return { prisma: { $transaction: (run: (client: typeof tx) => unknown) => run(tx) } };
});

import { POST } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };
const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);

function call() {
  return POST(new NextRequest("http://localhost/api/surrey/orders/batch-deliver", { method: "POST" }), {
    params: Promise.resolve({ store: "surrey" }),
  });
}

describe("POST /api/[store]/orders/batch-deliver", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "driver_1", role: "DRIVER", storeId: store.id } });
    mocks.findMany.mockResolvedValue([{ id: "o1", patientName: "Riley Chen" }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.createNotification.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // The driver's page shows Vancouver's today; the button must deliver that
  // day's orders, not tomorrow's (UTC is a day ahead from ~5 PM Pacific).
  it.each([
    ["Wed 5:30 PM PDT", "2026-10-22T00:30:00Z", "2026-10-21", "2026-10-22"],
    ["Fri 4:30 PM PST", "2026-11-28T00:30:00Z", "2026-11-27", "2026-11-28"],
    ["Wed 9 AM PDT", "2026-10-21T16:00:00Z", "2026-10-21", "2026-10-22"],
    ["Sat Oct 31, 11 PM PDT", "2026-11-01T06:00:00Z", "2026-10-31", "2026-11-01"],
  ])("delivers Vancouver's today at %s", async (_label, now, today, tomorrow) => {
    vi.setSystemTime(new Date(now));
    const res = await call();
    expect(res.status).toBe(200);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.scheduledDate).toEqual({ gte: midnight(today), lt: midnight(tomorrow) });
    expect(where.assignedDriverId).toBe("driver_1");
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["o1"] } } }));
  });

  it("only lets drivers batch deliver", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
    expect((await call()).status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
