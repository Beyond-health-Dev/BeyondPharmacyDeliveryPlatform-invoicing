import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/cron", () => ({
  generateRecurringOrders: mocks.generate,
  formatGenerationMessage: () => "Generated 0 orders.",
}));

import { POST } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

function generate() {
  return POST(
    new NextRequest("http://localhost/api/surrey/recurring/generate", { method: "POST" }),
    { params: Promise.resolve({ store: "surrey" }) }
  );
}

describe("POST /api/[store]/recurring/generate (Generate Today's Orders)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStore.mockResolvedValue(store);
    mocks.generate.mockResolvedValue({ created: 0 });
  });

  it("refuses an admin of another store and generates nothing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "admin_2", role: "PHARMACY_ADMIN", storeId: "store_abbotsford" } });

    const res = await generate();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("refuses drivers and signed-out visitors", async () => {
    for (const session of [null, { user: { id: "driver_1", role: "DRIVER", storeId: store.id } }]) {
      mocks.auth.mockResolvedValue(session);
      expect((await generate()).status).toBe(401);
    }
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("runs for the store's own admin and for an admin of every store", async () => {
    for (const storeId of [store.id, null]) {
      mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId } });
      const res = await generate();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ created: 0, message: "Generated 0 orders." });
    }
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
});
