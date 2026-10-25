import { describe, expect, it } from "vitest";
import {
  buildRecurringDuplicateCleanupPlan,
  findRecurringDuplicate,
  formatRecurringDuplicateMessage,
  parseRecurringActiveDays,
  recurringPeopleMatch,
  visibleRecurringProfiles,
  type RecurringDuplicateRecord,
} from "@/lib/recurringDuplicateGuard";

const person = {
  patientId: null,
  patientName: "Kimbelee Home",
  patientPhone: "604-555-0100",
  deliveryAddress: "123 Main St",
  deliveryCity: "Delta",
  deliveryPostalCode: "V4C 1A1",
};

describe("recurringPeopleMatch", () => {
  it("matches the same person with reordered name tokens and different casing", () => {
    expect(recurringPeopleMatch(person, { ...person, patientName: "home KIMBELEE" })).toBe(true);
  });

  it("does not match a different person at a different address", () => {
    expect(
      recurringPeopleMatch(person, {
        ...person,
        patientName: "Someone Else",
        patientPhone: "604-555-9999",
        deliveryAddress: "999 Other Rd",
        deliveryPostalCode: "V9Z 9Z9",
      })
    ).toBe(false);
  });
});

describe("parseRecurringActiveDays", () => {
  it("accepts valid day arrays", () => {
    expect(parseRecurringActiveDays([1, 3, 5])).toEqual([1, 3, 5]);
  });

  it("rejects empty, malformed, and out-of-range input", () => {
    expect(parseRecurringActiveDays([])).toBeNull();
    expect(parseRecurringActiveDays("not-days")).toBeNull();
    expect(parseRecurringActiveDays([9])).toBeNull();
  });
});

// After duplicate patient records are merged, ONE patient can carry a profile at
// an old address and one at a new address. These pin the post-merge review
// finding: same patient record + different address must be two deliveries.
describe("recurringPeopleMatch with a shared patient record", () => {
  const atOld = {
    patientId: "p1",
    patientName: "Kaur, Simran",
    patientPhone: "604-555-0100",
    deliveryAddress: "7355 144 A St",
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 1J3",
  };
  const atNew = {
    ...atOld,
    deliveryAddress: "16069 56 Avenue",
    deliveryPostalCode: "V3S 2J7",
  };

  it("is the same delivery when the same patient's profiles go to the same place", () => {
    expect(
      recurringPeopleMatch(atOld, {
        ...atOld,
        deliveryAddress: "7355 144A Street",
        deliveryPostalCode: "v3w1j3",
      })
    ).toBe(true);
  });

  it("is NOT the same delivery when the same patient's profiles go to different places", () => {
    expect(recurringPeopleMatch(atOld, atNew)).toBe(false);
  });

  it("tolerates one mistyped field at the same street", () => {
    expect(recurringPeopleMatch(atOld, { ...atOld, deliveryPostalCode: "V3W 1J8" })).toBe(true);
  });

  it("replays the cron's in-batch skip: the current-address profile is generated", () => {
    // cron.ts processes due profiles oldest first and skips any profile that
    // matches one already seen. The old-address profile is older.
    const processedInOrder = [atOld, atNew];
    const seen: (typeof atOld)[] = [];
    const generated: string[] = [];
    for (const profile of processedInOrder) {
      if (seen.some((s) => recurringPeopleMatch(s, profile))) continue;
      seen.push(profile);
      generated.push(profile.deliveryAddress);
    }
    expect(generated).toEqual(["7355 144 A St", "16069 56 Avenue"]);
  });
});

function record(overrides: Partial<RecurringDuplicateRecord>): RecurringDuplicateRecord {
  return {
    id: "r",
    storeId: "s1",
    patientId: "p1",
    patientName: "Simran Kaur",
    patientPhone: null,
    deliveryAddress: "7355 144A Street",
    deliveryCity: "Surrey",
    deliveryPostalCode: "V3W 1J3",
    activeDays: "[1,3]",
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("findRecurringDuplicate (create/edit guard)", () => {
  const client = (rows: RecurringDuplicateRecord[]) => ({
    recurringOrder: { findMany: async () => rows } as never,
  });
  const oldProfile = record({ id: "r_old" });

  it("still blocks a second profile for the same patient on overlapping days at a NEW address", async () => {
    const match = await findRecurringDuplicate(client([oldProfile]), {
      storeId: "s1",
      patientId: "p1",
      patientName: "Simran Kaur",
      patientPhone: null,
      deliveryAddress: "16069 56 Avenue",
      deliveryCity: "Surrey",
      deliveryPostalCode: "V3S 2J7",
      activeDays: [1],
    });
    expect(match?.recurringOrder.id).toBe("r_old");
    expect(match?.overlappingDays).toEqual([1]);
  });

  it("names the existing profile's address so staff can find and deactivate it", () => {
    const message = formatRecurringDuplicateMessage(
      { patientName: "Simran Kaur" },
      { recurringOrder: oldProfile, overlappingDays: [1] }
    );
    expect(message).toContain("7355 144A Street, Surrey");
    expect(message).toContain("deactivate that profile");
  });

  it("does not block when the days don't overlap", async () => {
    const match = await findRecurringDuplicate(client([oldProfile]), {
      storeId: "s1",
      patientId: "p1",
      patientName: "Simran Kaur",
      patientPhone: null,
      deliveryAddress: "16069 56 Avenue",
      deliveryCity: "Surrey",
      deliveryPostalCode: "V3S 2J7",
      activeDays: [5],
    });
    expect(match).toBeNull();
  });
});

describe("buildRecurringDuplicateCleanupPlan after a merge", () => {
  it("never prunes the current-address profile in favour of the old one", () => {
    const oldProfile = record({ id: "r_old", createdAt: new Date("2025-01-01T00:00:00Z") });
    const newProfile = record({
      id: "r_new",
      deliveryAddress: "16069 56 Avenue",
      deliveryPostalCode: "V3S 2J7",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(buildRecurringDuplicateCleanupPlan([oldProfile, newProfile])).toEqual([]);
  });

  it("still collapses a true duplicate at the same address", () => {
    const first = record({ id: "r1" });
    const copy = record({ id: "r2", createdAt: new Date("2026-02-01T00:00:00Z") });
    const plan = buildRecurringDuplicateCleanupPlan([first, copy]);
    expect(plan).toHaveLength(1);
    expect(plan[0].order.id).toBe("r2");
    expect(plan[0].remainingDays).toEqual([]);
  });
});

describe("visibleRecurringProfiles (Recurring page and label sheets)", () => {
  const record = (
    id: string,
    activeDays: string,
    createdAt: string,
    overrides: Partial<RecurringDuplicateRecord> = {}
  ): RecurringDuplicateRecord => ({
    ...person,
    id,
    storeId: "store_1",
    activeDays,
    createdAt: new Date(createdAt),
    ...overrides,
  });

  it("hides a profile whose every day repeats an older one for the same person", () => {
    const visible = visibleRecurringProfiles([
      record("older", "[1,3]", "2026-01-01T00:00:00Z"),
      record("copy", "[1,3]", "2026-02-01T00:00:00Z"),
    ]);
    expect(visible.map((v) => v.order.id)).toEqual(["older"]);
  });

  it("keeps only the newer profile's own days when it partly overlaps", () => {
    const visible = visibleRecurringProfiles([
      record("p2", "[3,5]", "2026-02-01T00:00:00Z"),
      record("p1", "[1,3]", "2026-01-01T00:00:00Z"),
    ]);
    // Input order kept; p2 loses Wednesday to the older p1.
    expect(visible).toEqual([
      { order: expect.objectContaining({ id: "p2" }), activeDays: [5] },
      { order: expect.objectContaining({ id: "p1" }), activeDays: [1, 3] },
    ]);
  });

  it("leaves different people alone and gives unreadable days an empty list", () => {
    const visible = visibleRecurringProfiles([
      record("a", "[2]", "2026-01-01T00:00:00Z"),
      record("b", "[2]", "2026-01-02T00:00:00Z", { patientName: "Someone Else", deliveryAddress: "9 Other Rd" }),
      record("c", "not json", "2026-01-03T00:00:00Z", { patientName: "Third Person", deliveryAddress: "1 Third Ave" }),
    ]);
    expect(visible.map((v) => [v.order.id, v.activeDays])).toEqual([
      ["a", [2]],
      ["b", [2]],
      ["c", []],
    ]);
  });
});
