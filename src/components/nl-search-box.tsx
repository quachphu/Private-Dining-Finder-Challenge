import { Sparkles } from "lucide-react";
import { naturalLanguageSearchAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLE = "40 for a standing reception near Salesforce Tower, 10 minute walk max";

/**
 * Optional shortcut that sits *above* the structured form, never replacing it.
 * Whatever it parses is written into the form's own fields, so this is a faster
 * way to fill the form rather than a second, parallel search path.
 */
export function NlSearchBox({ defaultValue, status }: { defaultValue?: string; status?: string }) {
  return (
    <form action={naturalLanguageSearchAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="nlQuery"
          defaultValue={defaultValue}
          placeholder={`Describe the event — e.g. "${EXAMPLE}"`}
          className="flex-1"
          aria-label="Describe your event in your own words"
        />
        <Button type="submit" variant="secondary" className="gap-1.5">
          <Sparkles className="size-4" />
          Fill the form
        </Button>
      </div>
      <NlStatus status={status} />
    </form>
  );
}

function NlStatus({ status }: { status?: string }) {
  if (status === "parsed") {
    return (
      <p className="text-xs text-muted-foreground">
        Filled in below from your description — check the fields before searching. Anything you didn&apos;t mention was
        left at its default.
      </p>
    );
  }

  if (status === "empty") {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t pick out a location, headcount, or travel time from that. Fill the fields in below instead.
      </p>
    );
  }

  if (status === "failed") {
    return (
      <p className="text-xs text-muted-foreground">
        The language model didn&apos;t respond, so nothing was filled in. The fields below work on their own.
      </p>
    );
  }

  if (status === "unconfigured") {
    return (
      <p className="text-xs text-muted-foreground">
        Free-text parsing needs an <code>XAI_API_KEY</code>. Everything below works without it.
      </p>
    );
  }

  return null;
}
