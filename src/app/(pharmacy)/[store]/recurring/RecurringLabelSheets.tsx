"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Modal from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/DialogsProvider";
import {
  button,
  card,
  cn,
  emptyState,
  input,
  linkButton,
  mutedText,
  sectionTitle,
} from "@/lib/portalStyles";
import { BANNER_CLASSES, toneBadgeClasses } from "@/lib/statusTheme";
import {
  LABEL_SHEETS,
  WEEKDAY_SHEETS,
  compareLabelProfiles,
  countLabelSheetPeople,
  draftLabelSheets,
  isDraftLabelSheetMoved,
  isLabelSheetChanged,
  isLabelSheetMoved,
  labelPageCount,
  labelSheetAssignments,
  labelSheetFileName,
  labelSheetForDays,
  labelSheetShortTitle,
  labelSheetTitle,
  resetDraftLabelSheets,
  toggleDraftLabelSheet,
  type LabelSheet,
  type LabelSheetDraft,
} from "@/lib/recurringLabels";

// What the card and its Rearrange panel need from each recurring profile.
interface LabelSheetOrder {
  id: string;
  patientName: string;
  deliveryAddress: string;
  deliveryCity: string;
  activeDays: number[];
  isActive: boolean;
  // The sheets staff chose; null = automatic, from the delivery days.
  labelSheets: LabelSheet[] | null;
}

// True once the page is running in the browser (false in the server HTML and
// while hydrating). Nothing ever changes it, so there is nothing to subscribe to.
const noSubscription = () => () => {};
function useHydrated() {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

// Preset delivery labels on Avery 5160 sheets: one button for the daily
// deliveries (two or more days a week), one per weekday for everyone else,
// and a panel where staff move people between sheets. The counts come from
// the same rules the PDF route uses.
export default function RecurringLabelSheets({
  storeSlug,
  orders,
  defaultRearrangeOpen = false,
}: {
  storeSlug: string;
  orders: readonly LabelSheetOrder[];
  // Opens the Rearrange panel on load (the style guide's screen).
  defaultRearrangeOpen?: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const dayGroupId = useId();
  const counts = useMemo(() => countLabelSheetPeople(orders), [orders]);
  const movedCount = useMemo(
    () => orders.filter((order) => order.isActive !== false && isLabelSheetMoved(order)).length,
    [orders]
  );
  const [pending, setPending] = useState<LabelSheet | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [rearranging, setRearranging] = useState(defaultRearrangeOpen);
  // The panel is a dialog drawn into the page body, which the server HTML
  // never has: opened on load, it waits until the page has hydrated.
  const hydrated = useHydrated();

  const download = async (sheet: LabelSheet) => {
    setPending(sheet);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/${storeSlug}/recurring/labels?sheet=${sheet}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Couldn't make the label sheet. Please try again.");
        return;
      }
      // An expired session is redirected to the sign-in page, which comes
      // back as a normal page rather than a PDF.
      if (!res.headers.get("Content-Type")?.includes("application/pdf")) {
        setError("Your session may have expired. Reload the page and sign in again.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = labelSheetFileName(storeSlug, sheet);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${labelSheetTitle(sheet)} labels downloaded. Print at Actual size (100%).`);
    } catch {
      setError("Network error — the label sheet wasn't downloaded. Please try again.");
    } finally {
      setPending(null);
    }
  };

  const openRearrange = () => {
    setError("");
    setStatus("");
    setRearranging(true);
  };

  const finishRearrange = ({ updated, missing }: SaveResult) => {
    setRearranging(false);
    router.refresh();
    const people = `${updated} ${updated === 1 ? "person" : "people"}`;
    if (missing > 0) {
      // Removed, deactivated or merged since the page loaded.
      setError(
        updated > 0
          ? `Saved label changes for ${people}, but some people could not be updated. Reload the page and try again.`
          : "Some people could not be updated, so nothing was saved. Reload the page and try again."
      );
    } else {
      setStatus(`Saved label changes for ${people}.`);
    }
  };

  const sheetButton = (sheet: LabelSheet, tone: "primary" | "secondary", extra?: string) => {
    const people = counts[sheet];
    const pages = labelPageCount(people);
    return (
      <button
        key={sheet}
        type="button"
        onClick={() => download(sheet)}
        disabled={people === 0 || pending !== null}
        aria-busy={pending === sheet || undefined}
        className={cn(button(tone, "sm"), extra)}
      >
        {pending === sheet ? (
          "Preparing…"
        ) : (
          <>
            {labelSheetTitle(sheet)} <span className="tabular-nums">({people})</span>
            {pages > 1 && <span className="tabular-nums"> · {pages} sheets</span>}
          </>
        )}
      </button>
    );
  };

  return (
    <section aria-labelledby={titleId} className={card}>
      <div className="px-6 py-4 border-b border-hairline flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={titleId} className={sectionTitle}>
            Delivery Labels
          </h2>
          <p className={cn(mutedText, "mt-1")}>
            Avery 5160 · 30 per sheet · each person&apos;s labels repeat to fill the page. Print at
            Actual size (100%).
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <button type="button" onClick={openRearrange} className={button("secondary", "sm")}>
            Rearrange labels
          </button>
          {movedCount > 0 && (
            <span className="text-xs text-muted tabular-nums">{movedCount} moved</span>
          )}
        </div>
      </div>
      <div className="px-6 py-4 space-y-4">
        {error && (
          <p role="alert" className={cn("rounded-row px-3 py-2 text-sm", BANNER_CLASSES.error)}>
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="inline-block text-xs font-bold text-navy bg-mint px-2.5 py-1 rounded-full">
            {status}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {sheetButton("daily", "primary")}
          <span className="text-xs text-muted">
            Profiles on two or more days a week, plus anyone moved here
          </span>
        </div>
        <div>
          <p id={dayGroupId} className="mb-2 text-xs font-semibold text-muted">
            One day a week
          </p>
          <div role="group" aria-labelledby={dayGroupId} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WEEKDAY_SHEETS.map((sheet) => sheetButton(sheet, "secondary", "w-full"))}
          </div>
        </div>
      </div>
      {rearranging && hydrated && (
        <RearrangeLabelsPanel
          storeSlug={storeSlug}
          orders={orders}
          onClose={() => setRearranging(false)}
          onSaved={finishRearrange}
        />
      )}
    </section>
  );
}

interface SaveResult {
  updated: number;
  missing: number;
}

// Mounted only while open, so every opening starts with a clean draft.
function RearrangeLabelsPanel({
  storeSlug,
  orders,
  onClose,
  onSaved,
}: {
  storeSlug: string;
  orders: readonly LabelSheetOrder[];
  onClose: () => void;
  onSaved: (result: SaveResult) => void;
}) {
  const confirm = useConfirm();
  const idBase = useId();
  const titleId = useId();
  const introId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<LabelSheetDraft>(() => new Map());
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // The row showing "Keep at least one sheet".
  const [hintFor, setHintFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Everyone who prints on a sheet, A to Z as the sheets list them. A profile
  // with no valid delivery days prints nowhere, so it has nothing to move.
  const people = useMemo(
    () =>
      orders
        .filter((order) => order.isActive !== false && labelSheetForDays(order.activeDays))
        .sort(compareLabelProfiles),
    [orders]
  );
  const trimmedQuery = query.trim().toLowerCase();
  const shown = trimmedQuery
    ? people.filter(
        (person) =>
          person.patientName.toLowerCase().includes(trimmedQuery) ||
          person.deliveryAddress.toLowerCase().includes(trimmedQuery) ||
          person.deliveryCity.toLowerCase().includes(trimmedQuery)
      )
    : people;
  const changes = draft.size;

  const pillId = (person: LabelSheetOrder, sheet: LabelSheet) => `${idBase}-${person.id}-${sheet}`;

  const requestClose = async () => {
    if (saving) return;
    if (
      changes > 0 &&
      !(await confirm({
        message: "Discard your label changes?",
        confirmLabel: "Discard changes",
        cancelLabel: "Keep editing",
        tone: "danger",
      }))
    ) {
      return;
    }
    onClose();
  };

  const toggleOpen = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setHintFor(null);
  };

  const toggleSheet = (person: LabelSheetOrder, sheet: LabelSheet) => {
    if (saving) return;
    const next = toggleDraftLabelSheet(draft, person, sheet);
    if (!next) {
      setHintFor(person.id);
      return;
    }
    setHintFor(null);
    setDraft(next);
  };

  const reset = (person: LabelSheetOrder) => {
    if (saving) return;
    setDraft(resetDraftLabelSheets(draft, person));
    setHintFor(null);
    // The Reset link goes away; keep focus in the row, on the sheet the
    // person is back on.
    const automatic = labelSheetForDays(person.activeDays);
    if (automatic) document.getElementById(pillId(person, automatic))?.focus();
  };

  const save = async () => {
    if (saving || changes === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/${storeSlug}/recurring/labels/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments: labelSheetAssignments(draft) }),
      });
      const body = await res.json().catch(() => null);
      // Only the route's own reply counts: an expired session is redirected
      // to the sign-in page, which comes back as a normal page.
      if (res.status === 401 || (res.ok && typeof body?.updated !== "number")) {
        setError("Your session may have expired. Reload the page and sign in again. Nothing was saved.");
        return;
      }
      if (!res.ok) {
        setError(body?.error || "Couldn't save the label changes. Please try again.");
        return;
      }
      onSaved({ updated: body.updated, missing: typeof body.missing === "number" ? body.missing : 0 });
    } catch {
      setError("Network error — your label changes weren't saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={requestClose}
      dismissible={!saving}
      size="lg"
      labelledBy={titleId}
      describedBy={introId}
      initialFocusRef={searchRef}
    >
      <div className="shrink-0 border-b border-hairline px-6 pb-4 pt-2 sm:pt-6">
        <h3 id={titleId} className={sectionTitle}>
          Rearrange labels
        </h3>
        <p id={introId} className={cn(mutedText, "mt-1")}>
          This only changes which label sheet a person prints on, not their delivery days.
        </p>
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears the search first, then closes the panel.
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder="Search by name or address…"
          aria-label="Search by name or address"
          className={cn(input, "mt-3")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className={cn(emptyState, "m-4")}>
            {people.length === 0 ? (
              "No recurring profiles print on a label sheet yet."
            ) : (
              <>No one matches <span className="text-navy">&ldquo;{query.trim()}&rdquo;</span>.</>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {shown.map((person) => (
              <RearrangeRow
                key={person.id}
                person={person}
                areaId={`${idBase}-${person.id}`}
                pillId={(sheet) => pillId(person, sheet)}
                sheets={draftLabelSheets(draft, person)}
                moved={isDraftLabelSheetMoved(draft, person)}
                changed={isLabelSheetChanged(draft, person.id)}
                expanded={expanded.has(person.id)}
                showHint={hintFor === person.id}
                onToggleOpen={() => toggleOpen(person.id)}
                onToggleSheet={(sheet) => toggleSheet(person, sheet)}
                onReset={() => reset(person)}
              />
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className={cn("shrink-0 px-6 py-2 text-sm", BANNER_CLASSES.error)}>
          {error}
        </p>
      )}

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-hairline px-6 py-4">
        <button type="button" onClick={requestClose} disabled={saving} className={button("secondary")}>
          Cancel
        </button>
        {/* Stays focusable while saving, so keyboard focus isn't lost if it fails. */}
        <button
          type="button"
          onClick={save}
          disabled={changes === 0}
          aria-disabled={saving || undefined}
          aria-busy={saving || undefined}
          className={button("primary")}
        >
          {saving ? "Saving…" : <>Save changes <span className="tabular-nums">({changes})</span></>}
        </button>
      </div>
    </Modal>
  );
}

function RearrangeRow({
  person,
  areaId,
  pillId,
  sheets,
  moved,
  changed,
  expanded,
  showHint,
  onToggleOpen,
  onToggleSheet,
  onReset,
}: {
  person: LabelSheetOrder;
  areaId: string;
  pillId: (sheet: LabelSheet) => string;
  sheets: LabelSheet[];
  moved: boolean;
  changed: boolean;
  expanded: boolean;
  showHint: boolean;
  onToggleOpen: () => void;
  onToggleSheet: (sheet: LabelSheet) => void;
  onReset: () => void;
}) {
  const days = person.activeDays.map((day) => labelSheetShortTitle(WEEKDAY_SHEETS[day])).join(", ");

  return (
    <li className="px-6 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-navy">{person.patientName}</p>
          <p className="text-sm text-muted">
            {person.deliveryAddress}, {person.deliveryCity}
          </p>
          <p className="text-xs text-muted">Delivers {days}</p>
          <p className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">Labels:</span>
            {sheets.map((sheet) => (
              <span key={sheet} className={toneBadgeClasses("cream")}>
                {labelSheetTitle(sheet)}
              </span>
            ))}
            {moved && <span className={toneBadgeClasses("blue")}>Moved</span>}
            {changed && <span className={toneBadgeClasses("butter")}>Not saved</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={expanded}
          aria-controls={areaId}
          aria-label={`Change label sheets for ${person.patientName}`}
          className={cn(button("secondary", "sm"), "shrink-0")}
        >
          Change
        </button>
      </div>
      {expanded && (
        <div id={areaId} className="mt-3">
          <div
            role="group"
            aria-label={`Label sheets for ${person.patientName}`}
            className="grid grid-cols-4 gap-1.5"
          >
            {LABEL_SHEETS.map((sheet) => (
              <button
                key={sheet}
                id={pillId(sheet)}
                type="button"
                onClick={() => onToggleSheet(sheet)}
                aria-pressed={sheets.includes(sheet)}
                aria-label={labelSheetTitle(sheet)}
                className="selectable inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-semibold active:scale-(--press-scale)"
              >
                <span className="select-dot" aria-hidden="true" />
                {labelSheetShortTitle(sheet)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs font-semibold text-navy">
              {showHint ? "Keep at least one sheet" : ""}
            </p>
            {moved && (
              <button
                type="button"
                onClick={onReset}
                aria-label={`Reset labels for ${person.patientName}`}
                className={cn(linkButton, "text-xs")}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
