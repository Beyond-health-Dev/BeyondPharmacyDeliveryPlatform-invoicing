import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveStore } from "@/lib/store";
import { requireStoreAdmin } from "@/lib/storeAccess";
import {
  recurringDuplicateSelect,
  visibleRecurringProfiles,
} from "@/lib/recurringDuplicateGuard";
import {
  LABEL_SHEETS,
  labelSheetChoice,
  parseLabelSheets,
  type LabelSheetAssignment,
} from "@/lib/recurringLabels";

// The panel saves every change in one request; a store has about 90 profiles.
const MAX_ASSIGNMENTS = 500;

function readAssignments(body: unknown): { assignments: LabelSheetAssignment[] } | { error: string } {
  const list = (body as { assignments?: unknown } | null)?.assignments;
  if (!Array.isArray(list)) {
    return { error: "assignments must be a list of { id, sheets }" };
  }
  if (list.length === 0) return { error: "assignments is empty: there is nothing to save" };
  if (list.length > MAX_ASSIGNMENTS) {
    return { error: `Save at most ${MAX_ASSIGNMENTS} people at a time` };
  }

  const seen = new Set<string>();
  const assignments: LabelSheetAssignment[] = [];
  for (const entry of list) {
    const { id, sheets } = (entry ?? {}) as { id?: unknown; sheets?: unknown };
    if (typeof id !== "string") return { error: "Each assignment needs a profile id" };
    if (seen.has(id)) return { error: `Profile ${id} is listed more than once` };
    seen.add(id);

    if (sheets === null) {
      assignments.push({ id, sheets: null });
      continue;
    }
    const parsed = Array.isArray(sheets) ? parseLabelSheets(sheets) : null;
    if (!parsed) {
      return {
        error: `sheets must be null (automatic) or a list of at least one of: ${LABEL_SHEETS.join(", ")}`,
      };
    }
    assignments.push({ id, sheets: parsed });
  }
  return { assignments };
}

/**
 * PUT { assignments: [{ id, sheets }] } — which delivery label sheets each
 * recurring profile prints on: a list of sheets, or null for automatic (the
 * sheet its delivery days give). Only the label choice is written; delivery
 * days never change. Replies { updated, missing }: missing counts profiles
 * that aren't this store's active ones (removed, deactivated, or hidden as a
 * duplicate since the page loaded) or have no readable delivery days.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const access = await requireStoreAdmin(await resolveStore(storeSlug));
  if (access.error) return access.error;
  const { store } = access;

  const body = await req.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json({ error: "The request body must be JSON" }, { status: 400 });
  }
  const request = readAssignments(body);
  if ("error" in request) {
    return NextResponse.json({ error: request.error }, { status: 400 });
  }

  // The same profiles, and days, as the Recurring page and the label PDFs.
  const recurringOrders = await prisma.recurringOrder.findMany({
    where: { storeId: store.id, isActive: true },
    select: { ...recurringDuplicateSelect, labelSheets: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const visibleDays = new Map(
    visibleRecurringProfiles(recurringOrders).map(({ order, activeDays }) => [order.id, activeDays])
  );

  // One write per stored value: null (automatic) or the JSON text.
  const idsByValue = new Map<string | null, string[]>();
  for (const { id, sheets } of request.assignments) {
    const activeDays = visibleDays.get(id);
    // Not shown on the page, or no readable delivery days (so on no sheet).
    if (!activeDays?.length) continue;
    // Just the sheet the days give anyway: store automatic.
    const choice = labelSheetChoice(sheets, activeDays);
    const value = choice ? JSON.stringify(choice) : null;
    idsByValue.set(value, [...(idsByValue.get(value) ?? []), id]);
  }

  let updated = 0;
  if (idsByValue.size > 0) {
    try {
      const results = await prisma.$transaction(
        [...idsByValue].map(([labelSheets, ids]) =>
          prisma.recurringOrder.updateMany({
            // Still active: one deactivated since the read counts as missing.
            where: { storeId: store.id, id: { in: ids }, isActive: true },
            data: { labelSheets },
          })
        )
      );
      updated = results.reduce((sum, result) => sum + result.count, 0);
    } catch (err) {
      // All or nothing: the transaction has written none of the changes.
      console.error("[Recurring labels] Saving label sheets failed:", err);
      return NextResponse.json(
        { error: "Couldn't save the label changes. Nothing was changed. Please try again." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ updated, missing: request.assignments.length - updated });
}
