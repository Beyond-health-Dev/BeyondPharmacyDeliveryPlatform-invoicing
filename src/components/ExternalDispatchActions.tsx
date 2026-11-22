"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/ui/DialogsProvider";
import { useToast } from "@/components/ui/ToastProvider";
import { cancelConfirmMessage, externalDispatchActions } from "@/lib/externalDispatchStatus";
import { cn, dangerLinkButton, linkButton, tintedLinkButton } from "@/lib/portalStyles";

interface ExternalDispatchActionsProps {
  dispatchId: string | null;
  currentStatus: string;
  canCancel: boolean;
  storeSlug: string;
  // Names the buttons for screen readers ("Retry order for Riley Chen").
  patientName: string;
  // The row has the blush failed fill.
  onAttentionRow?: boolean;
  // Shown when the row offers no action: what an in-house row shows there.
  noAction?: ReactNode;
}

export default function ExternalDispatchActions({
  dispatchId,
  currentStatus,
  canCancel,
  storeSlug,
  patientName,
  onAttentionRow = false,
  noAction = null,
}: ExternalDispatchActionsProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  // One action at a time: a failed row offers Retry and Cancel together, and
  // the two must never be sent at once.
  const [loading, setLoading] = useState<"retry" | "cancel" | null>(null);
  const inFlight = useRef(false);
  // Rendered whatever the row shows, so focus has somewhere to stay when the
  // pressed button goes away once the page refreshes.
  const wrapperRef = useRef<HTMLDivElement>(null);

  const actions = externalDispatchActions({ dispatchId, status: currentStatus, canCancel });

  // `send` resolves true when the action went through.
  const run = async (action: "retry" | "cancel", send: () => Promise<boolean>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(action);
    let done = false;
    try {
      done = await send();
    } finally {
      inFlight.current = false;
      setLoading(null);
    }
    const wrapper = wrapperRef.current;
    if (done && wrapper?.contains(document.activeElement)) wrapper.focus();
  };

  const retryDispatch = async () => {
    // The buttons stay focusable while a request runs (aria-disabled).
    if (inFlight.current) return;
    if (
      !(await confirm({
        message: "Send this order to Anchor again?",
        confirmLabel: "Send again",
        cancelLabel: "Don't send",
      }))
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
          toast.error(data?.error || "Couldn't send this order to Anchor. Try again in a minute.");
          return false;
        }

        router.refresh();
        return true;
      } catch {
        toast.error("Network error. The order may or may not have reached Anchor. Refresh the page to see where it is.");
        return false;
      }
    });
  };

  const cancelDispatch = async () => {
    if (inFlight.current) return;
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
          toast.error(data?.error || "Couldn't cancel this order. Try again in a minute.");
          return false;
        }

        // The route words its message for staff (never sent, removed from
        // Anchor's list, or check Anchor's list). One that asks staff to
        // check Anchor's list stays up until dismissed.
        const message = data?.message || "Cancelled.";
        if (data?.needsCheck) {
          toast.error(message);
        } else {
          toast.success(message);
        }
        router.refresh();
        return true;
      } catch {
        toast.error("Network error. The cancel may not have gone through. Refresh the page to see where the order is.");
        return false;
      }
    });
  };

  let content: ReactNode = noAction;
  if (currentStatus === "CANCELLED") {
    content = <span className="text-xs font-semibold text-ink">Cancelled</span>;
  } else if (actions.retry || actions.cancel) {
    content = (
      <>
        {actions.retry && (
          <button
            type="button"
            onClick={retryDispatch}
            aria-disabled={loading !== null}
            aria-label={`${loading === "retry" ? "Retrying" : "Retry"} order for ${patientName}`}
            className={cn(onAttentionRow ? tintedLinkButton : linkButton, "text-xs")}
          >
            {loading === "retry" ? "Retrying..." : "Retry"}
          </button>
        )}
        {actions.cancel && (
          <button
            type="button"
            onClick={cancelDispatch}
            aria-disabled={loading !== null}
            aria-label={`${loading === "cancel" ? "Cancelling" : "Cancel"} order for ${patientName}`}
            className={cn(dangerLinkButton, "text-xs")}
          >
            {loading === "cancel" ? "Cancelling..." : "Cancel"}
          </button>
        )}
      </>
    );
  }

  return (
    <div ref={wrapperRef} tabIndex={-1} className="flex items-center gap-3 whitespace-nowrap outline-none">
      {content}
    </div>
  );
}
