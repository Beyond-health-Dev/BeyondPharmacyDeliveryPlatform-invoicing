"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, CirclePause, X } from "lucide-react";
import RetryAlert from "./RetryAlert";
import { groupWeeklyHolds, holdNote, HOLD_TYPE_LABELS, type WeeklyHoldInstance } from "@/lib/weeklyHolds";
import styles from "@/styles/recurring-calendar.module.css";

const shortDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const NONE: WeeklyHoldInstance[] = [];

// Popovers need Safari 17 or Firefox 125. Older browsers get a plain shown or
// hidden panel instead, kept in React state.
function supportsPopover() {
  return (
    typeof HTMLElement !== "undefined" &&
    "popover" in HTMLElement.prototype &&
    typeof HTMLElement.prototype.hidePopover === "function"
  );
}
const noChanges = () => () => {};

function hidePanel(panel: HTMLElement | null) {
  try {
    if (panel?.matches(":popover-open")) panel.hidePopover();
  } catch {
    // No Popover API after all, so nothing is showing.
  }
}

export default function WeeklyHolds({ instances, weekLabel, busy, error, refresh, covered }: {
  // The shown week's deliveries; null until they have been read.
  instances: WeeklyHoldInstance[] | null;
  weekLabel: string;
  // A read is in flight. The week's last rows stay listed meanwhile.
  busy: boolean;
  // The last read failed; still set while a retry runs.
  error: string;
  refresh: () => void;
  // The quick view is open over the page.
  covered: boolean;
}) {
  const id = useId();
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const patients = useMemo(() => groupWeeklyHolds(instances ?? NONE), [instances]);
  const known = instances !== null;
  const count = patients.length;
  // The server and the first render in the browser assume popovers, so the
  // markup matches; browsers without them then re-render with `open`.
  const native = useSyncExternalStore(noChanges, supportsPopover, () => true);
  const [open, setOpen] = useState(false);

  // Without popovers: as a popover does, hand focus back to the tab if it was
  // in the panel.
  const closeFallback = useCallback(() => {
    if (panelRef.current?.contains(document.activeElement)) tabRef.current?.focus();
    setOpen(false);
  }, []);

  // The panel sits in the top layer, above the quick view, so put it away
  // whenever the quick view opens.
  useEffect(() => {
    if (covered && native) hidePanel(panelRef.current);
  }, [covered, native]);
  if (covered && !native && open) setOpen(false);

  // Clicks elsewhere close the panel by themselves; keyboard focus moving on
  // to the page doesn't, and the panel would cover what has focus. Watched on
  // the document rather than as focus leaves the dock, because focus can
  // leave in two steps: a click on the panel's text focuses a container
  // around the dock, which keeps the panel open, and Tab moves on from there.
  // Focus going nowhere (the window losing focus) keeps it open too.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const dock = dockRef.current;
      const target = event.target;
      if (!dock || !(target instanceof Node) || dock.contains(target) || target.contains(dock)) return;
      if (native) hidePanel(panelRef.current);
      else setOpen(false);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [native]);

  // Without popovers, Escape and clicks elsewhere close the panel here.
  useEffect(() => {
    if (native || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFallback();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [closeFallback, native, open]);

  return (
    <div ref={dockRef} className={styles.holdsDock}>
      <button ref={tabRef} type="button" aria-controls={id} aria-haspopup="dialog"
        popoverTarget={native ? id : undefined}
        aria-expanded={native ? undefined : open}
        onClick={native ? undefined : () => {
          if (open) return setOpen(false);
          setOpen(true);
          refresh();
        }}
        className={styles.holdsTab} data-active={(known && count > 0) || undefined}>
        <CirclePause size={19} strokeWidth={1.8} aria-hidden="true" />
        Weekly holds
        <span className={styles.holdsBadge} aria-live="polite">
          {known ? count : "—"}<span className="sr-only">{known ? (count === 1 ? " patient" : " patients") : " count unavailable"}</span>
        </span>
        <ChevronUp size={15} className={styles.holdsChevron} aria-hidden="true" />
      </button>
      <section ref={panelRef} id={id} role="dialog" aria-labelledby={id + "-title"} className={styles.holdsPanel}
        popover={native ? "auto" : undefined}
        hidden={!native && !open}
        data-open={(!native && open) || undefined}
        onToggle={native ? (event) => { if (event.newState === "open") refresh(); } : undefined}>
        <header className={styles.holdsHeader}>
          <div>
            <h3 id={id + "-title"}>Weekly holds</h3>
            <p>{weekLabel} · All drivers{known && ` · ${count} ${count === 1 ? "patient" : "patients"}`}</p>
          </div>
          <button type="button" aria-label="Close weekly holds" className={styles.holdsClose}
            popoverTarget={native ? id : undefined}
            popoverTargetAction={native ? "hide" : undefined}
            onClick={native ? undefined : closeFallback}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div ref={bodyRef} className={styles.holdsBody} tabIndex={0} aria-label="Patients and hold reasons" role="region" aria-busy={busy}>
          {!known && busy && !error && <p role="status" className={styles.holdsMessage}>Loading holds…</p>}
          {error && (
            <RetryAlert
              message={known ? "Couldn’t update holds. " : "Couldn’t load holds. "}
              retrying={busy}
              onRetry={refresh}
              restoreFocusTo={() => bodyRef.current}
              className={styles.holdsMessage}
            />
          )}
          {known && (count ? (
            <ul className={styles.holdPatients}>
              {patients.map((patient) => (
                <li key={patient.id}>
                  <h4>{patient.name}</h4>
                  {patient.address && <p className={styles.holdsAddress}>{patient.address}</p>}
                  {patient.holds.map((hold) => {
                    const note = holdNote(hold);
                    return (
                      <div className={styles.holdDetail} key={JSON.stringify([hold.type, hold.reason])}>
                        <p>{HOLD_TYPE_LABELS[hold.type]} · {hold.dates.map((date) => shortDate.format(new Date(date + "T00:00:00Z"))).join(" · ")}</p>
                        {note && <p>{note}</p>}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          ) : <p className={styles.holdsMessage}>No patients have deliveries on hold this week.</p>)}
        </div>
      </section>
    </div>
  );
}
