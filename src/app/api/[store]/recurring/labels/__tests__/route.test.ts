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

function record(id: string, patientName: string, activeDays: string) {
  return {
    id,
    storeId: store.id,
    patientId: null,
    patientName,
    patientPhone: null,
    deliveryAddress: `${id} Main St`,
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3L5",
    activeDays,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
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

  it("lets a super-admin (no store) print any store's sheet", async () => {
    mocks.auth.mockResolvedValue({ user: { role: "PHARMACY_ADMIN", storeId: null } });
    expect((await call("daily")).status).toBe(200);
  });
});
