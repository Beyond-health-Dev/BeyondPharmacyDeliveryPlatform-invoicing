"use client";

import { useState } from "react";
import PharmacyShell from "@/components/PharmacyShell";
import ConfirmModal from "@/components/ConfirmModal";
import { DriverSelect } from "@/components/DriverSelect";
import Circles from "@/components/ui/Circles";
import PageHeader from "@/components/ui/PageHeader";
import { useConfirm, usePromptDateRange } from "@/components/ui/DialogsProvider";
import { useToast } from "@/components/ui/ToastProvider";
import PharmacyLoading from "@/app/(pharmacy)/[store]/loading";
import PharmacyError from "@/app/(pharmacy)/[store]/error";
import {
  button,
  card,
  cardInteractive,
  cn,
  ctaShadow,
  dangerButton,
  dangerLinkButton,
  emptyState,
  eyebrow,
  input,
  inputReadOnly,
  label,
  linkButton,
  mutedText,
  pageTitle,
  panel,
  primaryButton,
  primaryButtonFull,
  secondaryButton,
  sectionTitle,
  selectablePill,
  selectableRow,
  softButton,
  statusBadgeClasses,
  tableHeader,
  tableRow,
  textLink,
  totalPill,
} from "@/lib/portalStyles";
import { BANNER_CLASSES, MARKER_CLASSES, TONE_CLASSES, type Tone } from "@/lib/statusTheme";
import DevFrame from "../_DevFrame";
import { DEV_STORE, drivers } from "../_fixtures";

const STATUSES = [
  "PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED",
  "SUBMITTED", "PLAN_CREATED", "STOP_CREATED", "ALLOCATED", "DEPARTED",
  "TRACKING_LINK_ADDED", "DELIVERY_FAILED", "DISPATCH_FAILED", "WEBHOOK_RECEIVED",
  "CANCELLED", "ACTIVE", "INACTIVE", "DRAFT", "FINALIZED", "ADMIN", "DRIVER",
  "HOLD", "SKIPPED",
];

const FILTERS = ["All", "Pending", "Assigned", "Delivered", "Failed"];
const CHIP_TONES: Tone[] = ["mint", "blue", "butter", "lilac", "blush", "cream"];
const CHIPS = ["Surrey", "Delta", "Langley", "White Rock", "Richmond", "Coquitlam", "Abbotsford"];
const STEPS: Array<[Tone, string]> = [
  ["blue", "Staff enter the order"],
  ["mint", "The driver picks it up"],
  ["butter", "Delivered and invoiced"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className={sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

// Every shared primitive in one place, inside the real app shell, so the look
// can be screenshotted and compared without credentials.
export default function StyleGuide() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [driverId, setDriverId] = useState("");
  const [filter, setFilter] = useState("All");
  const [row, setRow] = useState("Surrey");
  const [lastAnswer, setLastAnswer] = useState("");
  const confirm = useConfirm();
  const promptDateRange = usePromptDateRange();
  const toast = useToast();

  return (
    <DevFrame>
      <PharmacyShell storeSlug={DEV_STORE.slug} storeName={DEV_STORE.name} navBasePath="/dev">
        <div className="space-y-10">
          <PageHeader>
            <span className={cn(eyebrow, "drop-in mb-4")}>Design system</span>
            <h1 className={pageTitle}>
              Style guide
            </h1>
            <p className={cn(mutedText, "drop-in drop-in--2 mt-2")}>Shared primitives with fixture content.</p>
          </PageHeader>

          <Section title="Buttons">
            <div className="flex flex-wrap items-center gap-3">
              <button className={cn(primaryButton, ctaShadow)}>Main call to action</button>
              <button className={primaryButton}>Primary</button>
              <button className={secondaryButton}>Secondary</button>
              <button className={softButton}>Soft</button>
              <button className={dangerButton}>Delete</button>
              <button className={primaryButton} disabled>Disabled</button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className={button("primary", "sm")}>Small primary</button>
              <button className={button("secondary", "sm")}>Small secondary</button>
              <button className={button("danger", "sm")}>Small delete</button>
              <button className={cn(linkButton, "text-sm")}>Row action</button>
              <button className={cn(dangerLinkButton, "text-sm")}>Delete</button>
              <a href="#" className={cn(textLink, "text-sm")}>Text link</a>
            </div>
            <div className="max-w-sm space-y-3">
              <button className={primaryButtonFull}>Full-width primary</button>
              <button className={cn(button("danger", "lg"), "w-full")}>Large destructive</button>
            </div>
          </Section>

          <Section title="Inputs">
            <div className="grid max-w-2xl grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={label} htmlFor="sg-name">Patient name</label>
                <input id="sg-name" className={input} placeholder="Start typing a name" />
              </div>
              <div>
                <label className={label} htmlFor="sg-ro">Read-only</label>
                <input id="sg-ro" className={`${input} ${inputReadOnly}`} readOnly value="14250 88 Ave" />
              </div>
              <div>
                <label className={label} htmlFor="sg-zone">Delivery Zone</label>
                <select id="sg-zone" className={input} defaultValue="" aria-describedby="sg-zone-hint">
                  <option value="">Select zone...</option>
                  <option>Surrey — $4.25</option>
                </select>
                <p id="sg-zone-hint" className="mt-1 text-xs font-medium text-muted">
                  Suggested from 52 past deliveries to Delta — check before saving
                </p>
              </div>
              <DriverSelect
                drivers={drivers}
                value={driverId}
                onChange={setDriverId}
                autoFilledFromZone={false}
                required
              />
              <div className="md:col-span-2">
                <label className={label} htmlFor="sg-notes">Delivery Instructions</label>
                <textarea id="sg-notes" rows={3} className={input} placeholder="Leave at door, ring bell, etc." />
              </div>
            </div>
          </Section>

          <Section title="Selectable filters, tabs and rows">
            <div className="flex flex-wrap gap-2" data-testid="filters">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(selectablePill, "inline-flex items-center gap-2")}
                >
                  <span className="select-dot" aria-hidden="true" />
                  {f}
                </button>
              ))}
            </div>
            <div className="max-w-md space-y-2">
              {["Surrey", "Abbotsford"].map((store) => (
                <button
                  key={store}
                  type="button"
                  aria-pressed={row === store}
                  onClick={() => setRow(store)}
                  className={cn(selectableRow, "flex w-full items-center gap-3 px-4 py-3 text-left")}
                >
                  <span className="select-dot" aria-hidden="true" />
                  <span>
                    <span className="block font-bold text-navy">Beyond Pharmacy {store}</span>
                    <span className="block text-sm text-ink">View dashboard &rarr;</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Chips and ticker">
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((chip, i) => (
                <span
                  key={chip}
                  className={cn("rounded-full px-3 py-1 text-small font-bold", TONE_CLASSES[CHIP_TONES[i % CHIP_TONES.length]])}
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className="ticker overflow-hidden" tabIndex={0} aria-label="Delivery zones">
              <div className="ticker-track flex w-max gap-2">
                {[...CHIPS, ...CHIPS].map((chip, i) => (
                  <span
                    key={`${chip}-${i}`}
                    aria-hidden={i >= CHIPS.length ? true : undefined}
                    className={cn("rounded-full px-3 py-1 text-small font-bold", TONE_CLASSES[CHIP_TONES[i % CHIP_TONES.length]])}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Status badges, markers and banners">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <span key={s} className={statusBadgeClasses(s)}>
                  {s.replace(/_/g, " ")}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-4 text-sm text-ink">
              {(Object.keys(MARKER_CLASSES) as Array<keyof typeof MARKER_CLASSES>).map((kind) => (
                <span key={kind} className="inline-flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", MARKER_CLASSES[kind])} aria-hidden="true" />
                  {kind}
                </span>
              ))}
            </div>
            <div className="grid max-w-2xl grid-cols-1 gap-2">
              <div className={cn("rounded-row px-4 py-3 text-sm", BANNER_CLASSES.error)}>Network error. Please try again.</div>
              <div className={cn("rounded-row px-4 py-3 text-sm", BANNER_CLASSES.warning)}>This client already has a driver delivery today.</div>
              <div className={cn("rounded-row px-4 py-3 text-sm", BANNER_CLASSES.success)}>User created successfully</div>
              <div className={cn("rounded-row px-4 py-3 text-sm", BANNER_CLASSES.info)}>Re-attempt #2</div>
            </div>
          </Section>

          <Section title="Cards and panels">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className={`${card} p-6`}>
                <h3 className={sectionTitle}>Card</h3>
                <p className={mutedText}>Static container.</p>
              </div>
              <div className={`${cardInteractive} p-6`}>
                <h3 className={sectionTitle}>Interactive card</h3>
                <p className={mutedText}>Hover to lift.</p>
              </div>
              <div className={emptyState}>
                No <span className="text-navy">reminders</span> scheduled
              </div>
              <div className={`${panel} p-6`}>
                <h3 className={sectionTitle}>Cream panel</h3>
                <p className="text-sm text-ink">Neutral fill, no border.</p>
              </div>
              <div className="circle-host overflow-hidden rounded-card bg-mint p-6">
                <Circles variant="mintPanel" />
                <h3 className={sectionTitle}>Mint panel</h3>
                <p className="text-sm text-navy">With its butter circle.</p>
              </div>
              <div className="circle-host overflow-hidden rounded-card bg-cream p-6">
                <Circles variant="creamPanel" />
                <h3 className={sectionTitle}>Cream call to action</h3>
                <button className={cn(primaryButton, "mt-3")}>Get started</button>
              </div>
            </div>
            <div className="feature-card max-w-xl rounded-card p-8 shadow-photo">
              <div className="feature-card__scrim" aria-hidden="true" />
              <div className="relative space-y-4">
                <p className="text-label font-bold uppercase tracking-label">Dark feature card</p>
                <h3 className="text-h2 font-extrabold leading-h2 tracking-h2">
                  Deliveries, sorted
                </h3>
                <div className="flex flex-wrap gap-2">
                  {["Surrey", "Delta", "Langley"].map((chip) => (
                    <span key={chip} className="on-dark-chip rounded-full px-3 py-1 text-small font-bold">{chip}</span>
                  ))}
                </div>
                <button className="on-dark-button rounded-full px-btn-x py-btn-y text-sm font-bold active:scale-(--press-scale)">
                  View today
                </button>
              </div>
            </div>
          </Section>

          <Section title="Step rows">
            <div className="max-w-md space-y-2">
              {STEPS.map(([tone, text], i) => (
                <div key={text} className={cn("flex items-center gap-4 rounded-row p-4", TONE_CLASSES[tone])}>
                  <span className="flex size-(--step-dot) shrink-0 items-center justify-center rounded-full bg-white font-extrabold text-navy">
                    {i + 1}
                  </span>
                  <span className="font-semibold">{text}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Table">
            <div className={`${card} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className={tableHeader}>
                    <tr>
                      <th className="px-6 py-3">Patient</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {[
                      ["Avery Sandhu", "ASSIGNED", 4.25],
                      ["Morgan Patel", "FAILED", 4.25],
                      ["Casey Brar", "DELIVERED", 5.25],
                    ].map(([name, status, price]) => (
                      <tr key={name as string} className={tableRow}>
                        <td className="px-6 py-4 text-sm font-semibold text-navy">{name}</td>
                        <td className="px-6 py-4">
                          <span className={statusBadgeClasses(status as string)}>{status}</span>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-navy tabular-nums">
                          ${(price as number).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-hairline px-6 py-4 text-sm">
                <span className={totalPill.regular}>Regular $8.50</span>
                <span className={totalPill.highlight}>Extra $5.25</span>
                <span className={totalPill.total}>Total $13.75</span>
              </div>
            </div>
          </Section>

          <Section title="Dialogs and toasts">
            <div className="flex flex-wrap gap-3">
              <button className={secondaryButton} onClick={() => setConfirmOpen(true)} data-testid="open-confirm">
                Open confirm dialog
              </button>
              <button
                className={secondaryButton}
                data-testid="open-native-confirm"
                onClick={async () => {
                  const ok = await confirm({ message: "Delete this reminder?", tone: "danger" });
                  setLastAnswer(ok ? "Confirmed" : "Cancelled");
                }}
              >
                In-app confirm
              </button>
              <button
                className={secondaryButton}
                data-testid="open-long-confirm"
                onClick={async () => {
                  const ok = await confirm({
                    tone: "danger",
                    message:
                      "Merge this record into the patient you selected?\n\nJordan Kaur — 6620 King George Blvd, Surrey\n\nDefault address stays: 14250 88 Ave, Surrey.\n6620 King George Blvd, Surrey will be added as a saved address.\n\nIts 12 deliveries and 1 active recurring profile move to the selected patient, and the duplicate record is removed. This can't be undone.\n\n⚠ The phone numbers are different — make sure this is the same person.",
                  });
                  setLastAnswer(ok ? "Confirmed" : "Cancelled");
                }}
              >
                Long confirm
              </button>
              <button
                className={secondaryButton}
                data-testid="open-date-range"
                onClick={async () => {
                  const range = await promptDateRange({
                    title: "Vacation Hold",
                    startLabel: "Hold start date",
                    endLabel: "Hold end date",
                  });
                  setLastAnswer(range ? `${range.start} to ${range.end}` : "Cancelled");
                }}
              >
                Hold dates
              </button>
              <button className={secondaryButton} data-testid="toast-error" onClick={() => toast.error("Failed to update order")}>
                Error toast
              </button>
              <button className={secondaryButton} data-testid="toast-success" onClick={() => toast.success("Password updated successfully")}>
                Success toast
              </button>
            </div>
            {lastAnswer && (
              <p className="text-sm text-ink" data-testid="dialog-answer">Answer: {lastAnswer}</p>
            )}
            <ConfirmModal
              open={confirmOpen}
              title="Delete this reminder?"
              message="This can't be undone."
              confirmLabel="Delete"
              tone="danger"
              onConfirm={() => setConfirmOpen(false)}
              onCancel={() => setConfirmOpen(false)}
            />
          </Section>

          <Section title="Loading and error states">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={card}>
                <PharmacyLoading />
              </div>
              <PharmacyError error={new Error("Fixture error")} reset={() => {}} />
            </div>
          </Section>

          <Section title="Scroll reveal">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {["First", "Second", "Third"].map((name) => (
                <div key={name} data-reveal="" className={`${card} p-6`}>
                  <h3 className={sectionTitle}>{name} card</h3>
                  <p className={mutedText}>Rises into view on scroll.</p>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </PharmacyShell>
    </DevFrame>
  );
}
