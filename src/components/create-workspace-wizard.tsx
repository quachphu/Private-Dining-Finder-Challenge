"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, MapPin, Pencil } from "lucide-react";
import { joinOrCreateWorkspaceAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";

/**
 * Creating a workspace starts from the office address, not the company
 * name: step 1 captures "what address, under what label" (e.g. Amazon HQ
 * West Seattle), step 2 names the workspace and submits. Both steps write
 * into the same underlying <form> via hidden inputs mirroring state, so
 * the final submit (a real server action) has everything it needs in one
 * request — no client-side redirect handling required.
 */
export function CreateWorkspaceWizard() {
  const [step, setStep] = useState<1 | 2>(1);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [displayName, setDisplayNameValue] = useState("");
  const [touched, setTouched] = useState(false);

  const step1Valid = label.trim().length > 0 && address.trim().length > 0;

  function handleContinue() {
    setTouched(true);
    if (step1Valid) setStep(2);
  }

  return (
    <form action={joinOrCreateWorkspaceAction} className="flex flex-col gap-4 pt-4">
      <input type="hidden" name="mode" value="create" />
      <input type="hidden" name="addressLabel" value={label} />
      <input type="hidden" name="addressQuery" value={address} />
      <input type="hidden" name="companyName" value={companyName} />
      <input type="hidden" name="displayName" value={displayName} />

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={step === 1 ? "font-medium text-foreground" : ""}>1. Office address</span>
        <span className="h-px flex-1 bg-border" />
        <span className={step === 2 ? "font-medium text-foreground" : ""}>2. Workspace name</span>
      </div>

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wiz-label">Label</Label>
            <Input
              id="wiz-label"
              placeholder="Amazon HQ West Seattle"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wiz-address">Office address</Label>
            <AddressAutocompleteInput
              id="wiz-address"
              placeholder="410 Terry Ave N, Seattle, WA 98109"
              value={address}
              onValueChange={setAddress}
            />
            {touched && !step1Valid && (
              <p className="text-xs text-destructive">Add a label and an address to continue.</p>
            )}
          </div>
          <Button type="button" onClick={handleContinue} className="mt-1 w-full gap-1.5">
            Continue
            <ArrowRight className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-left text-sm transition-colors duration-150 hover:bg-muted"
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              <span className="block font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{address}</span>
            </span>
            <Pencil className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          </button>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wiz-company">Workspace name</Label>
            <Input
              id="wiz-company"
              placeholder="Nowadays"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wiz-name">Your name</Label>
            <Input
              id="wiz-name"
              placeholder="You're the workspace organizer"
              value={displayName}
              onChange={(e) => setDisplayNameValue(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              You&apos;ll be shown as this workspace&apos;s organizer.
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)} className="gap-1.5">
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={companyName.trim().length === 0 || displayName.trim().length === 0}
            >
              Create workspace
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You&apos;ll get a shareable code afterward — send it to teammates so everyone sees the same saved
            addresses, searches, and shortlist.
          </p>
        </div>
      )}
    </form>
  );
}
