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

function profile(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    storeId: store.id,
    patientId: null,
    patientName: `Patient ${id}`,
    patientPhone: null,
    deliveryAddress: `${id} Main St`,
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3L5",
    activeDays: "[0,3]", // Sunday and Wednesday
    recurrenceIntervalWeeks: 1,
    recurrenceAnchorDate: date("2026-01-04"),
    isOnHold: false,
    holdStart: null,
    holdEnd: null,
    assignedDriverId: null,
    assignedDriver: null,
    deliveryZone: { name: "Surrey", price: 6 },
    skips: [],
    orders: [],
    ...extra,
  };
}

// The week of Sun Oct 18 to Sat Oct 24, 2026.
async function holds() {
  const res = await GET(
    new NextRequest("http://localhost/api/surrey/recurring/calendar?start=2026-10-18&end=2026-10-25"),
    { params: Promise.resolve({ store: "surrey" }) }
  );
  expect(res.status).toBe(200);
  const { instances } = await res.json();
  return Object.fromEntries(
    instances.map((i: { recurringOrderId: string; date: string; holdType: string | null }) => [
      `${i.recurringOrderId} ${i.date}`,
      i.holdType,
    ])
  );
}

describe("GET /api/[store]/recurring/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStore.mockResolvedValue(store);
    mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
  });

  it("tells one-day holds, week skips and vacation holds apart", async () => {
    mocks.findMany.mockResolvedValue([
      profile("sunday", { skips: [{ skipDate: date("2026-10-18"), scope: "DAY", reason: "In hospital" }] }),
      profile("week", { skips: [{ skipDate: date("2026-10-18"), scope: "WEEK", reason: "Patient picked up in-store" }] }),
      profile("vacation", { isOnHold: true, holdStart: date("2026-10-20"), holdEnd: date("2026-10-30") }),
    ]);
    expect(await holds()).toEqual({
      // Holding Sunday leaves Wednesday's delivery alone.
      "sunday 2026-10-18": "INSTANCE",
      "sunday 2026-10-21": null,
      "week 2026-10-18": "WEEK",
      "week 2026-10-21": "WEEK",
      // The vacation hold starts on Tuesday, after Sunday's delivery.
      "vacation 2026-10-18": null,
      "vacation 2026-10-21": "TEMPLATE",
    });
  });
});
