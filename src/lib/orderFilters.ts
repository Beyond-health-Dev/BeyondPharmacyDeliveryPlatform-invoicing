// The Orders page status filter (?status=...), as Prisma where clauses for
// both kinds of row. Pure (types only from Prisma), so it can be unit tested.
import type { Prisma } from "@prisma/client";
import {
  FAILED_EXTERNAL_STATUSES,
  UNCONFIRMED_EXTERNAL_STATUSES,
} from "./externalDispatchStatus";

// Filters that only Anchor orders can match.
export const WAITING_FILTER = "WAITING";
export const NOT_CONFIRMED_FILTER = "NOT_CONFIRMED";

// In capitals like the status pills beside them.
export const ANCHOR_ORDER_FILTERS = [
  { key: WAITING_FILTER, label: "WAITING FOR ANCHOR" },
  { key: NOT_CONFIRMED_FILTER, label: "NOT CONFIRMED BY ANCHOR" },
];

function isAnchorOnlyFilter(status: string) {
  return status === WAITING_FILTER || status === NOT_CONFIRMED_FILTER;
}

// In-house orders: the status itself. An unknown value matches nothing, as
// it always has; the Anchor-only filters match nothing too.
export function orderStatusWhere(status: string | undefined): Prisma.OrderWhereInput {
  if (!status) return {};
  if (isAnchorOnlyFilter(status)) return { id: { in: [] } };
  return { status };
}

// Anchor orders. `todayStart` is UTC midnight of Vancouver's today, which is
// how scheduledDate is stored.
export function externalStatusWhere(
  status: string | undefined,
  todayStart: Date
): Prisma.ExternalDispatchWhereInput {
  // Failed handoffs must stay visible in the default view — hiding them
  // makes the delivery look "never entered" and invites a duplicate
  // re-entry. Recovery is the row's Retry action.
  if (!status) return {};
  if (status === "FAILED") return { status: { in: FAILED_EXTERNAL_STATUSES } };
  if (status === WAITING_FILTER) return { status: "SCHEDULED" };
  // Delivery day over with no delivered, failed or cancelled result.
  if (status === NOT_CONFIRMED_FILTER) {
    return {
      status: { in: UNCONFIRMED_EXTERNAL_STATUSES },
      scheduledDate: { lt: todayStart },
    };
  }
  return { status };
}
