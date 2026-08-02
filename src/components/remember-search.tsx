"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { LAST_SEARCH_STORAGE_KEY } from "@/lib/last-search";

/**
 * Records the parameters of a search that actually produced results, so the
 * shortlist can offer a way back to that exact list instead of a blank form.
 *
 * Rendered only alongside real results — a bare /search visit shouldn't
 * overwrite the criteria the planner last searched with. Keyed on
 * searchParams so refining a search in place updates what "back" means.
 */
export function RememberSearch() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    if (!query) return;
    try {
      window.sessionStorage.setItem(LAST_SEARCH_STORAGE_KEY, query);
    } catch {
      // Storage unavailable; the back link degrades to a bare /search.
    }
  }, [searchParams]);

  return null;
}
