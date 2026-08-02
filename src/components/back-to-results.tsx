"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { readLastSearch } from "@/lib/last-search";
import { cn } from "@/lib/utils";

/**
 * Returns to the ranked results the planner came from, with their address,
 * headcount and commute window intact.
 *
 * The destination is resolved on click rather than on mount so it always
 * reflects the most recent search, and so this renders identically on the
 * server and the client. Falls back to a bare /search when there's nothing
 * remembered (a fresh tab, or a shared link opened cold).
 */
export function BackToResults({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        const query = readLastSearch();
        router.push(query ? `/search?${query}` : "/search");
      }}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
    >
      <ArrowLeft className="size-4" />
      Back to results
    </button>
  );
}
