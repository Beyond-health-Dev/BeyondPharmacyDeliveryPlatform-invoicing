import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Any database call is recorded and fails, so "nothing was written" is
// checked on every table at once.
const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const table = (name: string) =>
    new Proxy({}, {
      get: (_target, method) => (typeof method === "string"
        ? () => {
          calls.push(`${name}.${method}`);
          throw new Error("This test has no database");
        }
        : undefined),
    });
  const prisma = new Proxy({}, {
    get: (_target, name) => (typeof name === "string" && name !== "then" ? table(name) : undefined),
  });
  return { calls, prisma, auth: vi.fn(), resolveStore: vi.fn() };
});

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { POST } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

function create(body: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/surrey/recurring", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ store: "surrey" }) }
  );
}

const profile = {
  patientName: "Sample Patient",
  deliveryAddress: "1 Sample Rd",
  deliveryCity: "Surrey",
  deliveryPostalCode: "V3W 3L5",
  deliveryZoneId: "zone_1",
  activeDays: [3],
};

describe("POST /api/[store]/recurring (new recurring profile)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.resolveStore.mockResolvedValue(store);
  });

  it("refuses an admin of another store and writes nothing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_2", role: "PHARMACY_ADMIN", storeId: "store_abbotsford" } });

    const res = await create(profile);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.calls).toEqual([]);
  });

  it("lets the store's own admin through to the usual checks", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });

    const res = await create({ ...profile, patientName: " " });

    expect(res.status).toBe(400);
    expect(mocks.calls).toEqual([]);
  });
});
