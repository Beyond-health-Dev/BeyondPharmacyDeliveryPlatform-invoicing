import { NextRequest, NextResponse } from "next/server";
import { requireStoreAdmin } from "@/lib/storeAccess";
import { resolveStore } from "@/lib/store";
import { formatGenerationMessage, generateRecurringOrders } from "@/lib/cron";

// Same time budget as the cron route: the generation loop's Spoke dispatches
// (with 429 retry/backoff) must not be killed mid-run by the platform default.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ store: string }> }
) {
  const { store: storeSlug } = await params;
  const access = await requireStoreAdmin(await resolveStore(storeSlug));
  if (access.error) return access.error;

  const result = await generateRecurringOrders(new Date(), {
    // Shorter budget: an admin is waiting on this response, and the returned
    // message guides a follow-up click. Auto-continuation is the cron's job.
    timeBudgetMs: 50_000,
    // Stalled-dispatch alerts only fire on the first 6 AM cron leg — repeated
    // manual clicks must not duplicate them.
    runStallWatchdog: false,
  });

  return NextResponse.json({
    ...result,
    message: formatGenerationMessage(result),
  });
}
