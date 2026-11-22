"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useConfirm } from "@/components/ui/DialogsProvider";
import { useToast } from "@/components/ui/ToastProvider";
import { cancelConfirmMessage, isCancellableExternalStatus } from "@/lib/externalDispatchStatus";
import { attentionLinkButton, cn, dangerLinkButton, linkButton } from "@/lib/portalStyles";

interface ExternalDispatchActionsProps {
  dispatchId: string | null;
  currentStatus: string;
  canCancel: boolean;
  storeSlug: string;
  // The row has the blush failed fill.
  onAttentionRow?: boolean;
}

export default function ExternalDispatchActions({
  dispatchId,
  currentStatus,
  canCancel,
  storeSlug,
  onAttentionRow = false,
}: ExternalDispatchActionsProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  // One action at a time: a failed row offers Retry and Cancel together, and
  // the two must never be sent at once.
  const [loading, setLoading] = useState<"retry" | "cancel" | null>(null);
  const inFlight = useRef(false);

  if (currentStatus === "CANCELLED") {
    return (
      <span className="text-xs font-semibold text-ink">
        Cancelled
      </span>
    );
  }

  const showRetry = currentStatus === "DISPATCH_FAILED" && !!dispatchId;
  // canCancel comes from the server (canCancelExternalDispatch); the status
  // check keeps a stale row from offering it.
  const showCancel = canCancel && !!dispatchId && isCancellableExternalStatus(currentStatus);

  if (!showRetry && !showCancel) {
    return (
      <span className="text-xs font-semibold text-ink">
        External handoff
      </span>
    );
  }

  const run = async (action: "retry" | "cancel", send: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(action);
    try {
      await send();
    } finally {
      inFlight.current = false;
      setLoading(null);
    }
  };

  const retryDispatch = async () => {
    if (
      !(await confirm(
        "Retry sending this delivery to Spoke? The original request identity is reused, so this cannot create a duplicate stop."
      ))
    ) {
      return;
    }

    await run("retry", async () => {
      try {
        const res = await fetch(
          `/api/${storeSlug}/external-dispatches/${dispatchId}/retry`,
          { method: "POST" }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          toast.error(data?.error || "Failed to retry Spoke handoff");
          return;
        }

        router.refresh();
      } catch {
        toast.error("Network error — the retry may not have been sent. Refresh and check the handoff status.");
      }
    });
  };

  const cancelDispatch = async () => {
    if (
      !(await confirm({
        message: cancelConfirmMessage(currentStatus),
        // "Cancel" / "OK" would be ambiguous under "Cancel this order?".
        confirmLabel: "Cancel order",
        cancelLabel: "Keep order",
        tone: "danger",
      }))
    ) {
      return;
    }

    await run("cancel", async () => {
      try {
        const res = await fetch(`/api/${storeSlug}/external-dispatches/${dispatchId}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          toast.error(data?.error || "Failed to cancel Spoke handoff");
          return;
        }

        // The route words its message for staff (never sent, removed from
        // Anchor's list, or check Anchor's list).
        toast.success(data?.message || "Cancelled.");
        router.refresh();
      } catch {
        toast.error("Network error — the cancellation may not have been sent. Refresh and check the handoff status.");
      }
    });
  };

  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      {showRetry && (
        <button
          onClick={retryDispatch}
          disabled={loading !== null}
          className={cn(onAttentionRow ? attentionLinkButton : linkButton, "text-xs")}
        >
          {loading === "retry" ? "Retrying..." : "Retry"}
        </button>
      )}
      {showCancel && (
        <button
          onClick={cancelDispatch}
          disabled={loading !== null}
          className={cn(dangerLinkButton, "text-xs")}
        >
          {loading === "cancel" ? "Cancelling..." : "Cancel"}
        </button>
      )}
    </div>
  );
}
