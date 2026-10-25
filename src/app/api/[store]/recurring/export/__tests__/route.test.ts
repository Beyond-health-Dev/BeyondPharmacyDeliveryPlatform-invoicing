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
const date = (key: string) => new Date(`${key}T00:00:00.000Z`);

function profile(patientName: string, extra: Record<string, unknown> = {}) {
  return {
    id: patientName,
    storeId: store.id,
    patientId: null,
    patientName,
    patientPhone: null,
    deliveryAddress: `${patientName.length}00 Main St`,
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3L5",
    activeDays: "[0,1,2,3,4,5,6]",
    recurrenceIntervalWeeks: 1,
    recurrenceAnchorDate: date("2026-01-04"),
    isOnHold: false,
    holdStart: null,
    holdEnd: null,
    skips: [],
    ...extra,
  };
}

async function exportedNames(dateKey: string) {
  const res = await GET(new NextRequest(`http://localhost/api/surrey/recurring/export?date=${dateKey}`), {
    params: Promise.resolve({ store: "surrey" }),
  });
  expect(res.status).toBe(200);
  return (await res.text()).split("\n").slice(1).map((row) => JSON.parse(row.split(",")[0]));
}

describe("GET /api/[store]/recurring/export (Export Today's CSV)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
  });

  it("keeps a patient whose vacation hold hasn't started, and leaves out one whose hold has", async () => {
    mocks.findMany.mockResolvedValue([
      profile("Upcoming", { isOnHold: true, holdStart: date("2026-10-30"), holdEnd: date("2026-11-08") }),
      profile("Away", { isOnHold: true, holdStart: date("2026-10-20"), holdEnd: date("2026-11-08") }),
      profile("Ongoing", { isOnHold: true }),
    ]);
    expect(await exportedNames("2026-10-26")).toEqual(["Upcoming"]);
    expect(await exportedNames("2026-10-30")).toEqual([]);
  });

  it("leaves out only the held day for a one-day Sunday hold, and the whole week for Skip This Week", async () => {
    mocks.findMany.mockResolvedValue([
      profile("Sunday hold", { skips: [{ skipDate: date("2026-10-18"), scope: "DAY", reason: "In hospital" }] }),
      profile("Week skip", { skips: [{ skipDate: date("2026-10-18"), scope: "WEEK", reason: "Patient picked up in-store" }] }),
      profile("Old week skip", { skips: [{ skipDate: date("2026-10-18"), scope: null, reason: "Patient picked up in-store" }] }),
    ]);
    expect(await exportedNames("2026-10-18")).toEqual([]);
    expect(await exportedNames("2026-10-21")).toEqual(["Sunday hold"]);
  });
});
