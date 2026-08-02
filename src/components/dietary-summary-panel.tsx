"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, ClipboardCheck, Copy, Loader2, Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { generateDietarySummaryAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import type { DietaryNeedKind, DietarySummaryRow } from "@/lib/supabase/types";

const KIND_LABELS: Record<DietaryNeedKind, string> = {
  allergy: "Allergy",
  intolerance: "Intolerance",
  preference: "Preference",
  unclear: "Unclear",
};

// An allergy and a preference are the same sentence to a chat thread and very
// different instructions to a kitchen, so they must not look alike here.
const KIND_STYLES: Record<DietaryNeedKind, string> = {
  allergy: "border-destructive/30 bg-destructive/10 text-destructive",
  intolerance: "border-amber-600/30 bg-amber-50 text-amber-700",
  preference: "border-foreground/15 bg-muted text-muted-foreground",
  unclear: "border-dashed border-foreground/25 bg-transparent text-muted-foreground",
};

function describeNeeds(needs: { item: string; kind: DietaryNeedKind }[]): string {
  return needs.map((need) => `${need.item} (${KIND_LABELS[need.kind].toLowerCase()})`).join(", ");
}

function toPlainText(summary: DietarySummaryRow["summary"], venueName: string): string {
  const lines = [`Dietary requirements for our group at ${venueName}`, ""];
  if (summary.orderNote) lines.push(summary.orderNote, "");

  const allergies = summary.people.flatMap((person) =>
    person.needs.filter((need) => need.kind === "allergy").map((need) => `- ${person.name}: ${need.item}`)
  );
  if (allergies.length > 0) {
    lines.push("Allergies (must reach the kitchen):", ...allergies, "");
  }

  if (summary.aggregate.length > 0) {
    lines.push("Totals:");
    for (const row of summary.aggregate) lines.push(`- ${row.requirement}: ${row.count}`);
    lines.push("");
  }
  if (summary.people.length > 0) {
    lines.push("By person:");
    for (const person of summary.people) lines.push(`- ${person.name}: ${describeNeeds(person.needs)}`);
    lines.push("");
  }
  if (summary.unclear.length > 0) {
    lines.push("Needs following up:");
    for (const entry of summary.unclear) lines.push(`- ${entry}`);
  }
  return lines.join("\n").trim();
}

/**
 * Turns the event thread into something a host can act on: totals to order
 * against, a per-person list, and a paragraph to send the venue.
 *
 * Generated on demand rather than live. A roster that silently rewrites itself
 * as replies trickle in is one a host can't safely forward — they need to know
 * exactly what they read and sent. So each run is a snapshot, and the panel
 * says plainly when newer replies exist rather than folding them in quietly.
 *
 * Every entry keeps the attendee's own wording, and the whole panel is labeled
 * as machine-read: the host is the one accountable for an allergy reaching the
 * kitchen, so the extraction is presented as a draft to check, never as fact.
 */
export function DietarySummaryPanel({
  code,
  venueName,
  venueEmail,
  latest,
  replyCount,
}: {
  code: string;
  venueName: string;
  venueEmail: string | null;
  latest: DietarySummaryRow | null;
  replyCount: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  const summary = latest?.summary ?? null;
  const newReplies = latest ? Math.max(replyCount - latest.message_count, 0) : replyCount;
  // Flattened per item, not per person: someone who said "no pork, and I'm
  // allergic to peanuts" belongs in this list for the peanuts only.
  const allergies =
    summary?.people.flatMap((person) =>
      person.needs.filter((need) => need.kind === "allergy").map((need) => ({ name: person.name, item: need.item }))
    ) ?? [];

  function handleGenerate() {
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("code", code);
        await generateDietarySummaryAction(formData);
        toast.success("Dietary roster updated.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not summarize the replies.");
      }
    });
  }

  async function handleCopy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(toPlainText(summary, venueName));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually.");
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Dietary roster</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {latest
              ? `Read from ${latest.message_count} ${latest.message_count === 1 ? "reply" : "replies"} by AI — check it against what people wrote before you send it to the venue.`
              : "Once people have replied below, build a list you can hand to the venue."}
          </p>
        </div>
        <Button type="button" size="sm" onClick={handleGenerate} disabled={isPending || replyCount === 0}>
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {latest ? "Update roster" : "Build roster"}
        </Button>
      </div>

      {latest && newReplies > 0 && (
        <p className="rounded-lg border border-amber-600/30 bg-amber-50 p-2.5 text-xs text-amber-800">
          {newReplies} {newReplies === 1 ? "reply has" : "replies have"} come in since this was built — update it before
          you order.
        </p>
      )}

      {!summary ? (
        <p className="text-sm text-muted-foreground">
          {replyCount === 0
            ? "No replies yet. Share this page with everyone coming and ask them to name anything they can't eat."
            : `${replyCount} ${replyCount === 1 ? "person has" : "people have"} replied. Build the roster to group it by requirement.`}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {allergies.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                Stated allergies — must reach the kitchen
              </div>
              <ul className="flex flex-col gap-0.5 text-sm">
                {allergies.map((entry) => (
                  <li key={`${entry.name}-${entry.item}`}>
                    <span className="font-medium">{entry.name}</span> — {entry.item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.aggregate.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Totals to order against</h3>
              <div className="flex flex-wrap gap-1.5">
                {summary.aggregate.map((row) => (
                  <Badge key={row.requirement} variant="secondary" className="font-normal">
                    {row.requirement} · {row.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {summary.people.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">By person</h3>
              <ul className="flex flex-col divide-y">
                {summary.people.map((person) => (
                  <li key={person.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
                    <span className="font-medium">{person.name}</span>
                    {person.needs.map((need) => (
                      <span
                        key={need.item}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px]", KIND_STYLES[need.kind])}
                      >
                        {need.item} · {KIND_LABELS[need.kind]}
                      </span>
                    ))}
                    {person.quote && (
                      <span className="block w-full text-xs text-muted-foreground">“{person.quote}”</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.unclear.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Ask again about these</h3>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {summary.unclear.map((entry) => (
                  <li key={entry}>“{entry}”</li>
                ))}
              </ul>
            </div>
          )}

          {summary.orderNote && (
            <div className="rounded-lg bg-muted/60 p-3">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">For the venue</h3>
              <p className="text-sm leading-relaxed">{summary.orderNote}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
                  {copied ? <ClipboardCheck className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy roster"}
                </Button>
                {/* Composes a draft, never sends: contacting the venue stays a
                    deliberate human act, as everywhere else in this tool. */}
                {venueEmail && (
                  <a
                    href={`mailto:${venueEmail}?subject=${encodeURIComponent(`Dietary requirements for our group at ${venueName}`)}&body=${encodeURIComponent(toPlainText(summary, venueName))}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    <Mail className="size-4" />
                    Draft email to venue
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
