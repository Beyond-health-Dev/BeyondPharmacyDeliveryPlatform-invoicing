"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/portalStyles";

// Open modals, innermost last — Escape and the focus trap act on the top one.
const openModals: string[] = [];
// Each open modal's dialog element, so a closing modal can hand focus back to
// the one under it.
const modalPanels = new Map<string, HTMLElement>();
let savedBodyOverflow = "";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
} as const;

// Pull the sheet down at least this far (px) to close it.
const DRAG_CLOSE_PX = 90;

/**
 * The one dialog shell: a centred card from 640px up, a bottom sheet with a
 * drag handle below that. Closes on Escape and on the backdrop unless
 * `dismissible` is false (e.g. while a request is in flight).
 */
export default function Modal({
  open,
  onClose,
  dismissible = true,
  size = "sm",
  labelledBy,
  describedBy,
  ariaLabel,
  initialFocusRef,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  dismissible?: boolean;
  size?: keyof typeof SIZES;
  labelledBy?: string;
  describedBy?: string;
  ariaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openModals.length === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModals.push(id);
    if (panelRef.current) modalPanels.set(id, panelRef.current);
    (initialFocusRef?.current ?? panelRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== id) return;

      if (event.key === "Escape") {
        if (dismissibleRef.current) {
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key === "Tab" && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = openModals.indexOf(id);
      if (index !== -1) openModals.splice(index, 1);
      modalPanels.delete(id);
      if (openModals.length === 0) document.body.style.overflow = savedBodyOverflow;
      // Opened from a modal with nothing focused (a click on its backdrop
      // moves focus to the page body): go back into that modal, not the page
      // behind it, so Tab stays trapped there.
      const below = modalPanels.get(openModals[openModals.length - 1]);
      const nowhere =
        !previouslyFocused || previouslyFocused === document.body || !previouslyFocused.isConnected;
      if (nowhere && below?.isConnected) below.focus();
      else if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
    // initialFocusRef is read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  if (!open || typeof document === "undefined") return null;

  const endDrag = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY > DRAG_CLOSE_PX && dismissibleRef.current) onCloseRef.current();
    setDragY(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-backdrop"
        aria-hidden="true"
        onClick={() => {
          if (dismissibleRef.current) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={cn(
          "modal-panel relative flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-card border border-hairline bg-white pb-[env(safe-area-inset-bottom)] text-navy shadow-lift outline-none sm:rounded-card sm:pb-0",
          SIZES[size],
          className
        )}
      >
        <div
          className="flex shrink-0 cursor-grab justify-center pb-1 pt-3 touch-none sm:hidden"
          aria-hidden="true"
          onPointerDown={(event) => {
            dragStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStart.current !== null) setDragY(Math.max(0, event.clientY - dragStart.current));
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="h-1.5 w-10 rounded-full bg-ghost" />
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
