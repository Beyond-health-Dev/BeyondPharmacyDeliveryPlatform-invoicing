"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A failed read's message and its Retry button. The parent keeps it up while
 * the retry runs, so the button that started it keeps keyboard focus; if the
 * retry succeeds and the alert goes away, focus moves to `restoreFocusTo`
 * instead of dropping to the page body.
 */
export default function RetryAlert({
  message,
  retrying,
  onRetry,
  announce = true,
  restoreFocusTo,
  className,
  buttonClassName,
}: {
  message: ReactNode;
  // A read is in flight after the failure; the message is still the last one.
  retrying: boolean;
  onRetry: () => void;
  // False while another alert on screen says the same thing.
  announce?: boolean;
  restoreFocusTo: () => HTMLElement | null | undefined;
  className?: string;
  buttonClassName?: string;
}) {
  // Each failed attempt gets a new alert, so a retry that fails again is
  // announced again. The button sits outside it, so starting a retry isn't.
  const [attempt, setAttempt] = useState(0);
  const [wasRetrying, setWasRetrying] = useState(retrying);
  if (wasRetrying !== retrying) {
    setWasRetrying(retrying);
    if (!retrying) setAttempt(attempt + 1);
  }

  // This alert's own Retry is in flight. A retry that ends while the alert is
  // still up has failed, so forget the press: only an alert whose own retry
  // just succeeded may move focus when it goes away.
  const pressed = useRef(false);
  useEffect(() => {
    if (!retrying) pressed.current = false;
  }, [retrying]);
  const restore = useRef(restoreFocusTo);
  useEffect(() => {
    restore.current = restoreFocusTo;
  });
  // Runs once the alert has gone, when focus has already left the button.
  useEffect(() => () => {
    const active = document.activeElement;
    if (pressed.current && (!active || active === document.body)) restore.current()?.focus();
  }, []);

  return (
    <div className={className}>
      <span key={attempt} role={announce ? "alert" : undefined}>{message}</span>
      <button
        type="button"
        onClick={() => {
          if (retrying) return;
          pressed.current = true;
          onRetry();
        }}
        // Not `disabled`, which would drop focus to the page body.
        aria-disabled={retrying}
        className={buttonClassName}
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
