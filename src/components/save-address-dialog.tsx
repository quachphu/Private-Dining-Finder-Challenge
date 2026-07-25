"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { saveAddressAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AddressAutocompleteInput } from "@/components/address-autocomplete-input";

export function SaveAddressDialog({
  variant = "default",
  triggerLabel = "Add company address",
}: {
  variant?: "default" | "outline";
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        await saveAddressAction(formData);
        toast.success("Address saved");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save that address");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} className="gap-1.5" />}>
        <Plus className="size-4" />
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save a company address</DialogTitle>
          <DialogDescription>
            Give it a label your team will recognize — e.g. &ldquo;Amazon HQ West Seattle&rdquo;. Everyone with your
            workspace code will see it.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-address-label">Label</Label>
            <Input id="save-address-label" name="label" placeholder="Amazon HQ West Seattle" required autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-address-formatted">Address</Label>
            <AddressAutocompleteInput
              id="save-address-formatted"
              name="formattedAddress"
              placeholder="410 Terry Ave N, Seattle, WA 98109"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save address"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
