import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLabelSheetMoved, labelSheetsForProfile } from "@/lib/recurringLabels";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => ({
  prisma: {
    recurringOrder: { findUnique: mocks.findUnique, findMany: mocks.findMany, update: mocks.update },
  },
}));

import { PATCH } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

// One stored profile, changed by each PATCH like the database would be.
let row: { activeDays: unknown; labelSheets: unknown; [field: string]: unknown };

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

function written() {
  return mocks.update.mock.calls.at(-1)?.[0].data;
}

describe("PATCH /api/[store]/recurring/[id] label sheets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A Friday-only person moved to Monday's sheet.
    row = { id: "rec_1", storeId: store.id, isActive: true, activeDays: "[5]", labelSheets: '["monday"]' };
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
    mocks.findUnique.mockImplementation(async () => ({ ...row }));
    // No other profiles, so no duplicates.
    mocks.findMany.mockResolvedValue([]);
    mocks.update.mockImplementation(async ({ data }) => Object.assign(row, data));
  });

  it("goes back to automatic when the new days give the chosen sheet anyway", async () => {
    const res = await patch({ activeDays: [1] });
    expect(res.status).toBe(200);
    expect(written()).toEqual({ activeDays: "[1]", labelSheets: null });

    // Days edited again: the person follows them, and isn't shown as moved.
    await patch({ activeDays: [3] });
    expect(row.labelSheets).toBeNull();
    expect(labelSheetsForProfile(row)).toEqual(["wednesday"]);
    expect(isLabelSheetMoved(row)).toBe(false);
  });

  it("clears a choice equal to the new automatic sheet when it has several days", async () => {
    row.labelSheets = '["daily"]';
    await patch({ activeDays: [1, 3] });
    expect(written()).toEqual({ activeDays: "[1,3]", labelSheets: null });
  });

  it("keeps a choice that still differs from the new automatic sheet", async () => {
    await patch({ activeDays: [3] });
    expect(written()).toEqual({ activeDays: "[3]", labelSheets: '["monday"]' });
    expect(labelSheetsForProfile(row)).toEqual(["monday"]);

    row.labelSheets = '["daily","friday"]';
    await patch({ activeDays: [5] });
    expect(written().labelSheets).toBe('["daily","friday"]');
  });

  it("writes nothing about labels for a person on automatic", async () => {
    row.labelSheets = null;
    await patch({ activeDays: [1] });
    expect(written()).toEqual({ activeDays: "[1]" });
  });

  it("clears an unreadable stored choice", async () => {
    for (const stored of ["not json", '["funday"]', "[]", ""]) {
      row.labelSheets = stored;
      await patch({ activeDays: [2] });
      expect(written()).toEqual({ activeDays: "[2]", labelSheets: null });
    }
  });

  it("never writes the label choice when the days aren't sent", async () => {
    for (const body of [
      { isActive: false },
      { isActive: true },
      { recurrenceIntervalWeeks: 2 },
      { isOnHold: true, holdStart: "2026-10-30", holdEnd: "2026-10-31" },
    ]) {
      mocks.update.mockClear();
      row.labelSheets = '["friday"]';
      await patch(body);
      expect(written()).toBeDefined();
      expect(written()).not.toHaveProperty("labelSheets");
    }
  });

  it("writes nothing when the new days are refused", async () => {
    expect((await patch({ activeDays: [] })).status).toBe(400);
    mocks.findMany.mockResolvedValue([
      {
        id: "rec_2",
        storeId: store.id,
        patientId: "pat_1",
        patientName: "Riley Chen",
        patientPhone: null,
        deliveryAddress: "20150 Fraser Hwy",
        deliveryCity: "Langley",
        deliveryPostalCode: "V3A 4E6",
        activeDays: "[1]",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    row.patientId = "pat_1";
    row.patientName = "Riley Chen";
    expect((await patch({ activeDays: [1] })).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(row.labelSheets).toBe('["monday"]');
  });
});
