import { createServiceClient } from "@/lib/supabase/server";
import { runDiscoveryPipeline } from "@/lib/discovery/pipeline";
import { boundingBox } from "@/lib/geo/bounding-box";
import type { LatLng } from "@/lib/geo/commute";

const TTL_DAYS = 30;
const MIN_RESULTS_FLOOR = 3;
// A fixed "3 fresh venues = covered" bar doesn't scale: a driving-mode
// search can cover a ~17km-radius box, and 3 venues clustered near the
// center would wrongly mark the whole box "covered", leaving the rest
// unexplored. Scaling the bar with radius means a small walking search
// still caches aggressively (rarely re-scrapes), while a large search
// area keeps discovering until it's genuinely been explored.
const EXPECTED_VENUES_PER_METER = 1 / 600;

function expectedMinimumVenues(radiusMeters: number): number {
  return Math.max(MIN_RESULTS_FLOOR, Math.round(radiusMeters * EXPECTED_VENUES_PER_METER));
}

/**
 * Cache gate in front of the discovery pipeline. A brand-new address (or
 * one nobody has searched in TTL_DAYS, or one whose cached coverage is too
 * thin for how large the search area actually is) triggers a live
 * discover+scrape run; an address near an already-well-covered area reuses
 * what's in Supabase so repeat searches stay fast and don't hammer venue
 * websites. Re-running discovery is safe/idempotent — already-known venues
 * are upserted (refreshing last_checked_at, capacity, price, photo) rather
 * than duplicated, and genuinely new venues in the area get added.
 */
export type CoverageSummary = {
  /** false when cached coverage was fresh enough and no sites were re-fetched. */
  ranDiscovery: boolean;
  /** Venues already cached in the search box before this call. */
  cachedNearby: number;
  /** Of those, how many were re-checked inside the TTL window. */
  freshNearby: number;
  /** Candidate sites actually fetched and scraped, when discovery ran. */
  scraped: number;
};

export async function ensureCoverage(origin: LatLng, radiusMeters: number): Promise<CoverageSummary> {
  const supabase = createServiceClient();
  const box = boundingBox(origin, radiusMeters);

  const { data: nearby } = await supabase
    .from("venues")
    .select("last_checked_at")
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);

  const rows = nearby ?? [];
  const freshCutoff = Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000;
  const freshCount = rows.filter((r) => new Date(r.last_checked_at).getTime() >= freshCutoff).length;

  const base = { cachedNearby: rows.length, freshNearby: freshCount };

  if (freshCount >= expectedMinimumVenues(radiusMeters)) {
    return { ...base, ranDiscovery: false, scraped: 0 };
  }

  const { discovered } = await runDiscoveryPipeline(origin, radiusMeters);
  return { ...base, ranDiscovery: true, scraped: discovered };
}
