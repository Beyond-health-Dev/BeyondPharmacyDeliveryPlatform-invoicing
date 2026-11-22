import { describe, expect, it } from "vitest";
import {
  ANCHOR_ORDER_FILTERS,
  externalStatusWhere,
  NOT_CONFIRMED_FILTER,
  orderStatusWhere,
  WAITING_FILTER,
} from "@/lib/orderFilters";
import { UNCONFIRMED_EXTERNAL_STATUSES } from "@/lib/externalDispatchStatus";

// UTC midnight of Vancouver's today, as scheduledDate is stored.
const todayStart = new Date("2026-11-22T00:00:00.000Z");

describe("Orders page Anchor filters", () => {
  it("labels the pills in plain words, in capitals like the status pills", () => {
    expect(ANCHOR_ORDER_FILTERS).toEqual([
      { key: "WAITING", label: "WAITING FOR ANCHOR" },
      { key: "NOT_CONFIRMED", label: "NOT CONFIRMED BY ANCHOR" },
    ]);
  });

  it("Waiting lists Anchor orders held for their 6 AM run", () => {
    expect(externalStatusWhere(WAITING_FILTER, todayStart)).toEqual({ status: "SCHEDULED" });
  });

  it("Not confirmed lists past Anchor orders with no final result", () => {
    // Today's orders are still under way, so the bound is strictly before today.
    expect(externalStatusWhere(NOT_CONFIRMED_FILTER, todayStart)).toEqual({
      status: { in: UNCONFIRMED_EXTERNAL_STATUSES },
      scheduledDate: { lt: todayStart },
    });
  });

  it("never matches an in-house order", () => {
    expect(orderStatusWhere(WAITING_FILTER)).toEqual({ id: { in: [] } });
    expect(orderStatusWhere(NOT_CONFIRMED_FILTER)).toEqual({ id: { in: [] } });
  });
});

describe("Orders page status filters (unchanged)", () => {
  it("filters both kinds of row by the status itself", () => {
    expect(orderStatusWhere("PENDING")).toEqual({ status: "PENDING" });
    expect(externalStatusWhere("SUBMITTED", todayStart)).toEqual({ status: "SUBMITTED" });
    expect(externalStatusWhere("DELIVERY_FAILED", todayStart)).toEqual({ status: "DELIVERY_FAILED" });
  });

  it("FAILED also lists Anchor's failed deliveries and failed sends", () => {
    expect(orderStatusWhere("FAILED")).toEqual({ status: "FAILED" });
    expect(externalStatusWhere("FAILED", todayStart)).toEqual({
      status: { in: ["DELIVERY_FAILED", "DISPATCH_FAILED"] },
    });
  });

  it("no filter lists everything, failed Anchor sends included", () => {
    expect(orderStatusWhere(undefined)).toEqual({});
    expect(externalStatusWhere(undefined, todayStart)).toEqual({});
    expect(externalStatusWhere("", todayStart)).toEqual({});
  });

  it("an unknown value matches nothing, as before", () => {
    expect(orderStatusWhere("BOGUS")).toEqual({ status: "BOGUS" });
    expect(externalStatusWhere("BOGUS", todayStart)).toEqual({ status: "BOGUS" });
    expect(externalStatusWhere("waiting", todayStart)).toEqual({ status: "waiting" });
  });
});
