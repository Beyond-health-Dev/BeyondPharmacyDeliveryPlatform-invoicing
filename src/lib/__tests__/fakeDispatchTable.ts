import { Prisma, type ExternalDispatch } from "@prisma/client";
import { vi } from "vitest";

// An in-memory ExternalDispatch table (plus the notifications written beside
// it) for the Anchor send/cancel tests. Load it from a vi.mock("@/lib/db")
// factory with a dynamic import so the test file shares the same rows:
//
//   vi.mock("@/lib/db", async () => (await import("@/lib/__tests__/fakeDispatchTable")).dbModule);
//
// Filters it doesn't understand throw, so a test can't pass because a guard
// was silently ignored.

export const STORE = { id: "store_surrey", slug: "surrey", name: "Beyond Pharmacy Surrey" };
export const OTHER_STORE = { id: "store_langley", slug: "langley", name: "Beyond Pharmacy Langley" };
export const ANCHOR = { id: "anchor_1", name: "Anchor", email: "dispatch@anchor.example" };

const stores = new Map([STORE, OTHER_STORE].map((store) => [store.id, store]));
const users = new Map([[ANCHOR.id, ANCHOR]]);

export const rows: ExternalDispatch[] = [];
export const notifications: Array<{ type: string; message: string; storeId: string; orderId?: string | null }> = [];

const FILTER_KEYS = new Set([
  "id",
  "idempotencyKey",
  "provider",
  "status",
  "spokeStopId",
  "workflowStep",
  "storeId",
  "scheduledDate",
  "OR",
]);

function matchesValue(value: unknown, filter: unknown, key: string): boolean {
  if (filter === null || typeof filter !== "object" || filter instanceof Date) {
    if (filter instanceof Date) return value instanceof Date && value.getTime() === filter.getTime();
    return value === filter;
  }
  const operators = filter as Record<string, unknown>;
  return Object.entries(operators).every(([op, operand]) => {
    if (op === "in" && Array.isArray(operand)) return operand.includes(value);
    if (op === "lt" && operand instanceof Date && value instanceof Date) return value < operand;
    // As in SQL, `not` and `notIn` never match a NULL column.
    if (op === "not" && typeof operand === "string") return value !== null && value !== operand;
    if (op === "notIn" && Array.isArray(operand)) return value !== null && !operand.includes(value);
    throw new Error(`The fake dispatch table can't filter ${key} with ${op}`);
  });
}

function checkFilter(where: Record<string, unknown>) {
  for (const [key, filter] of Object.entries(where)) {
    if (!FILTER_KEYS.has(key)) throw new Error(`The fake dispatch table can't filter on ${key}`);
    if (key === "OR") (filter as Array<Record<string, unknown>>).forEach(checkFilter);
  }
}

function matches(row: ExternalDispatch, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (key === "OR") {
      return (filter as Array<Record<string, unknown>>).some((branch) => matches(row, branch));
    }
    return matchesValue(row[key as keyof ExternalDispatch], filter, key);
  });
}

function filterRows(where: Record<string, unknown>) {
  checkFilter(where);
  return rows.filter((row) => matches(row, where));
}

function uniqueError(target: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: "P2002",
    clientVersion: "test",
    meta: { target: [target] },
  });
}

function stored(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value === Prisma.JsonNull ? null : value])
  );
}

function shape(row: ExternalDispatch, args: { select?: Record<string, boolean>; include?: Record<string, unknown> }) {
  if (args.select) {
    return Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key as keyof ExternalDispatch]]));
  }
  const copy: Record<string, unknown> = { ...row };
  if (args.include?.store) copy.store = stores.get(row.storeId) ?? null;
  if (args.include?.selectedProviderUser) {
    copy.selectedProviderUser = row.selectedProviderUserId ? users.get(row.selectedProviderUserId) ?? null : null;
  }
  return copy;
}

function findOne(where: Record<string, unknown>) {
  return filterRows(where)[0] ?? null;
}

// The plain implementations, so a test can wrap one to change the row between
// two of the code's own statements.
export const impl = {
  findUnique: async (args: { where: Record<string, unknown>; select?: Record<string, boolean>; include?: Record<string, unknown> }) => {
    const row = findOne(args.where);
    return row ? shape(row, args) : null;
  },
  findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
    const row = findOne(args.where);
    if (!row) throw new Error("No ExternalDispatch found");
    return { ...row };
  },
  findFirst: async (args: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
    const row = findOne(args.where);
    return row ? shape(row, args) : null;
  },
  findMany: async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) =>
    filterRows(args.where)
      .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
      .map((row) => shape(row, args)),
  create: async ({ data }: { data: Record<string, unknown> }) => {
    if (rows.some((row) => row.idempotencyKey === data.idempotencyKey)) throw uniqueError("idempotencyKey");
    return { ...addRow(stored(data) as Partial<ExternalDispatch>) };
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const hits = filterRows(where);
    if (
      hits.length > 0 &&
      typeof data.spokeStopId === "string" &&
      rows.some((row) => row.spokeStopId === data.spokeStopId && !hits.includes(row))
    ) {
      throw uniqueError("spokeStopId");
    }
    for (const row of hits) Object.assign(row, stored(data), { updatedAt: new Date() });
    return { count: hits.length };
  },
};

export const externalDispatch = {
  findUnique: vi.fn(impl.findUnique),
  findUniqueOrThrow: vi.fn(impl.findUniqueOrThrow),
  findFirst: vi.fn(impl.findFirst),
  findMany: vi.fn(impl.findMany),
  create: vi.fn(impl.create),
  updateMany: vi.fn(impl.updateMany),
};

export const notification = {
  create: vi.fn(async ({ data }: { data: (typeof notifications)[number] }) => {
    notifications.push(data);
    return { id: `n${notifications.length}`, ...data };
  }),
};

const client = { externalDispatch, notification };

export const dbModule = {
  prisma: {
    ...client,
    $transaction: (run: (tx: typeof client) => unknown) => run(client),
  },
};

let nextId = 1;

export function addRow(fields: Partial<ExternalDispatch> = {}): ExternalDispatch {
  const id = fields.id ?? `d${nextId++}`;
  const row: ExternalDispatch = {
    id,
    idempotencyKey: `key-${id}`,
    provider: "SPOKE",
    status: "PENDING",
    externalReference: null,
    workflowStep: null,
    externalPlanId: null,
    spokePlanId: null,
    spokeStopId: null,
    spokeDriverId: null,
    spokeOperationId: null,
    selectedProviderUserId: ANCHOR.id,
    patientId: null,
    patientName: "Riley Chen",
    patientPhone: "604-555-0101",
    deliveryAddress: "7380 120 St",
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 3M8",
    deliveryAddressId: null,
    deliveryZoneId: "zone_1",
    deliveryZoneName: "Surrey North",
    priceAtCreation: 8,
    instructions: null,
    scheduledDate: new Date("2026-11-23T00:00:00.000Z"),
    requestPayload: {},
    responsePayload: null,
    webhookPayload: null,
    lastWebhookEventType: null,
    trackingLink: null,
    deliveredAt: null,
    failedAt: null,
    errorMessage: null,
    storeId: STORE.id,
    createdById: "admin_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  };
  rows.push(row);
  return row;
}

export function row(id: string) {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`No row ${id}`);
  return found;
}

export function resetTable() {
  rows.length = 0;
  notifications.length = 0;
  nextId = 1;
  // Back to the plain implementations, dropping any a test set.
  for (const fn of [...Object.values(externalDispatch), notification.create]) fn.mockReset();
}

// The writes the code made, for "no write" checks.
export function writeCount() {
  return externalDispatch.create.mock.calls.length + externalDispatch.updateMany.mock.calls.length;
}
