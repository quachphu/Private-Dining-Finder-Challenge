"use client";

import { useRouter } from "next/navigation";

/**
 * A plain `<Link href="/search">` here would drop whatever address/headcount/
 * commute the planner had searched with, forcing a re-fill and a full pipeline
 * re-run just to see the list they were already looking at. Going back through
 * history instead returns to the exact search URL, which Next's router cache
 * can usually restore without hitting the server again.
 */
export function BackToSearch() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      ← Back to search
    </button>
  );
}
