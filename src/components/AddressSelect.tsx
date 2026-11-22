"use client";

import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { usePatientAddresses, type SavedAddress } from "@/hooks/usePatientAddresses";
import { SavedAddressManager } from "@/components/SavedAddressManager";
import { DuplicatePatientsNotice } from "@/components/DuplicatePatientsNotice";
import {
  cn,
  input,
  inputReadOnly,
  label,
  primaryButton,
  secondaryButton,
  softButton,
} from "@/lib/portalStyles";

export interface AddressValue {
  addressId: string | null;
  address: string;
  city: string;
  postalCode: string;
}

interface GoogleSuggestion {
  placeId: string;
  description: string;
}

interface GoogleDetails {
  address: string;
  city: string;
  postalCode: string;
  formattedAddress: string;
}

interface GoogleUnavailableResponse {
  suggestions?: GoogleSuggestion[];
  unavailable?: boolean;
  message?: string;
  reason?: string;
}

interface Props {
  storeSlug: string;
  patientId: string | null;
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  saveToPatient: boolean;
  onSaveToPatientChange: (b: boolean) => void;
  preferredAddressId?: string | null;
  onEditingSavedAddressChange?: (editing: boolean) => void;
}

const NEW_ADDRESS = "__new__";
const EMPTY_ADDRESS: AddressValue = {
  addressId: null,
  address: "",
  city: "",
  postalCode: "",
};

function toAddressValue(address: SavedAddress): AddressValue {
  return {
    addressId: address.id,
    address: address.address,
    city: address.city,
    postalCode: address.postalCode,
  };
}

function savedAddressText(address: SavedAddress) {
  return `${address.address} ${address.city} ${address.postalCode}`.toLowerCase();
}

function getSessionToken() {
  return crypto.randomUUID();
}

function AddressSelectInner({
  storeSlug,
  patientId,
  value,
  onChange,
  saveToPatient,
  onSaveToPatientChange,
  preferredAddressId = null,
  onEditingSavedAddressChange,
}: Props) {
  const fieldId = useId();
  const { addresses, loading, refresh } = usePatientAddresses(storeSlug, patientId);

  const handleSavedAddressesChanged = async (deletedAddressId?: string) => {
    // Reload first, so the auto-select below picks from the updated list and
    // can never re-select the address that was just deleted.
    await refresh();
    if (deletedAddressId && value.addressId === deletedAddressId) {
      onChange(EMPTY_ADDRESS);
    }
  };
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddressValue>(EMPTY_ADDRESS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [googleSuggestions, setGoogleSuggestions] = useState<GoogleSuggestion[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
  const [addressTouchedForGoogle, setAddressTouchedForGoogle] = useState(false);
  const sessionTokenRef = useRef<string | null>(null);

  const defaultAddressId = useMemo(
    () => addresses.find((a) => a.isDefault)?.id ?? null,
    [addresses]
  );

  const selectedAddress = useMemo(
    () => addresses.find((a) => a.id === value.addressId) ?? null,
    [addresses, value.addressId]
  );

  // Auto-select the matched address from search, then the default address.
  useEffect(() => {
    if (editingAddressId) return;
    if (!patientId) return;
    if (value.addressId) return;
    if (value.address || value.city || value.postalCode) return;

    const preferred = preferredAddressId
      ? addresses.find((a) => a.id === preferredAddressId)
      : null;
    const fallback = defaultAddressId
      ? addresses.find((a) => a.id === defaultAddressId)
      : null;
    const address = preferred ?? fallback;

    if (address) onChange(toAddressValue(address));
  }, [
    patientId,
    preferredAddressId,
    defaultAddressId,
    addresses,
    value.addressId,
    value.address,
    value.city,
    value.postalCode,
    editingAddressId,
    onChange,
  ]);

  const resetGoogleSuggestions = () => {
    sessionTokenRef.current = null;
    setGoogleSuggestions([]);
    setGoogleLoading(false);
    setGoogleError("");
    setDetailsLoadingId(null);
    setAddressTouchedForGoogle(false);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setEditingAddressId(null);
    setDraft(EMPTY_ADDRESS);
    setSaveError("");
    resetGoogleSuggestions();
    onEditingSavedAddressChange?.(false);
    if (id === NEW_ADDRESS) {
      onChange(EMPTY_ADDRESS);
      return;
    }
    const a = addresses.find((x) => x.id === id);
    if (a) {
      onChange(toAddressValue(a));
    }
  };

  const startEdit = () => {
    if (!value.addressId) return;
    setDraft(value);
    setEditingAddressId(value.addressId);
    setSaveError("");
    resetGoogleSuggestions();
    onEditingSavedAddressChange?.(true);
  };

  const cancelEdit = () => {
    setEditingAddressId(null);
    setDraft(EMPTY_ADDRESS);
    setSaveError("");
    resetGoogleSuggestions();
    onEditingSavedAddressChange?.(false);
  };

  const updateAddressField = (field: keyof Omit<AddressValue, "addressId">, text: string) => {
    if (field === "address") {
      setAddressTouchedForGoogle(true);
    }

    if (editingAddressId) {
      setDraft((current) => ({ ...current, [field]: text }));
      return;
    }

    onChange({ ...value, [field]: text });
  };

  const selectSavedAddress = (address: SavedAddress) => {
    resetGoogleSuggestions();
    onSaveToPatientChange(false);
    onChange(toAddressValue(address));
  };

  const selectGoogleSuggestion = async (suggestion: GoogleSuggestion) => {
    const sessionToken = sessionTokenRef.current ?? getSessionToken();
    sessionTokenRef.current = sessionToken;
    setDetailsLoadingId(suggestion.placeId);
    setGoogleError("");

    try {
      const params = new URLSearchParams({
        placeId: suggestion.placeId,
        sessionToken,
      });
      const res = await fetch(`/api/${storeSlug}/places/details?${params.toString()}`);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as GoogleUnavailableResponse;
        setGoogleError(body.message || "Address details unavailable");
        return;
      }

      const details = (await res.json()) as GoogleDetails;
      const nextAddress: AddressValue = {
        addressId: editingAddressId,
        address:
          details.address ||
          details.formattedAddress.split(",")[0]?.trim() ||
          suggestion.description,
        city: details.city || displayValue.city,
        postalCode: details.postalCode || displayValue.postalCode,
      };

      if (editingAddressId) {
        setDraft(nextAddress);
      } else {
        onChange({ ...nextAddress, addressId: null });
      }

      resetGoogleSuggestions();
    } catch {
      setGoogleError("Address details unavailable");
    } finally {
      setDetailsLoadingId(null);
    }
  };

  const saveEdit = async () => {
    if (!patientId || !editingAddressId) return;
    setSaving(true);
    setSaveError("");

    try {
      const res = await fetch(
        `/api/${storeSlug}/patients/${patientId}/addresses/${editingAddressId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: selectedAddress?.label ?? "Saved",
            address: draft.address,
            city: draft.city,
            postalCode: draft.postalCode,
            isDefault: selectedAddress?.isDefault,
          }),
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body?.error || "Failed to save address");
        return;
      }

      const updated = (await res.json()) as SavedAddress;
      onChange(toAddressValue(updated));
      await refresh();
      cancelEdit();
    } catch {
      setSaveError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  const isEditing = !value.addressId || !!editingAddressId;
  const showPicker = !!patientId && addresses.length > 0;
  const displayValue = editingAddressId ? draft : value;
  const addressQuery = displayValue.address.trim();
  const normalizedAddressQuery = addressQuery.toLowerCase();

  const matchingSavedAddresses = useMemo(() => {
    if (!patientId || value.addressId || editingAddressId || normalizedAddressQuery.length < 3) {
      return [];
    }

    return addresses
      .filter((address) => savedAddressText(address).includes(normalizedAddressQuery))
      .slice(0, 5);
  }, [addresses, editingAddressId, normalizedAddressQuery, patientId, value.addressId]);

  const googleLookupAllowed =
    isEditing &&
    addressTouchedForGoogle &&
    normalizedAddressQuery.length >= 3 &&
    (!!editingAddressId || (!value.addressId && matchingSavedAddresses.length === 0));

  useEffect(() => {
    if (!googleLookupAllowed) {
      setGoogleSuggestions([]);
      setGoogleLoading(false);
      setGoogleError("");
      return;
    }

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = getSessionToken();
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setGoogleLoading(true);
      setGoogleError("");

      try {
        const params = new URLSearchParams({
          input: addressQuery,
          sessionToken: sessionTokenRef.current ?? getSessionToken(),
        });
        const res = await fetch(
          `/api/${storeSlug}/places/autocomplete?${params.toString()}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          setGoogleSuggestions([]);
          const body = (await res.json().catch(() => ({}))) as GoogleUnavailableResponse;
          setGoogleError(body.message || "Address suggestions unavailable");
          return;
        }

        const body = (await res.json()) as GoogleUnavailableResponse;

        setGoogleSuggestions(body.suggestions ?? []);
        setGoogleError(body.unavailable ? body.message || "Address suggestions unavailable" : "");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setGoogleSuggestions([]);
        setGoogleError("Address lookup failed. Please try manual entry or check setup.");
      } finally {
        if (!controller.signal.aborted) {
          setGoogleLoading(false);
        }
      }
    }, 400);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [addressQuery, googleLookupAllowed, storeSlug]);

  return (
    <div className="space-y-3">
      {patientId && (
        <DuplicatePatientsNotice
          storeSlug={storeSlug}
          patientId={patientId}
          onMerged={() => refresh()}
        />
      )}
      {showPicker && (
        <div>
          <label htmlFor={`${fieldId}-saved`} className={label}>Saved address</label>
          <select
            id={`${fieldId}-saved`}
            value={value.addressId ?? NEW_ADDRESS}
            onChange={handleSelect}
            className={input}
          >
            {addresses.map((a: SavedAddress) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.address}, {a.city} {a.postalCode}
                {a.isDefault ? " (default)" : ""}
              </option>
            ))}
            <option value={NEW_ADDRESS}>+ New address…</option>
          </select>
        </div>
      )}
      {showPicker && patientId && !editingAddressId && (
        <SavedAddressManager
          storeSlug={storeSlug}
          patientId={patientId}
          addresses={addresses}
          onChanged={handleSavedAddressesChanged}
        />
      )}
      {loading && patientId && (
        <p className="text-xs text-muted">Loading saved addresses...</p>
      )}

      <div>
        <label htmlFor={`${fieldId}-address`} className={label}>Delivery address *</label>
        <input
          id={`${fieldId}-address`}
          required
          value={displayValue.address}
          readOnly={!isEditing}
          onChange={(e) => updateAddressField("address", e.target.value)}
          className={cn(input, !isEditing && inputReadOnly)}
        />
      </div>

      {isEditing && matchingSavedAddresses.length > 0 && (
        <div className="rounded-row border border-hairline bg-white shadow-soft overflow-hidden">
          <div className="px-3 py-2 text-xs font-bold uppercase tracking-label text-navy bg-blue">
            Saved matches
          </div>
          {matchingSavedAddresses.map((address) => (
            <button
              key={address.id}
              type="button"
              onClick={() => selectSavedAddress(address)}
              className="row-hover block w-full border-t border-hairline px-3 py-2 text-left"
            >
              <span className="block text-sm font-semibold text-navy">
                {address.label}
              </span>
              <span className="block text-xs text-muted">
                {address.address}, {address.city} {address.postalCode}
              </span>
            </button>
          ))}
        </div>
      )}

      {isEditing && (googleSuggestions.length > 0 || googleLoading || googleError) && (
        <div className="rounded-row border border-hairline bg-white shadow-soft overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 text-xs font-bold uppercase tracking-label text-navy bg-mint">
            <span>Google suggestions</span>
            <span className="normal-case tracking-normal font-semibold text-navy">
              Powered by Google
            </span>
          </div>
          {googleLoading && (
            <div className="border-t border-hairline px-3 py-2 text-sm text-muted">
              Searching addresses...
            </div>
          )}
          {googleSuggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              onClick={() => selectGoogleSuggestion(suggestion)}
              disabled={detailsLoadingId === suggestion.placeId}
              className="row-hover block w-full border-t border-hairline px-3 py-2 text-left text-sm text-navy disabled:cursor-wait disabled:opacity-60"
            >
              {detailsLoadingId === suggestion.placeId
                ? "Loading address..."
                : suggestion.description}
            </button>
          ))}
          {googleError && !googleLoading && (
            <div className="border-t border-hairline px-3 py-2 text-sm text-muted">
              {googleError}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${fieldId}-city`} className={label}>City *</label>
          <input
            id={`${fieldId}-city`}
            required
            value={displayValue.city}
            readOnly={!isEditing}
            onChange={(e) => updateAddressField("city", e.target.value)}
            className={cn(input, !isEditing && inputReadOnly)}
          />
        </div>
        <div>
          <label htmlFor={`${fieldId}-postal`} className={label}>Postal code *</label>
          <input
            id={`${fieldId}-postal`}
            required
            value={displayValue.postalCode}
            readOnly={!isEditing}
            onChange={(e) => updateAddressField("postalCode", e.target.value)}
            className={cn(input, !isEditing && inputReadOnly)}
          />
        </div>
      </div>

      {value.addressId && !editingAddressId && (
        <button type="button" onClick={startEdit} className={softButton}>
          Edit saved address
        </button>
      )}

      {editingAddressId && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={saveEdit}
            disabled={saving}
            className={primaryButton}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className={secondaryButton}
          >
            Cancel
          </button>
          {saveError && <span className="text-sm text-danger">{saveError}</span>}
        </div>
      )}

      {!value.addressId && !editingAddressId && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={saveToPatient}
            onChange={(e) => onSaveToPatientChange(e.target.checked)}
            className="h-4 w-4 accent-navy"
          />
          <span>Save this address for future orders</span>
        </label>
      )}
    </div>
  );
}

export const AddressSelect = memo(AddressSelectInner);
