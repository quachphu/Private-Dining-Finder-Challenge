"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { deleteSavedAddressAction } from "@/app/actions";
import { Label } from "@/components/ui/label";
import { SaveAddressDialog } from "@/components/save-address-dialog";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";
import { cn } from "@/lib/utils";
import type { SavedAddressRow } from "@/lib/supabase/types";

/**
 * Fully controlled selection (a single hidden input, driven by React
 * state) rather than relying on native radio-button-across-form-boundary
 * behavior — this removes any ambiguity about whether a click actually
 * registered as a selection before the search form submits. Delete
 * buttons stay as their own small <form>s (siblings, not nested) so they
 * don't interfere with the search form's submission at all.
 */
export function AddressPicker({
  searchFormId,
  addresses,
  selectedSavedAddressId,
  addressQueryDefault,
  defaultToFirstSaved = false,
}: {
  searchFormId: string;
  addresses: SavedAddressRow[];
  selectedSavedAddressId?: string;
  addressQueryDefault?: string;
  /** Pre-select the first saved address on a pristine page load (no search
   * attempted yet) so a company with one office doesn't have to click it
   * every time — but never overrides an explicit choice already made
   * (including an explicit "new address" search). */
  defaultToFirstSaved?: boolean;
}) {
  const initialSelectedId = selectedSavedAddressId ?? (defaultToFirstSaved ? addresses[0]?.id ?? "" : "");
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [addressText, setAddressText] = useState(initialSelectedId ? "" : addressQueryDefault ?? "");

  function selectSaved(id: string) {
    setSelectedId(id);
    setAddressText("");
  }

  function selectManual() {
    setSelectedId("");
  }

  function handleAddressChange(next: string) {
    setAddressText(next);
    if (next.trim().length > 0 && selectedId) setSelectedId("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium text-foreground">Where are you searching from?</Label>
        <SaveAddressDialog variant="outline" triggerLabel="Save an address" />
      </div>

      <input type="hidden" form={searchFormId} name="savedAddressId" value={selectedId} />

      {addresses.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {addresses.map((addr) => (
            <div key={addr.id} className="group relative">
              <button
                type="button"
                onClick={() => selectSaved(addr.id)}
                className={cn(
                  "w-full rounded-lg border p-3 pr-7 text-left transition-colors duration-150 hover:border-foreground/30",
                  selectedId === addr.id && "border-foreground bg-muted shadow-sm"
                )}
              >
                <div className="flex items-center gap-1.5">
                  {selectedId === addr.id && <Check className="size-3.5 shrink-0" />}
                  <div className="truncate text-sm font-medium">{addr.label}</div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{addr.formatted_address}</div>
              </button>
              <form
                action={deleteSavedAddressAction}
                className="absolute top-1 right-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              >
                <input type="hidden" name="id" value={addr.id} />
                <button
                  type="submit"
                  aria-label={`Remove ${addr.label}`}
                  className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-background hover:text-destructive active:scale-90"
                >
                  <X className="size-3.5" />
                </button>
              </form>
            </div>
          ))}

          <button
            type="button"
            onClick={selectManual}
            className={cn(
              "rounded-lg border border-dashed p-3 text-left text-muted-foreground transition-colors duration-150 hover:border-foreground/30",
              selectedId === "" && "border-foreground bg-muted text-foreground shadow-sm"
            )}
          >
            <div className="flex items-center gap-1.5">
              {selectedId === "" && <Check className="size-3.5 shrink-0" />}
              <div className="text-sm font-medium">Enter a new address</div>
            </div>
            <div className="text-xs">One-off search</div>
          </button>
        </div>
      )}

      <AddressAutocompleteInput
        form={searchFormId}
        name="addressQuery"
        placeholder="e.g. Times Square, New York, NY"
        value={addressText}
        onValueChange={handleAddressChange}
      />
    </div>
  );
}
