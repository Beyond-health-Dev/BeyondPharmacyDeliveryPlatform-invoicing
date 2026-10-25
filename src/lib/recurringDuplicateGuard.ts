import type { Prisma } from "@prisma/client";

export const RECURRING_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface RecurringPersonInput {
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryPostalCode: string;
}

export interface RecurringDuplicateInput extends RecurringPersonInput {
  storeId: string;
  activeDays: number[];
}

export interface RecurringDuplicateRecord extends RecurringPersonInput {
  id: string;
  storeId: string;
  activeDays: string;
  createdAt: Date;
}

export interface RecurringDuplicateMatch {
  recurringOrder: RecurringDuplicateRecord;
  overlappingDays: number[];
}

export interface RecurringDuplicateCleanupChange {
  order: RecurringDuplicateRecord;
  duplicateDays: number[];
  remainingDays: number[];
  keptBy: Array<{
    day: number;
    recurringOrderId: string;
    patientId: string | null;
    patientName: string;
    deliveryAddress: string;
    deliveryCity: string;
    deliveryPostalCode: string;
  }>;
}

type RecurringDuplicateClient = {
  recurringOrder: Pick<Prisma.TransactionClient["recurringOrder"], "findMany">;
};

export const recurringDuplicateSelect = {
  id: true,
  storeId: true,
  patientId: true,
  patientName: true,
  patientPhone: true,
  deliveryAddress: true,
  deliveryCity: true,
  deliveryPostalCode: true,
  activeDays: true,
  createdAt: true,
} satisfies Prisma.RecurringOrderSelect;

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  const tokens = normalized.split(" ").filter(Boolean);
  return [...tokens].sort().join(" ");
}

const ADDRESS_TOKEN_REPLACEMENTS: Record<string, string> = {
  st: "street",
  str: "street",
  street: "street",
  ave: "avenue",
  av: "avenue",
  avenue: "avenue",
  rd: "road",
  road: "road",
  dr: "drive",
  drive: "drive",
  blvd: "boulevard",
  boulevard: "boulevard",
  ln: "lane",
  lane: "lane",
  ct: "court",
  court: "court",
  pl: "place",
  place: "place",
  cres: "crescent",
  cr: "crescent",
  crescent: "crescent",
  hwy: "highway",
  highway: "highway",
  terr: "terrace",
  terrace: "terrace",
  cir: "circle",
  circle: "circle",
};

export function normalizeAddress(value: string | null | undefined) {
  const normalized = normalizeText(value).replace(
    /\b(\d+)\s+([a-z])\b/g,
    "$1$2"
  );
  if (!normalized) return "";

  return normalized
    .split(" ")
    .map((token) => ADDRESS_TOKEN_REPLACEMENTS[token] ?? token)
    .join(" ");
}

export function normalizePhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function normalizePostalCode(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/\s+/g, "").trim();
}

function normalizePersonFallback(input: RecurringPersonInput) {
  return {
    name: normalizeName(input.patientName),
    phone: normalizePhone(input.patientPhone),
    address: normalizeAddress(input.deliveryAddress),
    city: normalizeText(input.deliveryCity),
    postalCode: normalizePostalCode(input.deliveryPostalCode),
  };
}

export interface DeliveryAddressFields {
  address: string;
  city: string;
  postalCode: string;
}

/**
 * Same delivery address. The street must match ("144 A St" = "144A Street");
 * then the postal code OR the city is enough, so one mistyped field doesn't
 * split a single address in two.
 */
export function sameDeliveryAddress(a: DeliveryAddressFields, b: DeliveryAddressFields) {
  const street = normalizeAddress(a.address);
  if (!street || street !== normalizeAddress(b.address)) return false;

  const postal = normalizePostalCode(a.postalCode);
  if (postal && postal === normalizePostalCode(b.postalCode)) return true;

  const city = normalizeText(a.city);
  return city !== "" && city === normalizeText(b.city);
}

// Both profiles are linked to the same patient record, wherever they deliver.
export function sameLinkedPatient(first: RecurringPersonInput, second: RecurringPersonInput) {
  return !!first.patientId && !!second.patientId && first.patientId === second.patientId;
}

export function parseRecurringActiveDays(value: unknown) {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(parsed)) return null;

  const days = parsed.filter(
    (day): day is number =>
      typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6
  );

  if (days.length !== parsed.length || days.length === 0) return null;
  return [...new Set(days)].sort((a, b) => a - b);
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function recurringPeopleMatch(
  first: RecurringPersonInput,
  second: RecurringPersonInput
) {
  // One patient record can legitimately have profiles at two addresses — and
  // after duplicate records are merged, one patient can carry a profile at an
  // old address and one at a new address. Those are two deliveries, not one:
  // treating them as duplicates made the cron generate the older (old-address)
  // profile and silently skip the current one.
  if (sameLinkedPatient(first, second)) {
    return sameDeliveryAddress(
      {
        address: first.deliveryAddress,
        city: first.deliveryCity,
        postalCode: first.deliveryPostalCode,
      },
      {
        address: second.deliveryAddress,
        city: second.deliveryCity,
        postalCode: second.deliveryPostalCode,
      }
    );
  }

  const a = normalizePersonFallback(first);
  const b = normalizePersonFallback(second);
  if (!a.name || !a.address || !a.city || !a.postalCode) return false;
  if (a.name !== b.name) return false;
  if (a.address !== b.address || a.city !== b.city || a.postalCode !== b.postalCode) {
    return false;
  }

  return !a.phone || !b.phone || a.phone === b.phone;
}

export function overlappingRecurringDays(first: number[], second: number[]) {
  const secondSet = new Set(second);
  return first.filter((day) => secondSet.has(day));
}

export function formatRecurringDayList(days: number[]) {
  return days.map((day) => RECURRING_DAY_NAMES[day] ?? `Day ${day}`).join(", ");
}

export function formatRecurringDuplicateMessage(
  input: Pick<RecurringDuplicateInput, "patientName">,
  match: RecurringDuplicateMatch
) {
  const days = formatRecurringDayList(match.overlappingDays);
  const existing = match.recurringOrder;
  return `${input.patientName} already has an active recurring profile on ${days} at ${existing.deliveryAddress}, ${existing.deliveryCity}. If they've moved, deactivate that profile first.`;
}

export async function findRecurringDuplicate(
  client: RecurringDuplicateClient,
  input: RecurringDuplicateInput,
  options: { excludeId?: string } = {}
): Promise<RecurringDuplicateMatch | null> {
  const activeDays = parseRecurringActiveDays(input.activeDays);
  if (!activeDays) return null;

  const recurringOrders = (await client.recurringOrder.findMany({
    where: {
      storeId: input.storeId,
      isActive: true,
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
    },
    select: recurringDuplicateSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })) as RecurringDuplicateRecord[];

  for (const recurringOrder of recurringOrders) {
    // Deliberately broader than recurringPeopleMatch: the same patient record
    // on overlapping days is flagged at ANY address. When a patient moves,
    // this is what stops a new-address profile being added while the old one
    // is still delivering.
    if (
      !sameLinkedPatient(input, recurringOrder) &&
      !recurringPeopleMatch(input, recurringOrder)
    ) {
      continue;
    }

    const existingDays = parseRecurringActiveDays(recurringOrder.activeDays);
    if (!existingDays) continue;

    const overlappingDays = overlappingRecurringDays(activeDays, existingDays);
    if (overlappingDays.length > 0) {
      return { recurringOrder, overlappingDays };
    }
  }

  return null;
}

export function buildRecurringDuplicateCleanupPlan(
  recurringOrders: RecurringDuplicateRecord[]
) {
  const sorted = [...recurringOrders].sort((a, b) => {
    const storeCompare = a.storeId.localeCompare(b.storeId);
    if (storeCompare !== 0) return storeCompare;
    const createdCompare = a.createdAt.getTime() - b.createdAt.getTime();
    return createdCompare !== 0 ? createdCompare : a.id.localeCompare(b.id);
  });

  const claimsByStoreDay = new Map<string, RecurringDuplicateRecord[]>();
  const changes = new Map<string, RecurringDuplicateCleanupChange>();

  for (const order of sorted) {
    const activeDays = parseRecurringActiveDays(order.activeDays);
    if (!activeDays) continue;

    for (const day of activeDays) {
      const claimKey = `${order.storeId}:${day}`;
      const claims = claimsByStoreDay.get(claimKey) ?? [];
      const keeper = claims.find((claim) => recurringPeopleMatch(claim, order));

      if (!keeper) {
        claims.push(order);
        claimsByStoreDay.set(claimKey, claims);
        continue;
      }

      const change =
        changes.get(order.id) ??
        ({
          order,
          duplicateDays: [],
          remainingDays: activeDays,
          keptBy: [],
        } satisfies RecurringDuplicateCleanupChange);

      if (!change.duplicateDays.includes(day)) {
        change.duplicateDays.push(day);
        change.remainingDays = activeDays.filter(
          (activeDay) => !change.duplicateDays.includes(activeDay)
        );
        change.keptBy.push({
          day,
          recurringOrderId: keeper.id,
          patientId: keeper.patientId,
          patientName: keeper.patientName,
          deliveryAddress: keeper.deliveryAddress,
          deliveryCity: keeper.deliveryCity,
          deliveryPostalCode: keeper.deliveryPostalCode,
        });
      }

      changes.set(order.id, change);
    }
  }

  return [...changes.values()].map((change) => ({
    ...change,
    duplicateDays: [...change.duplicateDays].sort((a, b) => a - b),
    remainingDays: [...change.remainingDays].sort((a, b) => a - b),
  }));
}

/**
 * The recurring profiles a store actually runs, as the Recurring page shows
 * them: a profile whose every day duplicates an older profile for the same
 * person is hidden, and a partly duplicated one keeps only its own days.
 * Input order is kept. The page and the delivery label sheets both use this,
 * so the label counts on the page always match the printed sheets.
 */
export function visibleRecurringProfiles<T extends RecurringDuplicateRecord>(
  recurringOrders: readonly T[]
): Array<{ order: T; activeDays: number[] }> {
  const remainingDaysById = new Map(
    buildRecurringDuplicateCleanupPlan([...recurringOrders]).map((change) => [
      change.order.id,
      change.remainingDays,
    ])
  );

  return recurringOrders.flatMap((order) => {
    const remainingDays = remainingDaysById.get(order.id);
    if (remainingDays) {
      return remainingDays.length > 0 ? [{ order, activeDays: remainingDays }] : [];
    }
    return [{ order, activeDays: parseRecurringActiveDays(order.activeDays) ?? [] }];
  });
}
