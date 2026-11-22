"use client";

import { useState, useCallback, useId, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PatientAutocomplete } from "@/components/PatientAutocomplete";
import { AddressSelect, type AddressValue } from "@/components/AddressSelect";
import type { Patient } from "@/hooks/usePatientSearch";
import { card, cn, ctaShadow, input, label, primaryButton, sectionTitle } from "@/lib/portalStyles";
import { BANNER_CLASSES } from "@/lib/statusTheme";
import { EMPTY_ADDRESS, addressFromPatient } from "@/lib/addressForm";
import { vancouverTodayKey } from "@/lib/vancouverDate";
import {
  resolveZoneSelection,
  suggestZone,
  zoneHint as buildZoneHint,
  type ZoneHistory,
} from "@/lib/zoneSuggestion";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Zone {
  id: string;
  name: string;
  price: number;
}

interface Driver {
  id: string;
  name: string;
  // Anchor / Spoke courier: its deliveries aren't invoiced, so no zone price.
  isExternal?: boolean;
}

function todayInputValue() {
  // Vancouver's today — toISOString() rolls to tomorrow after ~5 PM Pacific.
  return vancouverTodayKey();
}

export default function RecurringOrderForm({
  zones,
  drivers,
  storeSlug,
  zoneHistory,
  fallbackZoneId,
}: {
  zones: Zone[];
  drivers: Driver[];
  storeSlug: string;
  zoneHistory: ZoneHistory;
  fallbackZoneId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([1]);
  const [recurrenceIntervalWeeks, setRecurrenceIntervalWeeks] = useState(1);
  const [recurrenceAnchorDate, setRecurrenceAnchorDate] = useState(todayInputValue);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientNameFreeText, setPatientNameFreeText] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(false);
  const [preferredAddressId, setPreferredAddressId] = useState<string | null>(null);
  const [editingSavedAddress, setEditingSavedAddress] = useState(false);
  const [patientInputKey, setPatientInputKey] = useState(0);
  // null = follow the suggestion from the address; a string = picked by hand,
  // which is never overwritten — not even by a new patient.
  const [manualZoneId, setManualZoneId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const zoneSuggestion = useMemo(
    () => suggestZone({ city: address.city, zones, history: zoneHistory }),
    [address.city, zones, zoneHistory]
  );
  const isExternalDriver = !!drivers.find((d) => d.id === selectedDriverId)?.isExternal;
  // Anchor: assigned automatically (price never invoiced). In-house: pre-filled
  // from the address for staff to confirm — it sets the invoiced price.
  const { selectedZoneId, showZoneSelect } = resolveZoneSelection({
    isExternalDriver,
    manualZoneId,
    suggestion: zoneSuggestion,
    fallbackZoneId,
  });
  const zoneHint = buildZoneHint({
    isExternalDriver,
    manualZoneId,
    suggestion: zoneSuggestion,
    city: address.city,
    zones,
  });

  const selectPatient = useCallback((patient: Patient) => {
    setSelectedPatient(patient);
    setPatientPhone(patient.phone || "");
    setAddress(addressFromPatient(patient));
    setSaveAddress(false);
    setPreferredAddressId(patient.matchedAddressId ?? null);
    setEditingSavedAddress(false);
  }, []);

  const clearPatient = useCallback(() => {
    setSelectedPatient(null);
    setPatientNameFreeText("");
    setPatientPhone("");
    setAddress(EMPTY_ADDRESS);
    setSaveAddress(false);
    setPreferredAddressId(null);
    setEditingSavedAddress(false);
  }, []);

  const handleFreeTextName = useCallback((name: string) => {
    setPatientNameFreeText(name);
    setPreferredAddressId(null);
  }, []);

  const handleAddressChange = useCallback((value: AddressValue) => {
    setAddress(value);
    if (value.addressId) setSaveAddress(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (editingSavedAddress) return;

    if (selectedDays.length === 0) {
      setError("Select at least one delivery day");
      return;
    }

    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const patientName = selectedPatient?.name ?? patientNameFreeText;
    const res = await fetch(`/api/${storeSlug}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientId: selectedPatient?.id || null,
        patientName,
        patientPhone,
        deliveryAddress: address.address,
        deliveryCity: address.city,
        deliveryPostalCode: address.postalCode,
        deliveryAddressId: address.addressId,
        saveAddressToPatient: saveAddress,
        deliveryZoneId: selectedZoneId,
        assignedDriverId: selectedDriverId || null,
        instructions: formData.get("instructions"),
        activeDays: selectedDays,
        recurrenceIntervalWeeks,
        recurrenceAnchorDate,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      setError(err.error || "Failed to create");
    } else {
      (e.target as HTMLFormElement).reset();
      setSelectedDays([1]);
      setRecurrenceIntervalWeeks(1);
      setRecurrenceAnchorDate(todayInputValue());
      clearPatient();
      setPatientNameFreeText("");
      setAddress(EMPTY_ADDRESS);
      setSaveAddress(false);
      // Controlled selects aren't cleared by form.reset().
      setManualZoneId(null);
      setSelectedDriverId("");
      setPatientInputKey((key) => key + 1);
      router.refresh();
    }
    setLoading(false);
  };

  const fieldId = useId();

  return (
    <div className={`${card} p-6`}>
      <h2 className={`${sectionTitle} mb-4`}>New recurring profile</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div role="alert" className={cn("px-3 py-2 rounded-row text-sm", BANNER_CLASSES.error)}>{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PatientAutocomplete
            key={patientInputKey}
            storeSlug={storeSlug}
            selected={selectedPatient}
            onSelect={selectPatient}
            onClear={clearPatient}
            onFreeTextChange={handleFreeTextName}
          />
          <div>
            <label htmlFor={`${fieldId}-phone`} className={label}>Patient Phone</label>
            <input
              id={`${fieldId}-phone`}
              type="tel"
              value={patientPhone}
              onChange={(e) => setPatientPhone(e.target.value)}
              className={input}
            />
          </div>
        </div>

        <AddressSelect
          key={selectedPatient?.id ?? "new-patient"}
          storeSlug={storeSlug}
          patientId={selectedPatient?.id ?? null}
          value={address}
          onChange={handleAddressChange}
          saveToPatient={saveAddress}
          onSaveToPatientChange={setSaveAddress}
          preferredAddressId={preferredAddressId}
          onEditingSavedAddressChange={setEditingSavedAddress}
        />
        {showZoneSelect && (
          <div>
            <select
              name="deliveryZoneId"
              aria-label="Delivery Zone"
              aria-describedby={zoneHint ? `${fieldId}-zone-hint` : undefined}
              required
              value={selectedZoneId}
              onChange={(e) => setManualZoneId(e.target.value)}
              className={input}
            >
              <option value="">Select zone...</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name} — ${z.price.toFixed(2)}</option>
              ))}
            </select>
            {zoneHint && (
              <p id={`${fieldId}-zone-hint`} className="mt-1 text-xs font-medium text-muted">{zoneHint}</p>
            )}
          </div>
        )}
        <select
          name="assignedDriverId"
          aria-label="Assign Driver"
          value={selectedDriverId}
          onChange={(e) => setSelectedDriverId(e.target.value)}
          className={input}
        >
          <option value="">Assign Driver (optional — uses zone default)</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${fieldId}-frequency`} className={label}>Frequency</label>
            <select
              id={`${fieldId}-frequency`}
              value={recurrenceIntervalWeeks}
              onChange={(e) => setRecurrenceIntervalWeeks(Number(e.target.value))}
              className={input}
            >
              <option value={1}>Weekly</option>
              <option value={2}>Biweekly (every 2 weeks)</option>
            </select>
          </div>
          {recurrenceIntervalWeeks === 2 && (
            <div>
              <label htmlFor={`${fieldId}-start-week`} className={label}>Start Week</label>
              <input
                id={`${fieldId}-start-week`}
                type="date"
                value={recurrenceAnchorDate}
                onChange={(e) => setRecurrenceAnchorDate(e.target.value)}
                className={input}
              />
            </div>
          )}
        </div>
        <div>
          <span id={`${fieldId}-days`} className={label}>Delivery Days</span>
          <div role="group" aria-labelledby={`${fieldId}-days`} className="flex flex-wrap gap-2">
            {DAYS.map((day, i) => (
              <label
                key={i}
                data-selected={selectedDays.includes(i) ? "true" : undefined}
                className="selectable flex items-center gap-1.5 py-1.5 pl-2 pr-3 rounded-full text-sm font-semibold cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy"
              >
                <span className="select-dot" aria-hidden="true" />
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={selectedDays.includes(i)}
                  onChange={() => {
                    setSelectedDays((prev) =>
                      prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort()
                    );
                  }}
                />
                {day}
              </label>
            ))}
          </div>
        </div>
        <textarea name="instructions" rows={2} placeholder="Instructions (optional)" className={input} />

        <button type="submit" disabled={loading || selectedDays.length === 0 || editingSavedAddress} className={cn(primaryButton, ctaShadow)}>
          {loading ? "Creating…" : "Create profile"}
        </button>
      </form>
    </div>
  );
}
