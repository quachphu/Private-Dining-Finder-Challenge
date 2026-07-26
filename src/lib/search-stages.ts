import "server-only";
import {
  completeSearch,
  ensureSearchCoverage,
  ORIGIN_NOT_FOUND,
  resolveSearchOrigin,
  type SearchInput,
  type SearchOutcome,
} from "@/lib/search";
import type { CoverageSummary } from "@/lib/discovery/ensure-coverage";
import type { LatLng } from "@/lib/geo/commute";

/**
 * The same search, exposed as three promises that settle in order, so the UI
 * can show what the pipeline is really doing while it does it.
 *
 * The point is that each stage's status is *observed*, not animated. A timed
 * client-side sequence would be easy and would look identical on a good run —
 * and would lie on a bad one, cheerfully reporting "cross-referencing sources"
 * for a venue whose site 404'd. Since the slow part here is genuinely slow
 * (fetching and parsing a couple dozen restaurant websites), there's real
 * information to show, and showing it beats a spinner.
 *
 * Work is started once, eagerly, and each promise is shared: the page awaits
 * all three inside separate Suspense boundaries, and React streams each
 * boundary in as its promise settles. Nothing runs twice.
 */
export type SearchStages = {
  origin: Promise<(LatLng & { label: string }) | null>;
  coverage: Promise<CoverageSummary | null>;
  outcome: Promise<SearchOutcome>;
};

export function startSearchStages(input: SearchInput): SearchStages {
  const origin = resolveSearchOrigin(input);

  const coverage = origin.then((resolved) => (resolved ? ensureSearchCoverage(resolved, input) : null));

  const outcome = Promise.all([origin, coverage]).then(([resolved]) => {
    if (!resolved) {
      return { origin: { lat: 0, lng: 0, label: "" }, results: [], searchId: null, error: ORIGIN_NOT_FOUND };
    }
    return completeSearch(input, resolved);
  });

  return { origin, coverage, outcome };
}