import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveStore: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: mocks.resolveStore }));
vi.mock("@/lib/db", () => ({ prisma: { recurringOrder: { findMany: mocks.findMany } } }));

import { GET } from "../route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };

function record(
  id: string,
  patientName: string,
  activeDays: string,
  labelSheets: string | null = null,
  extra: { deliveryAddress?: string; createdAt?: string } = {}
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
    labelSheets,
    createdAt: new Date(extra.createdAt ?? "2026-01-01T00:00:00Z"),
  };
}

// The same person as an older profile, added later at the same address.
const later = { deliveryAddress: "20150 Fraser Hwy", createdAt: "2026-03-01T00:00:00Z" };

// jsPDF writes text uncompressed, so the names can be read back.
async function pdfText(res: Response) {
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

function call(sheet: string | null) {
  const url = `http://localhost/api/surrey/recurring/labels${sheet === null ? "" : `?sheet=${sheet}`}`;
  return GET(new NextRequest(url), { params: Promise.resolve({ store: "surrey" }) });
}

describe("GET /api/[store]/recurring/labels", () => {
  beforeEach(() => {
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: store.id } });
    mocks.findMany.mockResolvedValue([
      record("1", "Avery Sandhu", "[1]"),
      record("2", "Jordan Kaur", "[1,3,5]"),
    ]);
  });

  it("needs a signed-in pharmacy admin", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await call("monday")).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { role: "DRIVER", storeId: store.id } });
    expect((await call("monday")).status).toBe(401);
  });

  it("refuses an admin of another store", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: "store_abbotsford" } });
    expect((await call("monday")).status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("404s for an unknown store", async () => {
    mocks.resolveStore.mockResolvedValue(null);
    expect((await call("monday")).status).toBe(404);
  });

  it("rejects an unknown sheet", async () => {
    expect((await call("funday")).status).toBe(400);
    expect((await call(null)).status).toBe(400);
  });

  it("won't make a blank sheet", async () => {
    const res = await call("saturday");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No one is on the Saturday label sheet.");
  });

  it("downloads the sheet as a PDF", async () => {
    const res = await call("monday");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="labels-surrey-monday.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(body.startsWith("%PDF")).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { storeId: store.id, isActive: true } })
    );
  });

  it("reads the staff choice of sheets with the profiles", async () => {
    await call("monday");
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ labelSheets: true, activeDays: true, deliveryPostalCode: true }),
      })
    );
  });

  it("prints a moved person on the sheet staff chose, and not on their old one", async () => {
    mocks.findMany.mockResolvedValue([
      record("1", "Avery Sandhu", "[1]", '["friday"]'),
      record("2", "Jordan Kaur", "[1,3,5]"),
    ]);
    const friday = await call("friday");
    expect(friday.status).toBe(200);
    expect(await pdfText(friday)).toContain("(Avery Sandhu)");

    // Avery was Monday's only person, so Monday is now empty.
    const monday = await call("monday");
    expect(monday.status).toBe(404);
    expect((await monday.json()).error).toBe("No one is on the Monday label sheet.");
  });

  it("prints a person on every sheet chosen", async () => {
    mocks.findMany.mockResolvedValue([record("1", "Avery Sandhu", "[1]", '["daily","saturday"]')]);
    for (const sheet of ["daily", "saturday"]) {
      const res = await call(sheet);
      expect(res.status).toBe(200);
      expect(await pdfText(res)).toContain("(Avery Sandhu)");
    }
    expect((await call("monday")).status).toBe(404);
  });

  it("falls back to the delivery days when the stored choice is unreadable", async () => {
    mocks.findMany.mockResolvedValue([record("1", "Avery Sandhu", "[1]", "not json")]);
    const res = await call("monday");
    expect(res.status).toBe(200);
    expect(await pdfText(res)).toContain("(Avery Sandhu)");
  });

  it("prints a partly duplicated profile on the sheet of the days it keeps", async () => {
    // Monday is already the older profile's, so the later one keeps Thursday
    // only: it goes on Thursday's sheet, not Daily (what Mon + Thu would give).
    mocks.findMany.mockResolvedValue([
      record("old", "Riley Chen", "[1]", null, { deliveryAddress: "20150 Fraser Hwy" }),
      record("dup", "Riley Chen", "[1,4]", null, later),
    ]);
    const thursday = await call("thursday");
    expect(thursday.status).toBe(200);
    expect(await pdfText(thursday)).toContain("(Riley Chen)");
    expect((await call("monday")).status).toBe(200);
    const daily = await call("daily");
    expect(daily.status).toBe(404);
    expect((await daily.json()).error).toBe("No one is on the Daily Deliveries label sheet.");
  });

  it("prints a hidden duplicate nowhere, even with sheets chosen for it", async () => {
    mocks.findMany.mockResolvedValue([
      record("old", "Riley Chen", "[1]", null, { deliveryAddress: "20150 Fraser Hwy" }),
      // Every day is already the older profile's: the page doesn't show it.
      record("hidden", "Riley Chen", "[1]", '["daily","friday"]', later),
    ]);
    // Only the older profile prints, on Monday.
    expect((await call("monday")).status).toBe(200);
    for (const sheet of ["daily", "sunday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
      expect((await call(sheet)).status).toBe(404);
    }
  });

  it("lets a super-admin (no store) print any store's sheet", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: null } });
    expect((await call("daily")).status).toBe(200);
  });
});
