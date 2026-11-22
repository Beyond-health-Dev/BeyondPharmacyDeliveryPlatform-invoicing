"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { ChevronUp, CirclePause, X } from "lucide-react";
import { groupWeeklyHolds, holdNote, HOLD_TYPE_LABELS, type WeeklyHoldInstance } from "@/lib/weeklyHolds";
import styles from "@/styles/recurring-calendar.module.css";

const shortDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const NONE: WeeklyHoldInstance[] = [];

function hidePanel(panel: HTMLElement | null) {
  if (panel?.matches(":popover-open")) panel.hidePopover();
}

export default function WeeklyHolds({ instances, weekLabel, busy, error, refresh, covered }: {
  // The shown week's deliveries; null until they have been read.
  instances: WeeklyHoldInstance[] | null;
  weekLabel: string;
  // A read is in flight. The week's last rows stay listed meanwhile.
  busy: boolean;
  error: string;
  refresh: () => void;
  // The quick view is open over the page.
  covered: boolean;
}) {
  const id = useId();
  const dockRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const patients = useMemo(() => groupWeeklyHolds(instances ?? NONE), [instances]);
  const known = instances !== null;
  const count = patients.length;

  // The panel sits in the top layer, above the quick view, so put it away
  // whenever the quick view opens.
  useEffect(() => {
    if (covered) hidePanel(panelRef.current);
  }, [covered]);

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
      hidePanel(panelRef.current);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <div ref={dockRef} className={styles.holdsDock}>
      <button type="button" popoverTarget={id} aria-controls={id} aria-haspopup="dialog"
        className={styles.holdsTab} data-active={(known && count > 0) || undefined}>
        <CirclePause size={19} strokeWidth={1.8} aria-hidden="true" />
        Weekly holds
        <span className={styles.holdsBadge} aria-live="polite">
          {known ? count : "—"}<span className="sr-only">{known ? (count === 1 ? " patient" : " patients") : " count unavailable"}</span>
        </span>
        <ChevronUp size={15} className={styles.holdsChevron} aria-hidden="true" />
      </button>
      <section ref={panelRef} id={id} popover="auto" role="dialog" aria-labelledby={id + "-title"} className={styles.holdsPanel}
        onToggle={(event) => { if (event.newState === "open") refresh(); }}>
        <header className={styles.holdsHeader}>
          <div>
            <h3 id={id + "-title"}>Weekly holds</h3>
            <p>{weekLabel} · All drivers{known && ` · ${count} ${count === 1 ? "patient" : "patients"}`}</p>
          </div>
          <button type="button" aria-label="Close weekly holds" popoverTarget={id} popoverTargetAction="hide" className={styles.holdsClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.holdsBody} tabIndex={0} aria-label="Patients and hold reasons" role="region" aria-busy={busy}>
          {!known && busy && <p role="status" className={styles.holdsMessage}>Loading holds…</p>}
          {error && (
            <div role="alert" className={styles.holdsMessage}>
              {known ? "Couldn’t update holds. " : "Couldn’t load holds. "}
              <button type="button" onClick={refresh}>Retry</button>
            </div>
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
