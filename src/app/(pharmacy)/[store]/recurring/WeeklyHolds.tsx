"use client";

import { useId, useMemo } from "react";
import { ChevronUp, CirclePause, X } from "lucide-react";
import { groupWeeklyHolds, type WeeklyHoldInstance } from "@/lib/weeklyHolds";
import styles from "@/styles/recurring-calendar.module.css";

const shortDate = new Intl.DateTimeFormat("en-CA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const holdLabels = { INSTANCE: "One-day hold", WEEK: "Week skipped", TEMPLATE: "Vacation hold" };

export default function WeeklyHolds({ instances, weekLabel, loading, error, refresh }: {
  instances: WeeklyHoldInstance[];
  weekLabel: string;
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  const id = useId();
  const patients = useMemo(() => groupWeeklyHolds(instances), [instances]);
  const ready = !loading && !error;
  const count = patients.length;
  return (
    <div className={styles.holdsDock}>
      <button type="button" popoverTarget={id} aria-controls={id} aria-haspopup="dialog"
        className={styles.holdsTab} data-active={(ready && count > 0) || undefined}>
        <CirclePause size={19} strokeWidth={1.8} aria-hidden="true" />
        Weekly holds
        <span className={styles.holdsBadge} aria-live="polite">
          {ready ? count : "—"}<span className="sr-only">{ready ? (count === 1 ? " patient" : " patients") : " count unavailable"}</span>
        </span>
        <ChevronUp size={15} className={styles.holdsChevron} aria-hidden="true" />
      </button>
      <section id={id} popover="auto" role="dialog" aria-labelledby={id + "-title"} className={styles.holdsPanel}
        onToggle={(event) => { if (event.newState === "open") refresh(); }}>
        <header className={styles.holdsHeader}>
          <div>
            <h3 id={id + "-title"}>Weekly holds</h3>
            <p>{weekLabel} · All drivers{ready && ` · ${count} ${count === 1 ? "patient" : "patients"}`}</p>
          </div>
          <button type="button" aria-label="Close weekly holds" popoverTarget={id} popoverTargetAction="hide" className={styles.holdsClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.holdsBody} tabIndex={0} aria-label="Patients and hold reasons" role="region" aria-busy={loading}>
          {loading && <p role="status" className={styles.holdsMessage}>Loading holds…</p>}
          {error && <div role="alert" className={styles.holdsMessage}>Couldn’t load holds. <button type="button" onClick={refresh}>Retry</button></div>}
          {ready && (count ? (
            <ul className={styles.holdPatients}>
              {patients.map((patient) => (
                <li key={patient.id}>
                  <h4>{patient.name}</h4>
                  {patient.address && <p className={styles.holdsAddress}>{patient.address}</p>}
                  {patient.holds.map((hold) => (
                    <div className={styles.holdDetail} key={JSON.stringify([hold.type, hold.reason])}>
                      <p>{holdLabels[hold.type]} · {hold.dates.map((date) => shortDate.format(new Date(date + "T00:00:00Z"))).join(" · ")}</p>
                      {(hold.reason || hold.type !== "TEMPLATE") && <p>{hold.reason ?? "No reason recorded"}</p>}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : <p className={styles.holdsMessage}>No patients have deliveries on hold this week.</p>)}
        </div>
      </section>
    </div>
  );
}
