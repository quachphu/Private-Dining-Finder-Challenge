import { Suspense } from "react";
import { Check, Loader2, MapPin, ScanSearch, SlidersHorizontal, X } from "lucide-react";
import { countConfirmedCapacities } from "@/lib/ranking";
import type { SearchStages } from "@/lib/search-stages";
import { cn } from "@/lib/utils";

/**
 * A live readout of the search pipeline, streamed stage by stage.
 *
 * Each row is its own Suspense boundary awaiting one stage's promise, so a row
 * flips from spinner to result at the exact moment that stage finishes on the
 * server. The panel stays visible after results load rather than disappearing:
 * "we re-checked 18 sites just now, 4 of 9 results are venue-confirmed" is
 * provenance a planner deciding whether to trust this list actually wants.
 */
type RowState = "pending" | "done" | "failed";

function StageRow({
  icon: Icon,
  label,
  detail,
  state,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: React.ReactNode;
  state: RowState;
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          state === "failed" && "bg-destructive/15 text-destructive",
          state === "pending" && "bg-muted text-muted-foreground"
        )}
      >
        {state === "pending" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : state === "failed" ? (
          <X className="size-3" />
        ) : (
          <Check className="size-3" />
        )}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("inline-flex items-center gap-1.5", state === "pending" && "text-muted-foreground")}>
          <Icon className="size-3.5 opacity-60" />
          {label}
        </span>
        {detail && <span className="text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );
}

async function OriginRow({ stages }: { stages: SearchStages }) {
  const origin = await stages.origin;
  return (
    <StageRow
      icon={MapPin}
      label={origin ? "Located the address" : "Couldn't locate that address"}
      detail={origin?.label}
      state={origin ? "done" : "failed"}
    />
  );
}

async function CoverageRow({ stages }: { stages: SearchStages }) {
  const coverage = await stages.coverage;

  if (!coverage) return <StageRow icon={ScanSearch} label="Skipped site checks — no address to search around" state="failed" />;

  return (
    <StageRow
      icon={ScanSearch}
      label={coverage.ranDiscovery ? "Checked venue websites directly" : "Reused recent checks for this area"}
      detail={
        coverage.ranDiscovery
          ? `fetched and read ${coverage.scraped} ${coverage.scraped === 1 ? "site" : "sites"}`
          : `${coverage.freshNearby} ${coverage.freshNearby === 1 ? "venue" : "venues"} checked within the last 30 days`
      }
      state="done"
    />
  );
}

async function RankRow({ stages }: { stages: SearchStages }) {
  const outcome = await stages.outcome;

  if (outcome.error) return <StageRow icon={SlidersHorizontal} label="Ranking skipped" state="failed" />;

  const confirmed = countConfirmedCapacities(outcome.results);
  const total = outcome.results.length;

  return (
    <StageRow
      icon={SlidersHorizontal}
      label="Measured commute and ranked by fit"
      detail={
        total === 0
          ? "nothing in range matched"
          : `${confirmed} of ${total} ${total === 1 ? "result has" : "results have"} a capacity confirmed on the venue's own site`
      }
      state="done"
    />
  );
}

export function SearchPipeline({ stages }: { stages: SearchStages }) {
  return (
    <ol className="flex flex-col gap-2 rounded-xl border bg-card/60 p-4">
      <Suspense fallback={<StageRow icon={MapPin} label="Locating the address" state="pending" />}>
        <OriginRow stages={stages} />
      </Suspense>
      <Suspense
        fallback={
          <StageRow
            icon={ScanSearch}
            label="Reading venue websites for private-dining details"
            detail="this is the slow part — we fetch each venue's own site rather than trusting a directory"
            state="pending"
          />
        }
      >
        <CoverageRow stages={stages} />
      </Suspense>
      <Suspense fallback={<StageRow icon={SlidersHorizontal} label="Measuring commute and ranking by fit" state="pending" />}>
        <RankRow stages={stages} />
      </Suspense>
    </ol>
  );
}
