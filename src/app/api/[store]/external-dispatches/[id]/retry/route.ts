import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mayStillBeWithAnchorAfterCancel } from "@/lib/externalDispatchStatus";
import { SpokeDispatchError } from "@/lib/spoke";
import { dispatchOrderToSpoke } from "@/lib/spokeDispatch";
import { resolveStore } from "@/lib/store";

// A retry can spend up to ~50s in Spoke's retry/backoff cycle.
export const maxDuration = 60;

// A cancelled order isn't sent again. If its stop may still be in Anchor's
// list (the cleanup failed, or Anchor took it anyway), say so.
function cancelledMessage(dispatch: { status: string; workflowStep: string | null }) {
  return mayStillBeWithAnchorAfterCancel(dispatch)
    ? "This order was cancelled, but it may still be in Anchor's list. Remove it in Spoke so Anchor doesn't deliver it."
    : "This order was cancelled, so it won't be sent to Anchor.";
}

// Safe resume for a failed Spoke handoff: replays dispatchOrderToSpoke with the
// dispatch's ORIGINAL idempotency key, so anything that actually reached Spoke
// on a previous attempt is deduped instead of duplicated. This is the sanctioned
// recovery path — re-entering the order in the form would mint a new request
// identity (and is now blocked by the duplicate check).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ store: string; id: string }> }
) {
  const { store: storeSlug, id } = await params;
  const store = await resolveStore(storeSlug);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user || session.user.role !== "PHARMACY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.storeId && session.user.storeId !== store.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dispatch = await prisma.externalDispatch.findUnique({
    where: { id },
    include: {
      store: { select: { id: true, slug: true, name: true } },
      selectedProviderUser: { select: { id: true, name: true, email: true } },
    },
  });

  if (!dispatch || dispatch.storeId !== store.id || dispatch.provider !== "SPOKE") {
    return NextResponse.json({ error: "This Anchor order wasn't found. Refresh the page." }, { status: 404 });
  }

  if (dispatch.status === "CANCELLED") {
    return NextResponse.json({ error: cancelledMessage(dispatch) }, { status: 409 });
  }

  if (dispatch.status !== "DISPATCH_FAILED") {
    return NextResponse.json(
      { error: "Only an order that didn't reach Anchor can be sent again. Refresh the page to see where it is." },
      { status: 409 }
    );
  }

  try {
    const result = await dispatchOrderToSpoke({
      idempotencyKey: dispatch.idempotencyKey,
      patientId: dispatch.patientId,
      store: {
        id: dispatch.store.id,
        slug: dispatch.store.slug,
        name: dispatch.store.name,
      },
      selectedProviderUser: dispatch.selectedProviderUser
        ? {
            id: dispatch.selectedProviderUser.id,
            name: dispatch.selectedProviderUser.name ?? "Anchor",
            email: dispatch.selectedProviderUser.email ?? "",
          }
        : null,
      patientName: dispatch.patientName,
      patientPhone: dispatch.patientPhone,
      deliveryAddress: dispatch.deliveryAddress,
      deliveryCity: dispatch.deliveryCity,
      deliveryPostalCode: dispatch.deliveryPostalCode,
      deliveryAddressId: dispatch.deliveryAddressId,
      deliveryZoneId: dispatch.deliveryZoneId,
      deliveryZoneName: dispatch.deliveryZoneName,
      priceAtCreation: dispatch.priceAtCreation,
      instructions: dispatch.instructions,
      scheduledDate: dispatch.scheduledDate,
      scheduledDateKey: dispatch.scheduledDate.toISOString().slice(0, 10),
      createdById: dispatch.createdById,
    });

    // Cancelled while the retry was on its way (the sender takes back any
    // stop it had just created).
    if (result.dispatch.status === "CANCELLED") {
      return NextResponse.json({ error: cancelledMessage(result.dispatch) }, { status: 409 });
    }

    return NextResponse.json({
      message: "Sent to Anchor.",
      dispatch: result.dispatch,
    });
  } catch (err) {
    const spokeError =
      err instanceof SpokeDispatchError
        ? err
        : new SpokeDispatchError("Couldn't send this order to Anchor. Try again in a minute.", 502);

    return NextResponse.json(
      { error: spokeError.message, external: true, provider: "SPOKE" },
      { status: spokeError.statusCode }
    );
  }
}
