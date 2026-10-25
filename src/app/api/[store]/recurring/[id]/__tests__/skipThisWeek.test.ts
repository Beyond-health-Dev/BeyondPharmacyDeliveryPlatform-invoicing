import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasRecurringSkipForDate } from "@/lib/recurringHolds";

interface SkipRow {
  id: string;
  recurringOrderId: string;
  skipDate: Date;
  scope: string | null;
  reason: string | null;
  createdById: string;
}

// An in-memory RecurringOrderSkip table, so whole sequences (hold a day, skip
// the week, undo) can be checked on the rows they leave behind.
const db = vi.hoisted(() => {
  const rows: SkipRow[] = [];
  const sameKey = (row: SkipRow, key: { recurringOrderId: string; skipDate: Date }) =>
    row.recurringOrderId === key.recurringOrderId && row.skipDate.getTime() === key.skipDate.getTime();
  const matches = (row: SkipRow, where: Partial<SkipRow>) => {
    const unknown = Object.keys(where).filter((key) => !["id", "recurringOrderId", "skipDate"].includes(key));
    if (unknown.length) throw new Error(`The fake skip table can't filter on ${unknown.join(", ")}`);
    return matchesKnown(row, where);
  };
  const matchesKnown = (row: SkipRow, where: Partial<SkipRow>) =>
    (where.id === undefined || row.id === where.id) &&
    (where.recurringOrderId === undefined || row.recurringOrderId === where.recurringOrderId) &&
    (where.skipDate === undefined || row.skipDate.getTime() === where.skipDate.getTime());
  let nextId = 1;
  return {
    rows,
    auth: vi.fn(),
    resolveStore: vi.fn(),
    cancelOrders: vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 0 })),
    skip: {
      findUnique: vi.fn(async ({ where }) => rows.find((r) => sameKey(r, where.recurringOrderId_skipDate)) ?? null),
      upsert: vi.fn(async ({ where, update, create }) => {
        const row = rows.find((r) => sameKey(r, where.recurringOrderId_skipDate));
        if (row) return Object.assign(row, update);
        const created = { id: `s${nextId++}`, scope: null, reason: null, ...create };
        rows.push(created);
        return created;
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const hits = rows.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return { count: hits.length };
      }),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: db.auth }));
vi.mock("@/lib/store", () => ({ resolveStore: db.resolveStore }));
vi.mock("@/lib/db", () => ({
  prisma: {
    recurringOrder: { findUnique: async () => ({ id: "rec_1", storeId: "store_surrey" }) },
    recurringOrderSkip: db.skip,
    order: { updateMany: db.cancelOrders },
  },
}));

import { POST as skip } from "../skip/route";
import { POST as unskip } from "../unskip/route";

const store = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey", isActive: true };
const context = { params: Promise.resolve({ store: "surrey", id: "rec_1" }) };
const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);
const WEEK_REASON = "Patient picked up in-store";

function call(action: "skip" | "unskip", body?: object) {
  const route = action === "skip" ? skip : unskip;
  return route(
    new NextRequest(`http://localhost/api/surrey/recurring/rec_1/${action}`, {
      method: "POST",
      ...(body && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }),
    context
  );
}

// Is the delivery on this day held, going by the rows left behind? (The week
// of Sun Oct 18 to Sat Oct 24, 2026.)
const heldOn = (key: string, weekKey = "2026-10-18") =>
  hasRecurringSkipForDate(db.rows, { dayStart: midnight(key), weekStart: midnight(weekKey) });
const rowsNow = () => db.rows.map(({ skipDate, scope, reason }) => ({ date: skipDate.toISOString().slice(0, 10), scope, reason }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z")); // Wed Oct 21, 11 AM PDT
  db.rows.length = 0;
  db.resolveStore.mockResolvedValue(store);
  db.auth.mockResolvedValue({ user: { id: "admin_1", role: "PHARMACY_ADMIN", storeId: store.id } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// "Skip This Week" and "Unskip" send no date, so the server picks the week.
describe("Skip This Week uses the pharmacy's week", () => {
  it.each([
    ["Saturday 7 PM PDT (UTC is already Sunday)", "2026-10-25T02:00:00Z", "2026-10-18"],
    ["Saturday 11 PM PST", "2026-11-29T07:00:00Z", "2026-11-22"],
    ["Sunday 12:30 AM PDT", "2026-10-25T07:30:00Z", "2026-10-25"],
  ])("skips the current Vancouver week on %s", async (_label, now, weekKey) => {
    vi.setSystemTime(new Date(now));
    expect((await call("skip")).status).toBe(201);
    expect(rowsNow()).toEqual([{ date: weekKey, scope: "WEEK", reason: WEEK_REASON }]);
    // Cancels that week's open orders, not the next week's.
    const cancelled = db.cancelOrders.mock.calls[0][0] as { where: { scheduledDate: { gte: Date; lt: Date } } };
    expect(cancelled.where.scheduledDate.gte).toEqual(midnight(weekKey));
    expect(cancelled.where.scheduledDate.lt.getTime() - midnight(weekKey).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("unskips the current Vancouver week on Saturday evening", async () => {
    vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
    await call("skip");
    expect((await call("unskip")).status).toBe(200);
    expect(db.rows).toEqual([]);
  });
});

describe("one-day holds and Skip This Week stay separate", () => {
  it("a one-day hold uses the calendar's date and holds only that day", async () => {
    await call("skip", { skipDate: "2026-10-22", reason: "In hospital" });
    expect(rowsNow()).toEqual([{ date: "2026-10-22", scope: "DAY", reason: "In hospital" }]);
    const cancelled = db.cancelOrders.mock.calls[0][0] as { where: { scheduledDate: unknown } };
    expect(cancelled.where.scheduledDate).toEqual({ gte: midnight("2026-10-22"), lt: midnight("2026-10-23") });
    expect(heldOn("2026-10-22")).toBe(true);
    expect(heldOn("2026-10-21")).toBe(false);
  });

  it("holding a Sunday doesn't skip the rest of the week", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: "In hospital" });
    expect(heldOn("2026-10-18")).toBe(true);
    expect(heldOn("2026-10-21")).toBe(false);
  });

  it("Unskip leaves a one-day Sunday hold alone", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: "In hospital" });
    await call("unskip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: "In hospital" }]);
  });

  it("skipping and unskipping the week gives back a one-day hold already on its Sunday", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: "In hospital" });
    await call("skip");
    expect(heldOn("2026-10-21")).toBe(true);
    await call("unskip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: "In hospital" }]);
    expect(heldOn("2026-10-18")).toBe(true);
    expect(heldOn("2026-10-21")).toBe(false);
  });

  it("gives back a one-day Sunday hold even when its reason reads like a week skip's", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: WEEK_REASON });
    await call("skip");
    expect(heldOn("2026-10-21")).toBe(true);
    await call("unskip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: WEEK_REASON }]);
    expect(heldOn("2026-10-18")).toBe(true);
    expect(heldOn("2026-10-21")).toBe(false);
  });

  it("a second Skip This Week click keeps the one-day hold under it", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: "In hospital" });
    await call("skip");
    await call("skip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "WEEK_OVER_DAY", reason: "In hospital" }]);
    await call("unskip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: "In hospital" }]);
  });

  it("the calendar's Resume Week does the same", async () => {
    await call("skip", { skipDate: "2026-10-18", reason: "In hospital" });
    await call("skip");
    await call("unskip", { skipDate: "2026-10-18", scope: "WEEK" });
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: "In hospital" }]);
  });

  it("the calendar's Resume on a one-day hold removes it", async () => {
    await call("skip", { skipDate: "2026-10-22", reason: "In hospital" });
    await call("unskip", { skipDate: "2026-10-22" });
    expect(db.rows).toEqual([]);
  });

  it("a one-day hold on a week-skipped Sunday keeps the week skipped, also for rows older code saved", async () => {
    // Saved by the code before this change: no scope.
    db.rows.push({ id: "old", recurringOrderId: "rec_1", skipDate: midnight("2026-10-18"), scope: null, reason: WEEK_REASON, createdById: "admin_1" });
    await call("skip", { skipDate: "2026-10-18", reason: "Away" });
    expect(heldOn("2026-10-21")).toBe(true);
    // Undoing the week leaves the Sunday hold.
    await call("unskip");
    expect(rowsNow()).toEqual([{ date: "2026-10-18", scope: "DAY", reason: "Away" }]);
  });

  it("Unskip removes a week skip older code saved", async () => {
    db.rows.push({ id: "old", recurringOrderId: "rec_1", skipDate: midnight("2026-10-18"), scope: null, reason: WEEK_REASON, createdById: "admin_1" });
    await call("unskip");
    expect(db.rows).toEqual([]);
  });
});
