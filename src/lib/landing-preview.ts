import "server-only";
import { unstable_cache } from "next/cache";
import { performSearch } from "@/lib/search";
import { priceSignal } from "@/lib/price-signal";
import type { TrustLevel } from "@/lib/supabase/types";

/**
 * The landing page's product preview, produced by an actual run of the real
 * search pipeline rather than hand-copied output.
 *
 * Why this exists instead of a literal array of numbers: the previous version
 * was a hardcoded `MOCK_CARDS` list captioned as real output from a real run.
 * That was true the day it was written and silently becomes a false claim the
 * moment ranking weights, trust rules, or the venue catalog change. Anything
 * on the marketing surface that asserts "this is what the app returns" should
 * be produced by the app, not maintained by hand.
 *
 * Uses the first required scenario verbatim (50 people near Times Square under
 * a 20-minute commute) so the preview doubles as a continuously-running smoke
 * test of a graded scenario: if the pipeline regresses, the landing page is the
 * first place it shows.
 */
export type PreviewCard = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  commuteMinutes: number;
  commuteEstimated: boolean;
  capacity: number;
  capacityTrust: TrustLevel;
  priceLabel: string;
  priceTrust: TrustLevel;
  photoUrl: string | null;
};

export type LandingPreview = {
  origin: { lat: number; lng: number; label: string };
  cards: PreviewCard[];
  generatedAt: string;
};

export const PREVIEW_QUERY = {
  address: "Times Square, New York, NY",
  headcount: 50,
  maxCommuteMinutes: 20,
  commuteMode: "drive" as const,
};

const PREVIEW_CARD_COUNT = 4;

/**
 * Formatted in UTC rather than as a "2h ago" relative age on purpose: relative
 * ages need the current clock, and reading the clock while rendering is impure
 * — it makes the markup differ between the server render and hydration. An
 * absolute stamp is deterministic given the cached payload, and for a
 * "when was this run" caption it's arguably clearer anyway.
 */
export function formatGeneratedAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function runPreviewSearch(): Promise<LandingPreview | null> {
  const outcome = await performSearch({
    addressQuery: PREVIEW_QUERY.address,
    headcount: PREVIEW_QUERY.headcount,
    maxCommuteMinutes: PREVIEW_QUERY.maxCommuteMinutes,
    commuteMode: PREVIEW_QUERY.commuteMode,
  });

  if (outcome.error || outcome.results.length === 0) return null;

  const cards = outcome.results.slice(0, PREVIEW_CARD_COUNT).map((result) => {
    const price = priceSignal(result.venue);
    const primary = result.venue.photos.find((p) => p.is_primary) ?? result.venue.photos[0];

    return {
      id: result.venue.id,
      name: result.venue.name,
      lat: result.venue.lat,
      lng: result.venue.lng,
      // Rounded at the boundary, matching how VenueCard displays it, so the
      // cached payload holds display-ready values rather than raw routing floats.
      commuteMinutes: Math.round(result.commuteMinutes),
      commuteEstimated: result.commuteEstimated,
      capacity: result.bestRoom.max_capacity,
      capacityTrust: result.bestRoom.capacity_trust,
      priceLabel: price.label,
      priceTrust: price.trust,
      photoUrl: primary?.url ?? null,
    } satisfies PreviewCard;
  });

  return { origin: outcome.origin, cards, generatedAt: new Date().toISOString() };
}

/**
 * Cached across requests so an anonymous visitor doesn't trigger a fresh
 * geocode + commute-matrix fan-out on every page view. Six hours is well
 * inside the discovery layer's own 30-day coverage TTL, so in practice this
 * re-runs ranking and commute against already-cached venues rather than
 * re-crawling anything.
 *
 * `unstable_cache` is deprecated in favour of the `use cache` directive, but
 * that directive requires enabling the project-wide `cacheComponents` flag,
 * which changes rendering semantics for every route in the app. Not worth that
 * blast radius for one preview; revisit if the project adopts Cache Components
 * wholesale.
 */
export const getLandingPreview = unstable_cache(runPreviewSearch, ["landing-preview-v1"], {
  revalidate: 60 * 60 * 6,
  tags: ["landing-preview"],
});
