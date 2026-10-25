// Fixture data for the dev-only style guide (src/app/dev). Every name and
// address here is invented — nothing comes from the database. Dates are
// relative to the real Vancouver day, so the server render and the browser
// (whose clock the screenshot script pins to that same day) always agree.
import type { ComponentProps } from "react";
import type { DashboardDelivery } from "@/app/(pharmacy)/[store]/dashboard/DashboardView";
import type { SerializedOrder } from "@/app/(pharmacy)/[store]/orders/OrdersView";
import type RecurringOrderList from "@/app/(pharmacy)/[store]/recurring/RecurringOrderList";
import type ReminderList from "@/app/(pharmacy)/[store]/reminders/ReminderList";
import type InvoiceList from "@/app/(pharmacy)/[store]/invoices/InvoiceList";
import type ZoneList from "@/app/(pharmacy)/[store]/pricing/ZoneList";
import type UserTable from "@/app/(pharmacy)/[store]/users/UserTable";
import type DeliveryList from "@/app/(driver)/[store]/deliveries/DeliveryList";
import type { DeliveryDetailOrder } from "@/app/(driver)/[store]/deliver/[id]/DeliveryDetailView";
import type { EarningsDelivery } from "@/app/(driver)/[store]/earnings/EarningsView";
import type { ZoneHistory } from "@/lib/zoneSuggestion";
import { vancouverTodayKey, vancouverWeekStartKey } from "@/lib/vancouverDate";

// Links and API calls inside fixture screens use this slug; the dev fetch
// stub answers every /api/<slug>/... call.
export const DEV_SLUG = "dev";
// The header shows a real store so it renders exactly as production does
// (one "Switch to" link); its section links point at /dev via navBasePath.
export const DEV_STORE = { slug: "surrey", name: "Beyond Pharmacy Surrey" };
export const TODAY = vancouverTodayKey();

// TODAY shifted by whole days, as a YYYY-MM-DD key.
export function day(offset: number) {
  const d = new Date(`${TODAY}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const YESTERDAY = day(-1);

export const zones = [
  { id: "z_surrey", name: "Surrey", price: 4.25, defaultDriverId: null, isActive: true },
  { id: "z_langley", name: "Langley", price: 4.25, defaultDriverId: null, isActive: true },
  { id: "z_whiterock", name: "White Rock", price: 4.25, defaultDriverId: null, isActive: true },
  { id: "z_coquitlam", name: "Coquitlam", price: 5.25, defaultDriverId: null, isActive: true },
  { id: "z_richmond", name: "Richmond", price: 5.0, defaultDriverId: null, isActive: true },
  { id: "z_vancouver", name: "Vancouver", price: 5.5, defaultDriverId: null, isActive: false },
];
export const activeZones = zones.filter((z) => z.isActive);

export const drivers = [
  { id: "d_derek", name: "Derek Olsen", isExternal: false },
  { id: "d_anchor", name: "Anchor", isExternal: true },
  { id: "d_priya", name: "Priya Bains", isExternal: false },
];

export const zoneHistory: ZoneHistory = {
  surrey: [{ zoneId: "z_surrey", count: 412, lastUsed: `${YESTERDAY}T00:00:00.000Z` }],
  delta: [{ zoneId: "z_surrey", count: 38, lastUsed: `${day(-6)}T00:00:00.000Z` }],
  langley: [{ zoneId: "z_langley", count: 120, lastUsed: `${day(-5)}T00:00:00.000Z` }],
};

function at(time: string) {
  return new Date(`${TODAY}T${time}:00.000Z`);
}

export const dashboardDeliveries: DashboardDelivery[] = [
  { id: "o1", patientName: "Avery Sandhu", deliveryAddress: "14250 88 Ave", deliveryCity: "Surrey", driverName: "Derek Olsen", status: "ASSIGNED", priceAtCreation: 4.25, failedReason: null, createdAt: at("17:10"), isExternal: false, externalDispatchId: null, canCancelExternal: false },
  { id: "external-x1", patientName: "Jordan Kaur", deliveryAddress: "6620 King George Blvd", deliveryCity: "Surrey", driverName: "Anchor", status: "SUBMITTED", priceAtCreation: 4.25, failedReason: null, createdAt: at("16:55"), isExternal: true, externalDispatchId: "x1", canCancelExternal: true },
  { id: "o2", patientName: "Riley Chen", deliveryAddress: "20150 Fraser Hwy", deliveryCity: "Langley", driverName: "Derek Olsen", status: "PICKED_UP", priceAtCreation: 4.25, failedReason: null, createdAt: at("16:20"), isExternal: false, externalDispatchId: null, canCancelExternal: false },
  { id: "o3", patientName: "Morgan Patel", deliveryAddress: "15433 16 Ave", deliveryCity: "White Rock", driverName: "Derek Olsen", status: "FAILED", priceAtCreation: 4.25, failedReason: "No one home — left a card", createdAt: at("15:45"), isExternal: false, externalDispatchId: null, canCancelExternal: false },
  { id: "external-x2", patientName: "Sam Gill", deliveryAddress: "7380 120 St", deliveryCity: "Delta", driverName: "Anchor", status: "DISPATCH_FAILED", priceAtCreation: 4.25, failedReason: "Spoke did not respond", createdAt: at("15:30"), isExternal: true, externalDispatchId: "x2", canCancelExternal: false },
  { id: "o4", patientName: "Taylor Dhillon", deliveryAddress: "10153 King George Blvd", deliveryCity: "Surrey", driverName: "Priya Bains", status: "DELIVERED", priceAtCreation: 4.25, failedReason: null, createdAt: at("15:05"), isExternal: false, externalDispatchId: null, canCancelExternal: false },
  { id: "o5", patientName: "Casey Brar", deliveryAddress: "3000 Lougheed Hwy", deliveryCity: "Coquitlam", driverName: null, status: "PENDING", priceAtCreation: 5.25, failedReason: null, createdAt: at("14:40"), isExternal: false, externalDispatchId: null, canCancelExternal: false },
];

function order(o: Partial<SerializedOrder> & Pick<SerializedOrder, "id" | "patientName" | "status" | "scheduledDate">): SerializedOrder {
  return {
    deliveryAddress: "14250 88 Ave",
    deliveryCity: "Surrey",
    deliveryZoneName: "Surrey",
    priceAtCreation: 4.25,
    assignedDriverId: "d_derek",
    assignedDriverName: "Derek Olsen",
    cancelledAt: null,
    createdAt: `${o.scheduledDate.slice(0, 10)}T15:00:00.000Z`,
    isExternal: false,
    externalProvider: null,
    externalDispatchId: null,
    canCancelExternal: false,
    ...o,
  };
}

export const groupedOrders: Record<string, SerializedOrder[]> = {
  [TODAY]: [
    order({ id: "o1", patientName: "Avery Sandhu", status: "ASSIGNED", scheduledDate: `${TODAY}T00:00:00.000Z` }),
    order({ id: "external-x1", patientName: "Jordan Kaur", status: "SUBMITTED", scheduledDate: `${TODAY}T00:00:00.000Z`, deliveryAddress: "6620 King George Blvd", assignedDriverId: null, assignedDriverName: "Anchor", isExternal: true, externalProvider: "Spoke", externalDispatchId: "x1", canCancelExternal: true }),
    order({ id: "o3", patientName: "Morgan Patel", status: "FAILED", scheduledDate: `${TODAY}T00:00:00.000Z`, deliveryAddress: "15433 16 Ave", deliveryCity: "White Rock", deliveryZoneName: "White Rock" }),
  ],
  [YESTERDAY]: [
    order({ id: "o6", patientName: "Jamie Thompson", status: "DELIVERED", scheduledDate: `${YESTERDAY}T00:00:00.000Z`, deliveryAddress: "20150 Fraser Hwy", deliveryCity: "Langley", deliveryZoneName: "Langley" }),
    order({ id: "o7", patientName: "Drew Sidhu", status: "DELIVERED", scheduledDate: `${YESTERDAY}T00:00:00.000Z`, assignedDriverId: "d_priya", assignedDriverName: "Priya Bains" }),
  ],
};
export const sortedDateKeys = Object.keys(groupedOrders).sort((a, b) => b.localeCompare(a));
export const orderCount = Object.values(groupedOrders).flat().length;

type RecurringItem = ComponentProps<typeof RecurringOrderList>["orders"][number];
function profile(p: Partial<RecurringItem> & Pick<RecurringItem, "id" | "patientName">): RecurringItem {
  return {
    deliveryAddress: "14250 88 Ave",
    deliveryCity: "Surrey",
    deliveryZoneId: "z_surrey",
    zoneName: "Surrey",
    zonePrice: 4.25,
    activeDays: [1, 3, 5],
    recurrenceIntervalWeeks: 1,
    recurrenceAnchorDate: "2026-09-06T00:00:00.000Z",
    isActive: true,
    isOnHold: false,
    holdStart: null,
    holdEnd: null,
    isSkippedThisWeek: false,
    heldDaysThisWeek: 0,
    holdUpcoming: false,
    assignedDriverId: "d_derek",
    assignedDriverName: "Derek Olsen",
    ...p,
  };
}
export const recurringOrders: RecurringItem[] = [
  profile({ id: "r1", patientName: "Avery Sandhu" }),
  profile({ id: "r2", patientName: "Jordan Kaur", deliveryAddress: "6620 King George Blvd", assignedDriverId: "d_anchor", assignedDriverName: "Anchor", activeDays: [2, 4] }),
  profile({ id: "r3", patientName: "Riley Chen", deliveryAddress: "20150 Fraser Hwy", deliveryCity: "Langley", deliveryZoneId: "z_langley", zoneName: "Langley", recurrenceIntervalWeeks: 2 }),
  profile({ id: "r4", patientName: "Morgan Patel", deliveryAddress: "15433 16 Ave", deliveryCity: "White Rock", deliveryZoneId: "z_whiterock", zoneName: "White Rock", isOnHold: true, holdStart: "2026-10-05T00:00:00.000Z", holdEnd: "2026-10-19T00:00:00.000Z" }),
  profile({ id: "r5", patientName: "Casey Brar", deliveryAddress: "3000 Lougheed Hwy", deliveryCity: "Coquitlam", deliveryZoneId: "z_coquitlam", zoneName: "Coquitlam", zonePrice: 5.25, assignedDriverId: null, assignedDriverName: null, isSkippedThisWeek: true }),
  // Once-a-week profiles, for the per-weekday label sheets.
  profile({ id: "r6", patientName: "Sam Gill", deliveryAddress: "7380 120 St", deliveryCity: "Delta", activeDays: [1], heldDaysThisWeek: 1 }),
  profile({ id: "r7", patientName: "Taylor Dhillon", deliveryAddress: "10153 King George Blvd", activeDays: [2], isOnHold: true, holdUpcoming: true, holdStart: `${day(9)}T00:00:00.000Z`, holdEnd: `${day(16)}T00:00:00.000Z` }),
  profile({ id: "r8", patientName: "Drew Sidhu", deliveryAddress: "9045 160 St", activeDays: [4], recurrenceIntervalWeeks: 2 }),
  profile({ id: "r9", patientName: "Jamie Thompson", deliveryAddress: "5501 204 St", deliveryCity: "Langley", deliveryZoneId: "z_langley", zoneName: "Langley", activeDays: [5] }),
];

export const reminderProfiles = recurringOrders.map((r) => ({
  id: r.id,
  patientName: r.patientName,
  deliveryAddress: r.deliveryAddress,
  deliveryCity: r.deliveryCity,
}));

export const reminders: ComponentProps<typeof ReminderList>["reminders"] = [
  { id: "m1", note: "Fridge item — Ozempic", patientName: "Avery Sandhu", remindOn: YESTERDAY, repeatIntervalWeeks: 4, completedAt: null, isOverdue: true },
  { id: "m2", note: "Pull insulin from the fridge before packing", patientName: "Riley Chen", remindOn: TODAY, repeatIntervalWeeks: null, completedAt: null, isOverdue: false },
  { id: "m3", note: "Call to confirm new address", patientName: "Jordan Kaur", remindOn: day(2), repeatIntervalWeeks: null, completedAt: null, isOverdue: false },
  { id: "m4", note: "Fridge item — Humira", patientName: "Taylor Dhillon", remindOn: day(-6), repeatIntervalWeeks: 2, completedAt: `${day(-6)}T18:12:00.000Z`, isOverdue: false },
];

export const invoices: ComponentProps<typeof InvoiceList>["invoices"] = [
  { id: "i1", invoiceNumber: "INV-2026-0042", periodStart: "2026-09-21T00:00:00.000Z", periodEnd: "2026-10-04T00:00:00.000Z", totalAmount: 612.0, status: "FINALIZED", lineItemCount: 144, createdAt: "2026-10-05T16:00:00.000Z", generatedBy: "Pharmacy Admin", driverName: "Derek Olsen" },
  { id: "i2", invoiceNumber: "INV-2026-0041", periodStart: "2026-09-07T00:00:00.000Z", periodEnd: "2026-09-20T00:00:00.000Z", totalAmount: 588.5, status: "DRAFT", lineItemCount: 137, createdAt: "2026-09-21T16:00:00.000Z", generatedBy: "Pharmacy Admin", driverName: null },
];

export const pricingZones: ComponentProps<typeof ZoneList>["zones"] = zones.map((z) => ({
  id: z.id,
  name: z.name,
  price: z.price,
  isActive: z.isActive,
  defaultDriverId: z.id === "z_langley" ? "d_derek" : null,
}));

export const users: ComponentProps<typeof UserTable>["users"] = [
  { id: "u1", name: "Pharmacy Admin", email: "admin@example.com", role: "PHARMACY_ADMIN", isActive: true, store: { name: DEV_STORE.name } },
  { id: "d_derek", name: "Derek Olsen", email: "derek@example.com", role: "DRIVER", isActive: true, store: { name: DEV_STORE.name } },
  { id: "d_anchor", name: "Anchor", email: "anchor@example.com", role: "DRIVER", isActive: true, store: { name: DEV_STORE.name } },
  { id: "d_old", name: "Former Driver", email: "former@example.com", role: "DRIVER", isActive: false, store: null },
];

export const driverDeliveries: ComponentProps<typeof DeliveryList>["deliveries"] = [
  { id: "o3", patientName: "Morgan Patel", deliveryAddress: "15433 16 Ave", deliveryCity: "White Rock", deliveryPostalCode: "V4A 1P5", instructions: "Side door", status: "FAILED", failedReason: "No one home — left a card", attemptCount: 1, scheduledDate: `${YESTERDAY}T00:00:00.000Z`, completedAt: null },
  { id: "o1", patientName: "Avery Sandhu", deliveryAddress: "14250 88 Ave", deliveryCity: "Surrey", deliveryPostalCode: "V3W 3L5", instructions: "Ring twice", status: "ASSIGNED", failedReason: null, attemptCount: 1, scheduledDate: `${TODAY}T00:00:00.000Z`, completedAt: null },
  { id: "o2", patientName: "Riley Chen", deliveryAddress: "20150 Fraser Hwy", deliveryCity: "Langley", deliveryPostalCode: "V3A 4E6", instructions: null, status: "PICKED_UP", failedReason: null, attemptCount: 1, scheduledDate: `${TODAY}T00:00:00.000Z`, completedAt: null },
  { id: "o4", patientName: "Taylor Dhillon", deliveryAddress: "10153 King George Blvd", deliveryCity: "Surrey", deliveryPostalCode: "V3T 2W1", instructions: null, status: "DELIVERED", failedReason: null, attemptCount: 1, scheduledDate: `${TODAY}T00:00:00.000Z`, completedAt: `${TODAY}T18:40:00.000Z` },
];

export const deliveryDetail: DeliveryDetailOrder = {
  id: "o1",
  status: "PICKED_UP",
  patientName: "Avery Sandhu",
  deliveryAddress: "14250 88 Ave",
  deliveryCity: "Surrey",
  deliveryPostalCode: "V3W 3L5",
  instructions: "Ring twice — fridge item in the blue bag",
  failedReason: null,
  attemptCount: 1,
};

export const earnings: EarningsDelivery[] = [
  { id: "o4", patientName: "Taylor Dhillon", deliveryZoneName: "Surrey", priceAtCreation: 4.25, scheduledDate: `${TODAY}T12:00:00.000Z` },
  { id: "o6", patientName: "Jamie Thompson", deliveryZoneName: "Langley", priceAtCreation: 4.25, scheduledDate: `${YESTERDAY}T12:00:00.000Z` },
  { id: "o8", patientName: "Alex Grewal", deliveryZoneName: "Coquitlam", priceAtCreation: 5.25, scheduledDate: `${day(-2)}T12:00:00.000Z` },
];

export const stores = [
  { id: "s1", slug: "abbotsford", name: "Beyond Pharmacy Abbotsford" },
  { id: "s2", slug: "surrey", name: "Beyond Pharmacy Surrey" },
];

// ---- data answered by the fetch stub (components that load on mount) ----

export const notifications = [
  { id: "n1", orderId: "o3", type: "DELIVERY_FAILED", message: "Delivery failed for Morgan Patel — No one home — left a card", isRead: false, createdAt: `${TODAY}T21:45:00.000Z` },
  { id: "n2", orderId: null, type: "SPOKE_DISPATCH_FAILED", message: "Spoke dispatch failed for Sam Gill (7380 120 St, Delta) — today's delivery was NOT sent to Spoke.", isRead: false, createdAt: `${TODAY}T21:30:00.000Z` },
  { id: "n3", orderId: "o2", type: "ORDER_PICKED_UP", message: "Riley Chen's order was picked up by Derek Olsen", isRead: true, createdAt: `${TODAY}T20:20:00.000Z` },
  { id: "n4", orderId: null, type: "GENERATION_INCOMPLETE", message: "Recurring generation stopped at the time limit — 3 profile(s) remaining.", isRead: true, createdAt: `${TODAY}T13:01:00.000Z` },
];

export const dueReminders = {
  dateKey: TODAY,
  outstanding: 2,
  items: [
    { id: "m1", note: "Fridge item — Ozempic", patientName: "Avery Sandhu", remindOn: YESTERDAY, repeatIntervalWeeks: 4, isOverdue: true },
    { id: "m2", note: "Pull insulin from the fridge before packing", patientName: "Riley Chen", remindOn: TODAY, repeatIntervalWeeks: null, isOverdue: false },
  ],
};

export const patients = [
  { id: "p1", name: "Avery Sandhu", phone: "604-555-0101", address: "14250 88 Ave", city: "Surrey", postalCode: "V3W 3L5" },
  { id: "p2", name: "Jordan Kaur", phone: "604-555-0102", address: "6620 King George Blvd", city: "Surrey", postalCode: "V3W 4Z1" },
  { id: "p3", name: "Riley Chen", phone: "604-555-0103", address: "20150 Fraser Hwy", city: "Langley", postalCode: "V3A 4E6" },
];

export const savedAddresses: Record<string, Array<{ id: string; label: string; address: string; city: string; postalCode: string; isDefault: boolean }>> = {
  p1: [
    { id: "a1", label: "Primary", address: "14250 88 Ave", city: "Surrey", postalCode: "V3W 3L5", isDefault: true },
    { id: "a2", label: "Merged", address: "9045 160 St", city: "Surrey", postalCode: "V4N 2X7", isDefault: false },
  ],
  p2: [{ id: "a3", label: "Primary", address: "6620 King George Blvd", city: "Surrey", postalCode: "V3W 4Z1", isDefault: true }],
  p3: [{ id: "a4", label: "Primary", address: "20150 Fraser Hwy", city: "Langley", postalCode: "V3A 4E6", isDefault: true }],
};

const calendarPeople = [
  { recurringOrderId: "r1", patientName: "Avery Sandhu", deliveryAddress: "14250 88 Ave", deliveryCity: "Surrey", zoneName: "Surrey", assignedDriverName: "Derek Olsen", assignedDriverId: "d_derek", days: [1, 3, 5] },
  { recurringOrderId: "r2", patientName: "Jordan Kaur", deliveryAddress: "6620 King George Blvd", deliveryCity: "Surrey", zoneName: "Surrey", assignedDriverName: "Anchor", assignedDriverId: "d_anchor", days: [2, 4] },
  { recurringOrderId: "r3", patientName: "Riley Chen", deliveryAddress: "20150 Fraser Hwy", deliveryCity: "Langley", zoneName: "Langley", assignedDriverName: "Derek Olsen", assignedDriverId: "d_derek", days: [1, 4] },
  { recurringOrderId: "r4", patientName: "Morgan Patel", deliveryAddress: "15433 16 Ave", deliveryCity: "White Rock", zoneName: "White Rock", assignedDriverName: "Priya Bains", assignedDriverId: "d_priya", days: [3], held: true },
  // Skip This Week from the list (r5 is "Skipped this week" there too).
  { recurringOrderId: "r5", patientName: "Casey Brar", deliveryAddress: "3000 Lougheed Hwy", deliveryCity: "Coquitlam", zoneName: "Coquitlam", assignedDriverName: null, assignedDriverId: null, days: [2, 5], weekSkipped: true },
];

// The calendar asks for whichever week it is showing, so instances are built
// for the requested range — the guide is never empty, whatever the date.
export function calendarInstances(start: string, end: string) {
  const out = [];
  const first = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const sunday = new Date(d);
    sunday.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const sundayKey = sunday.toISOString().slice(0, 10);
    for (const p of calendarPeople) {
      if (!p.days.includes(d.getUTCDay())) continue;
      // The week skip only covers the current week.
      const weekSkipped = !!p.weekSkipped && sundayKey === vancouverWeekStartKey();
      out.push({
        id: `${p.recurringOrderId}:${key}`,
        recurringOrderId: p.recurringOrderId,
        date: key,
        patientName: p.patientName,
        deliveryAddress: p.deliveryAddress,
        deliveryCity: p.deliveryCity,
        zoneName: p.zoneName,
        assignedDriverName: p.assignedDriverName,
        assignedDriverId: p.assignedDriverId,
        isHeld: !!p.held || weekSkipped,
        holdType: p.held ? ("TEMPLATE" as const) : weekSkipped ? ("WEEK" as const) : null,
        skipDate: weekSkipped ? sundayKey : null,
        holdReason: p.held ? "Away until Oct 19" : weekSkipped ? "Patient picked up in-store" : null,
        generatedOrderStatus: null,
      });
    }
  }
  return out;
}
