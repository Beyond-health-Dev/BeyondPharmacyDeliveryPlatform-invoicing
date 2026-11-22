"use client";

import { memo, useEffect, useId, useRef, useState } from "react";
import { usePatientSearch, type Patient } from "@/hooks/usePatientSearch";
import { cn, input, inputReadOnly, label, textLink } from "@/lib/portalStyles";

interface Props {
  storeSlug: string;
  selected: Patient | null;
  onSelect: (p: Patient) => void;
  onClear: () => void;
  onFreeTextChange: (name: string) => void;
}

function PatientAutocompleteInner({
  storeSlug,
  selected,
  onSelect,
  onClear,
  onFreeTextChange,
}: Props) {
  const { query, setQuery, results, loading, selectPatient } = usePatientSearch(storeSlug);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const inputId = useId();
  const listId = inputId + "-results";

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setDismissed(true);
      }
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);

  const open = !dismissed && !selected && results.length > 0;
  const activePatient = open ? results[activeIndex] : undefined;

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activePatient]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDismissed(false);
    setActiveIndex(-1);
    setQuery(v);
    onFreeTextChange(v);
  };

  const handleSelect = (p: Patient) => {
    selectPatient(p);
    onSelect(p);
    setDismissed(true);
    setActiveIndex(-1);
  };

  const handleClear = () => {
    setQuery("");
    setDismissed(false);
    setActiveIndex(-1);
    onClear();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || selected || results.length === 0) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setDismissed(true);
      setActiveIndex(-1);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setDismissed(false);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        if (index < 0 || index >= results.length) return direction > 0 ? 0 : results.length - 1;
        return (index + direction + results.length) % results.length;
      });
    } else if (event.key === "Enter" && activePatient) {
      event.preventDefault();
      handleSelect(activePatient);
    }
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDismissed(true);
          setActiveIndex(-1);
        }
      }}
    >
      <label htmlFor={inputId} className={label}>Patient name *</label>
      <div className="flex">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role={selected ? undefined : "combobox"}
          aria-autocomplete={selected ? undefined : "list"}
          aria-expanded={selected ? undefined : open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activePatient ? listId + "-" + activePatient.id : undefined}
          required
          value={selected ? selected.name : query}
          onChange={handleChange}
          onFocus={() => setDismissed(false)}
          onKeyDown={handleKeyDown}
          readOnly={!!selected}
          className={cn(input, selected && inputReadOnly)}
        />
        {selected && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(textLink, "ml-2 px-3 py-2 text-sm")}
          >
            Change
          </button>
        )}
      </div>
      {loading && !selected && (
        <p className="mt-1 text-xs text-muted" role="status">Searching patients…</p>
      )}
      {open && !selected && results.length > 0 && (
        <div id={listId} role="listbox" aria-label="Patient matches" className="absolute z-10 mt-1 w-full overflow-auto rounded-row border border-hairline bg-white shadow-lift max-h-60">
          {results.map((p) => (
            <button
              key={p.id}
              id={listId + "-" + p.id}
              type="button"
              role="option"
              aria-selected={activePatient?.id === p.id}
              ref={activePatient?.id === p.id ? activeOption : undefined}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(p)}
              className="row-hover w-full text-left px-3 py-2 border-b border-hairline last:border-b-0"
            >
              <div className="font-semibold text-navy">{p.name}</div>
              <div className="text-xs text-muted">
                {p.matchedAddress
                  ? `${p.matchedAddress.label} — ${p.matchedAddress.address}, ${p.matchedAddress.city} ${p.matchedAddress.postalCode}`
                  : `${p.address}, ${p.city} ${p.postalCode}`}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const PatientAutocomplete = memo(PatientAutocompleteInner);
