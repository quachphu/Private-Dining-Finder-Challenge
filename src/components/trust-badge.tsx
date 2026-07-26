import { Badge } from "@/components/ui/badge";
import type { TrustLevel } from "@/lib/supabase/types";
import { TRUST_LABELS } from "@/lib/trust-labels";
import { cn } from "@/lib/utils";

const STYLES: Record<TrustLevel, string> = {
  confirmed_by_planner: "bg-sky-100 text-sky-900 border-sky-300 font-medium dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  likely: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  ai_extracted: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-900",
  unverified: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

// Shared with the ranking layer so a tier is never worded two different ways.
const LABELS = TRUST_LABELS;

export function TrustBadge({
  level,
  subject,
  className,
}: {
  level: TrustLevel;
  /** What this label refers to (e.g. "Capacity", "Price"). Visual pairing
   *  conveys this sighted-only, so it's announced to screen readers here. */
  subject?: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(STYLES[level], className)}
      aria-label={subject ? `${subject}: ${LABELS[level]}` : undefined}
    >
      {LABELS[level]}
    </Badge>
  );
}
