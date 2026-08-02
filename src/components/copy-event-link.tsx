"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one control in the app that's actually meant to be handed to someone
 * outside the workspace. Everywhere else, "the code" (shown in the nav bar)
 * is how a teammate rejoins the same workspace — search history, shortlist,
 * everything. An attendee who's given that same code and told to "join"
 * lands on the full team platform by mistake, when all they needed was
 * `/event/[code]`, which is already public on its own (see EventPage).
 *
 * Copies the full URL rather than the bare code, and computed client-side
 * from window.location so it's correct on whatever host this is actually
 * running on (localhost, a preview deploy, a custom domain) without the
 * server needing to know its own origin.
 */
export function CopyEventLink({
  code,
  label = "Copy invite link",
  variant = "outline",
  size = "sm",
  className,
}: {
  code: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/event/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied — this is what attendees should open, not the workspace code.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(`Couldn't copy automatically — here's the link: ${url}`);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={handleCopy} className={cn("shrink-0", className)}>
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}
