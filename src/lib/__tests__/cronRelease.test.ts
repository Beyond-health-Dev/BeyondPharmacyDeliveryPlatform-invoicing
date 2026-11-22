import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as table from "./fakeDispatchTable";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
vi.mock("@/lib/spokeDispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spokeDispatch")>()),
  dispatchOrderToSpoke: mocks.dispatch,
}));

import { releaseDueSpokeDispatches } from "@/lib/cron";

const NOW = new Date("2026-11-23T14:05:00Z"); // Mon Nov 23, early morning in Vancouver
const midnight = (key: string) => new Date(`${key}T00:00:00.000Z`);
const release = () => releaseDueSpokeDispatches({ nextDayStart: midnight("2026-11-24") });
const sentKeys = () => mocks.dispatch.mock.calls.map(([input]) => input.idempotencyKey);

function waiting(key: string, dateKey = "2026-11-23", fields: Parameters<typeof table.addRow>[0] = {}) {
  return table.addRow({
    idempotencyKey: key,
    status: "SCHEDULED",
    workflowStep: "AWAITING_RELEASE",
    scheduledDate: midnight(dateKey),
    updatedAt: new Date(NOW.getTime() - 12 * 60 * 60 * 1000),
    ...fields,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  table.resetTable();
  mocks.dispatch.mockImplementation(async (input: { idempotencyKey: string }) => ({
    dispatch: table.rows.find((r) => r.idempotencyKey === input.idempotencyKey),
    alreadyDispatched: false,
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("releaseDueSpokeDispatches", () => {
  it("sends each due order with its own key and delivery date", async () => {
    waiting("order-today");
    waiting("order-overdue", "2026-11-22");
    waiting("order-tomorrow", "2026-11-24");

    expect(await release()).toBe(2);

    expect(sentKeys()).toEqual(["order-overdue", "order-today"]);
    expect(mocks.dispatch.mock.calls[0][0]).toMatchObject({
      scheduledDateKey: "2026-11-22",
      scheduledDate: midnight("2026-11-22"),
      store: table.STORE,
      selectedProviderUser: table.ANCHOR,
      patientName: "Riley Chen",
    });
    expect(mocks.dispatch.mock.calls[1][0].scheduledDateKey).toBe("2026-11-23");
  });

  it("skips an order cancelled after the list was read", async () => {
    const cancelled = waiting("order-cancelled");
    waiting("order-kept");
    table.externalDispatch.findMany.mockImplementationOnce(async (args) => {
      const listed = await table.impl.findMany(args);
      table.row(cancelled.id).status = "CANCELLED";
      return listed;
    });

    expect(await release()).toBe(1);
    expect(sentKeys()).toEqual(["order-kept"]);
  });

  it("skips an order another run is sending right now", async () => {
    waiting("order-sending", "2026-11-23", {
      workflowStep: "SENDING",
      updatedAt: new Date(NOW.getTime() - 30 * 1000),
    });

    expect(await release()).toBe(0);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("sends an order whose send was cut short a while ago", async () => {
    waiting("order-stale", "2026-11-23", {
      workflowStep: "SENDING",
      updatedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    });

    expect(await release()).toBe(1);
    expect(sentKeys()).toEqual(["order-stale"]);
  });

  it("counts only orders this run actually sent", async () => {
    waiting("order-1");
    mocks.dispatch.mockResolvedValue({ dispatch: table.rows[0], alreadyDispatched: true });

    expect(await release()).toBe(0);
  });

  it("alerts staff to press Retry when a send fails, and carries on", async () => {
    waiting("order-fails", "2026-11-22", { patientName: "Sam Gill", deliveryAddress: "8120 128 St", deliveryCity: "Delta" });
    waiting("order-ok");
    mocks.dispatch.mockRejectedValueOnce(new Error("Spoke is down"));

    expect(await release()).toBe(1);

    expect(sentKeys()).toEqual(["order-fails", "order-ok"]);
    expect(table.notifications).toHaveLength(1);
    const [alert] = table.notifications;
    expect(alert).toMatchObject({ type: "SPOKE_DISPATCH_FAILED", storeId: table.STORE.id });
    expect(alert.message).toContain("Sam Gill (8120 128 St, Delta)");
    expect(alert.message).toContain("NOT sent to Anchor");
    expect(alert.message).toContain("Open Orders and press Retry");
    expect(alert.message).not.toContain("Generate Today's Orders");
  });
});
