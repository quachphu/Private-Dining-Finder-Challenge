import { Badge } from "@/components/ui/badge";
import type { TrustLevel } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const STYLES: Record<TrustLevel, string> = {
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
  likely: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  unverified: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800",
};

const LABELS: Record<TrustLevel, string> = {
  verified: "Verified",
  likely: "Likely",
  unverified: "Needs a call",
};

export function TrustBadge({ level, className }: { level: TrustLevel; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STYLES[level], className)}>
      {LABELS[level]}
    </Badge>
  );
}
