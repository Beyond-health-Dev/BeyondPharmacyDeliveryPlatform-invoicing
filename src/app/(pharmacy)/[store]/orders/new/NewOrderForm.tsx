"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PatientAutocomplete } from "@/components/PatientAutocomplete";
import { AddressSelect, type AddressValue } from "@/components/AddressSelect";
import { DriverSelect } from "@/components/DriverSelect";
import { useCreateOrder } from "@/hooks/useCreateOrder";
import type { Patient } from "@/hooks/usePatientSearch";
import {
  card,
  cn,
  ctaShadow,
  input,
  label,
  primaryButton,
  secondaryButton,
} from "@/lib/portalStyles";
import { BANNER_CLASSES } from "@/lib/statusTheme";
import { EMPTY_ADDRESS, addressFromPatient } from "@/lib/addressForm";
import { newOrderAnchorHint } from "@/lib/externalDispatchStatus";
import {
  addDaysToDateKey,
  describeDeliveryDay,
  vancouverTodayKey,
  type DeliveryDateDefault,
} from "@/lib/vancouverDate";
import {
  resolveZoneSelection,
  suggestZone,
  zoneHint as buildZoneHint,
  type ZoneHistory,
} from "@/lib/zoneSuggestion";

interface Zone {
  id: string;
  name: string;
  price: number;
  defaultDriverId: string | null;
}

interface Driver {
  id: string;
  name: string;
  // Anchor / Spoke courier: its deliveries aren't invoiced, so no zone price.
  isExternal?: boolean;
}

export default function NewOrderForm({
  zones,
  drivers,
  storeSlug,
  zoneHistory,
  fallbackZoneId,
  dateDefault,
}: {
  zones: Zone[];
  drivers: Driver[];
  storeSlug: string;
  zoneHistory: ZoneHistory;
  fallbackZoneId: string | null;
  // Today before 12 PM (Vancouver), tomorrow from noon — from the server.
  dateDefault: DeliveryDateDefault;
}) {
  const router = useRouter();
  // Vancouver's today, from the server's default (the noon rule moved that to
  // tomorrow when nextDay is set) for the first render, so it matches the
  // server's. A form left open past midnight then catches up: after mount
  // and whenever the tab is shown again.
  const [todayKey, setTodayKey] = useState(() =>
    dateDefault.nextDay ? addDaysToDateKey(dateDefault.dateKey, -1) : dateDefault.dateKey
  );
  useEffect(() => {
    const refresh = () => {
      const current = vancouverTodayKey();
      setTodayKey((known) => (known === current ? known : current));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const afterMount = setTimeout(refresh, 0);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(afterMount);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const { submit, loading, error, duplicate, clearDuplicate } = useCreateOrder(storeSlug, { todayKey });

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [patientNameFreeText, setPatientNameFreeText] = useState("");
  const [patientPhone, setPatientPhone] = useState("");
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(false);
  const [preferredAddressId, setPreferredAddressId] = useState<string | null>(null);
  const [editingSavedAddress, setEditingSavedAddress] = useState(false);
  // null = follow the suggestion from the address; a string = staff picked
  // a zone by hand, which is never overwritten — not even by a new patient.
  const [manualZoneId, setManualZoneId] = useState<string | null>(null);
  // Anchor (the Spoke courier) is preselected; staff can switch to another
  // driver before creating the order. Stores without one start empty.
  const [preselectedDriverId] = useState(() => drivers.find((d) => d.isExternal)?.id ?? "");
  const [selectedDriverId, setSelectedDriverId] = useState(preselectedDriverId);
  // Cleared as soon as the driver changes for any reason (staff or zone).
  const [driverIsPreselected, setDriverIsPreselected] = useState(preselectedDriverId !== "");
  const [instructions, setInstructions] = useState("");
  const fieldId = useId();
  const [scheduledDate, setScheduledDate] = useState(dateDefault.dateKey);
  const showNextDayHint = dateDefault.nextDay && scheduledDate === dateDefault.dateKey;

  const zoneSuggestion = useMemo(
    () => suggestZone({ city: address.city, zones, history: zoneHistory }),
    [address.city, zones, zoneHistory]
  );

  const isExternalDriver = !!drivers.find((d) => d.id === selectedDriverId)?.isExternal;
  // An Anchor order for a later day waits here for that day's 6 AM run.
  const anchorHint = newOrderAnchorHint({
    isAnchor: isExternalDriver,
    scheduledDateKey: scheduledDate,
    todayKey,
  });

  // Anchor: the zone is assigned automatically (its price is never invoiced).
  // In-house (Derek): pre-filled from the address, but staff confirm it —
  // it sets the price on his invoice.
  const { selectedZoneId, showZoneSelect } = resolveZoneSelection({
    isExternalDriver,
    manualZoneId,
    suggestion: zoneSuggestion,
    fallbackZoneId,
  });

  const selectedZone = useMemo(
    () => zones.find((z) => z.id === selectedZoneId) ?? null,
    [zones, selectedZoneId]
  );
  const zoneHint = buildZoneHint({
    isExternalDriver,
    manualZoneId,
    suggestion: zoneSuggestion,
    city: address.city,
    zones,
  });

  const zoneDefaultDriverId = selectedZone?.defaultDriverId ?? null;

  const handleZoneChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setManualZoneId(id);
      const zone = zones.find((z) => z.id === id);
      setSelectedDriverId(zone?.defaultDriverId ?? "");
      setDriverIsPreselected(false);
    },
    [zones]
  );

  const handleSelectPatient = useCallback((p: Patient) => {
    clearDuplicate();
    setSelectedPatient(p);
    setPatientPhone(p.phone ?? "");
    setAddress(addressFromPatient(p));
    setSaveAddress(false);
    setPreferredAddressId(p.matchedAddressId ?? null);
    setEditingSavedAddress(false);
  }, [clearDuplicate]);

  const handleClearPatient = useCallback(() => {
    clearDuplicate();
    setSelectedPatient(null);
    setPatientNameFreeText("");
    setPatientPhone("");
    setAddress(EMPTY_ADDRESS);
    setSaveAddress(false);
    setPreferredAddressId(null);
    setEditingSavedAddress(false);
  }, [clearDuplicate]);

  const handleFreeTextName = useCallback((name: string) => {
    clearDuplicate();
    setPatientNameFreeText(name);
    setPreferredAddressId(null);
  }, [clearDuplicate]);

  const handleAddressChange = useCallback((v: AddressValue) => {
    clearDuplicate();
    setAddress(v);
    if (v.addressId) setSaveAddress(false);
  }, [clearDuplicate]);

  const handleSaveAddressChange = useCallback((b: boolean) => {
    setSaveAddress(b);
  }, []);

  const handleDriverChange = useCallback((id: string) => {
    setSelectedDriverId(id);
    setDriverIsPreselected(false);
  }, []);

  const buildInput = (allowDuplicate: boolean) => ({
    patientId: selectedPatient?.id ?? null,
    patientName: selectedPatient?.name ?? patientNameFreeText,
    patientPhone,
    deliveryAddress: address.address,
    deliveryCity: address.city,
    deliveryPostalCode: address.postalCode,
    deliveryAddressId: address.addressId,
    saveAddressToPatient: saveAddress,
    deliveryZoneId: selectedZoneId,
    assignedDriverId: selectedDriverId,
    instructions,
    scheduledDate,
    allowDuplicate,
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (editingSavedAddress) return;
    // Driver assignment is mandatory — the select is `required`, this is a guard
    // for completeness (the server enforces it too).
    if (!selectedDriverId) return;
    submit(buildInput(false));
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`max-w-2xl ${card} p-6 space-y-4`}
    >
      {error && (
        <div role="alert" className={cn("px-4 py-3 rounded-row text-sm", BANNER_CLASSES.error)}>
          {error}
        </div>
      )}

      {duplicate && (
        <div className={cn("px-4 py-3 rounded-row text-sm space-y-2", BANNER_CLASSES.warning)}>
          <p>
            This client already has a{" "}
            {duplicate.kind === "SPOKE" ? "Spoke/Anchor" : "driver"} delivery
            {" "}{describeDeliveryDay(duplicate.scheduledDate)} (status: {duplicate.status}). Check the Orders page first —
            if this is an intentional second delivery, confirm below.
          </p>
          <button
            type="button"
            onClick={() => submit(buildInput(true))}
            disabled={loading || editingSavedAddress || !selectedDriverId}
            className="rounded-full border-(length:--line-strong) border-control bg-white px-4 py-2 text-xs font-bold text-navy shadow-soft transition duration-(--hover-ms) hover:border-control-hover active:scale-(--press-scale) disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create second delivery anyway"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PatientAutocomplete
          storeSlug={storeSlug}
          selected={selectedPatient}
          onSelect={handleSelectPatient}
          onClear={handleClearPatient}
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
        onSaveToPatientChange={handleSaveAddressChange}
        preferredAddressId={preferredAddressId}
        onEditingSavedAddressChange={setEditingSavedAddress}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {showZoneSelect && (
          <div>
            <label htmlFor={`${fieldId}-zone`} className={label}>Delivery Zone *</label>
            <select
              id={`${fieldId}-zone`}
              aria-describedby={
                cn(selectedZone && `${fieldId}-zone-price`, zoneHint && `${fieldId}-zone-hint`) || undefined
              }
              required
              value={selectedZoneId}
              onChange={handleZoneChange}
              className={input}
            >
              <option value="">Select zone...</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name} — ${zone.price.toFixed(2)}
                </option>
              ))}
            </select>
            {selectedZone && (
              <p id={`${fieldId}-zone-price`} className="mt-2 inline-flex rounded-full bg-mint px-3 py-1 text-sm font-bold text-navy tabular-nums">
                Delivery price: ${selectedZone.price.toFixed(2)}
              </p>
            )}
            {zoneHint && (
              <p id={`${fieldId}-zone-hint`} className="mt-1 text-xs font-medium text-muted">{zoneHint}</p>
            )}
          </div>
        )}
        <div>
          <label htmlFor={`${fieldId}-date`} className={label}>Scheduled Date *</label>
          <input
            id={`${fieldId}-date`}
            type="date"
            required
            value={scheduledDate}
            onChange={(e) => {
              setScheduledDate(e.target.value);
              clearDuplicate();
            }}
            aria-describedby={
              cn(showNextDayHint && `${fieldId}-date-hint`, anchorHint && `${fieldId}-anchor-hint`) || undefined
            }
            className={input}
          />
          {showNextDayHint && (
            <p id={`${fieldId}-date-hint`} className="mt-1 text-xs font-medium text-muted">
              After 12 PM, new orders default to the next day.
            </p>
          )}
          {anchorHint && (
            <p id={`${fieldId}-anchor-hint`} className="mt-1 text-xs font-medium text-muted">
              {anchorHint}
            </p>
          )}
        </div>
      </div>

      <DriverSelect
        drivers={drivers}
        value={selectedDriverId}
        onChange={handleDriverChange}
        autoFilledFromZone={
          !driverIsPreselected &&
          !!zoneDefaultDriverId &&
          selectedDriverId === zoneDefaultDriverId
        }
        note={
          driverIsPreselected
            ? `${drivers.find((d) => d.id === preselectedDriverId)?.name ?? "Anchor"} is selected by default — pick another driver if needed.`
            : undefined
        }
        required
      />

      <div>
        <label htmlFor={`${fieldId}-instructions`} className={label}>Delivery Instructions</label>
        <textarea
          id={`${fieldId}-instructions`}
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Leave at door, ring bell, etc."
          className={input}
        />
      </div>

      <div className="flex space-x-3 pt-4">
        <button
          type="submit"
          disabled={loading || editingSavedAddress}
          className={cn(primaryButton, ctaShadow)}
        >
          {loading ? "Creating..." : "Create Order"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className={secondaryButton}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
