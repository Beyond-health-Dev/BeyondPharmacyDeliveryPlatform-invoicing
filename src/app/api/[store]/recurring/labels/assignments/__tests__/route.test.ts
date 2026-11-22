import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => {
  const prisma = {
    recurringOrder: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    $transaction: mocks.transaction,
  };
  // Runs an interactive callback, or settles an array of queries, like Prisma.
  mocks.transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[])
  );
  return { prisma };
});

import { PUT } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

function record(
  id: string,
  patientName: string,
  activeDays: string,
  extra: { labelSheets?: string | null; createdAt?: string; deliveryAddress?: string } = {}
) {
  return {
    id,
    storeId: store.id,
    patientId: null,
    patientName,
    patientPhone: null,
    deliveryAddress: extra.deliveryAddress ?? `${id} Main St`,
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3L5",
    activeDays,
    labelSheets: extra.labelSheets ?? null,
    createdAt: new Date(extra.createdAt ?? "2026-01-01T00:00:00Z"),
  };
}

// This store's active profiles (what the findMany where asks for). r_dup is
// the same person as r_old, added later on Monday and Thursday: Monday is
// already r_old's, so the page shows r_dup on Thursday only.
const profiles = [
  record("r_mon", "Avery Sandhu", "[1]"),
  record("r_daily", "Jordan Kaur", "[1,3,5]", { labelSheets: '["friday"]' }),
  record("r_old", "Riley Chen", "[1]", { deliveryAddress: "20150 Fraser Hwy" }),
  record("r_dup", "Riley Chen", "[1,4]", { deliveryAddress: "20150 Fraser Hwy", createdAt: "2026-03-01T00:00:00Z" }),
];

function put(body: unknown, raw = false) {
  return PUT(
    new NextRequest("http://localhost/api/surrey/recurring/labels/assignments", {
      method: "PUT",
      body: raw ? (body as string) : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ store: "surrey" }) }
  );
}

// Every write, as { ids, labelSheets }.
function writes() {
  return mocks.updateMany.mock.calls.map(([args]) => ({
    ids: [...args.where.id.in].sort(),
    labelSheets: args.data.labelSheets,
  }));
}

describe("PUT /api/[store]/recurring/labels/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: store.id } });
    mocks.findMany.mockResolvedValue(profiles);
    mocks.updateMany.mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
  });

  it("needs a signed-in pharmacy admin of this store", async () => {
    const body = { assignments: [{ id: "r_mon", sheets: ["friday"] }] };
    mocks.auth.mockResolvedValue(null);
    expect((await put(body)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { role: "DRIVER", storeId: store.id } });
    expect((await put(body)).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: "store_abbotsford" } });
    expect((await put(body)).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("404s for an unknown store", async () => {
    mocks.resolveStore.mockResolvedValue(null);
    expect((await put({ assignments: [{ id: "r_mon", sheets: null }] })).status).toBe(404);
  });

  it.each([
    ["unreadable JSON", "{not json", "The request body must be JSON"],
    ["an empty body", "", "The request body must be JSON"],
    ["no assignments", "{}", "assignments must be a list"],
    ["assignments that aren't a list", '{"assignments":{"id":"r_mon"}}', "assignments must be a list"],
    ["a JSON null body", "null", "assignments must be a list"],
    ["no assignments in the list", '{"assignments":[]}', "nothing to save"],
  ])("rejects %s", async (_label, raw, message) => {
    const res = await put(raw, true);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects more than 500 assignments", async () => {
    const assignments = Array.from({ length: 501 }, (_, i) => ({ id: `r${i}`, sheets: null }));
    const res = await put({ assignments });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("at most 500");
    // 500 is fine.
    expect((await put({ assignments: assignments.slice(0, 500) })).status).toBe(200);
  });

  it.each([
    ["an entry that isn't an object", ["r_mon"], "profile id"],
    ["an entry with no id", [{ sheets: null }], "profile id"],
    ["a number id", [{ id: 7, sheets: null }], "profile id"],
    ["a repeated id", [{ id: "r_mon", sheets: null }, { id: "r_mon", sheets: ["friday"] }], "more than once"],
    ["missing sheets", [{ id: "r_mon" }], "sheets must be null"],
    ["an empty list of sheets", [{ id: "r_mon", sheets: [] }], "sheets must be null"],
    ["an unknown sheet", [{ id: "r_mon", sheets: ["monday", "funday"] }], "sheets must be null"],
    ["sheets as a string", [{ id: "r_mon", sheets: '["monday"]' }], "sheets must be null"],
    ["a sheet that isn't a string", [{ id: "r_mon", sheets: [1] }], "sheets must be null"],
  ])("rejects %s", async (_label, assignments, message) => {
    const res = await put({ assignments });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("stores the sheets in order, once each, as JSON text", async () => {
    const res = await put({ assignments: [{ id: "r_mon", sheets: ["thursday", "monday", "thursday"] }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1, missing: 0 });
    expect(writes()).toEqual([{ ids: ["r_mon"], labelSheets: '["monday","thursday"]' }]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("clears a choice with null", async () => {
    const res = await put({ assignments: [{ id: "r_daily", sheets: null }] });
    expect(await res.json()).toEqual({ updated: 1, missing: 0 });
    expect(writes()).toEqual([{ ids: ["r_daily"], labelSheets: null }]);
  });

  it("stores the automatic sheet as null, using the days the page shows", async () => {
    const res = await put({
      assignments: [
        { id: "r_mon", sheets: ["monday"] },
        { id: "r_daily", sheets: ["daily"] },
        // Thursday is r_dup's only visible day, so Thursday is automatic...
        { id: "r_dup", sheets: ["thursday"] },
      ],
    });
    expect(await res.json()).toEqual({ updated: 3, missing: 0 });
    expect(writes()).toEqual([{ ids: ["r_daily", "r_dup", "r_mon"], labelSheets: null }]);

    // ...and Daily (what its stored days alone would give) is a real choice.
    mocks.updateMany.mockClear();
    await put({ assignments: [{ id: "r_dup", sheets: ["daily"] }] });
    expect(writes()).toEqual([{ ids: ["r_dup"], labelSheets: '["daily"]' }]);
  });

  it("groups the writes by value, in one transaction", async () => {
    const res = await put({
      assignments: [
        { id: "r_mon", sheets: ["friday"] },
        { id: "r_daily", sheets: ["friday"] },
        { id: "r_old", sheets: ["daily", "monday"] },
        { id: "r_dup", sheets: null },
      ],
    });
    expect(await res.json()).toEqual({ updated: 4, missing: 0 });
    expect(writes()).toEqual([
      { ids: ["r_daily", "r_mon"], labelSheets: '["friday"]' },
      { ids: ["r_old"], labelSheets: '["daily","monday"]' },
      { ids: ["r_dup"], labelSheets: null },
    ]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.mock.calls[0][0]).toHaveLength(3);
  });

  it("skips and counts ids that aren't this store's active profiles", async () => {
    const res = await put({
      assignments: [
        { id: "r_mon", sheets: ["friday"] },
        { id: "other_store_profile", sheets: ["friday"] },
        { id: "inactive_profile", sheets: null },
      ],
    });
    expect(await res.json()).toEqual({ updated: 1, missing: 2 });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storeId: store.id, isActive: true },
        select: expect.objectContaining({ labelSheets: true, activeDays: true }),
      })
    );
    const written = writes().flatMap((write) => write.ids);
    expect(written).toEqual(["r_mon"]);
  });

  it("skips a profile hidden as a duplicate", async () => {
    mocks.findMany.mockResolvedValue([
      record("r_old", "Riley Chen", "[1]", { deliveryAddress: "20150 Fraser Hwy" }),
      // Every day already r_old's: the page doesn't show it.
      record("r_hidden", "Riley Chen", "[1]", { deliveryAddress: "20150 Fraser Hwy", createdAt: "2026-03-01T00:00:00Z" }),
    ]);
    const res = await put({ assignments: [{ id: "r_hidden", sheets: ["friday"] }] });
    expect(await res.json()).toEqual({ updated: 0, missing: 1 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("counts a profile removed before the write as missing", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const res = await put({ assignments: [{ id: "r_mon", sheets: ["friday"] }] });
    expect(await res.json()).toEqual({ updated: 0, missing: 1 });
  });

  it("scopes every write to the store and never touches delivery days", async () => {
    await put({
      assignments: [
        { id: "r_mon", sheets: ["friday"] },
        { id: "r_daily", sheets: null },
        { id: "r_dup", sheets: ["daily", "thursday"] },
      ],
    });
    expect(mocks.updateMany).toHaveBeenCalledTimes(3);
    for (const [args] of mocks.updateMany.mock.calls) {
      expect(args.where.storeId).toBe(store.id);
      expect(Object.keys(args.data)).toEqual(["labelSheets"]);
      expect(JSON.stringify(args)).not.toContain("activeDays");
    }
  });

  it("lets a super-admin (no store) rearrange any store's labels", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: null } });
    const res = await put({ assignments: [{ id: "r_mon", sheets: ["friday"] }] });
    expect(res.status).toBe(200);
    expect(mocks.updateMany.mock.calls[0][0].where.storeId).toBe(store.id);
  });
});
