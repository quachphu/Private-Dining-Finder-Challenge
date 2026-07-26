import { createServiceClient } from "@/lib/supabase/server";
import { discoverNearbyVenues } from "@/lib/discovery/places";
import { extractPrivateDiningWithLlm, isLlmExtractionConfigured } from "@/lib/discovery/llm-extract";
import { scrapeVenueForPrivateDining } from "@/lib/discovery/scraper";
import { buildVenueDraft, type VenueDraft } from "@/lib/discovery/trust";
import type { LatLng } from "@/lib/geo/commute";

/**
 * A dense downtown core (Times Square, the Financial District) returns far
 * more candidates than a quiet neighbourhood, and the venues that actually
 * host 200-person receptions are frequently not in the first 12 results —
 * discovery order reflects proximity and place type, not private-dining
 * capability. 12 was leaving real venues undiscovered there, so the cap
 * scales with how crowded the area turned out to be.
 *
 * Measured against Times Square (scripts/loadtest-density.ts): a 20-minute
 * driving radius returns ~70 candidates, so a cap of 30 was reading well under
 * half the area and finding only 7 venues with a site-confirmed capacity. The
 * ceilings below cover essentially all of them. Raising them costs nothing in
 * API spend — this tier is a plain HTTP GET plus an HTML parse, and the paid
 * rendering/LLM tiers stay bounded by MAX_ENRICHMENT_BUDGET regardless.
 */
function candidateCap(candidateCount: number): number {
  if (candidateCount >= 60) return 45;
  if (candidateCount >= 30) return 25;
  return 15;
}

/**
 * Raised alongside the caps above so wall-clock time for a first search in a
 * dense area stays roughly flat instead of scaling with the new ceiling.
 *
 * Safe to raise because these requests fan out across distinct venue domains —
 * 8 in flight is still about one connection per host, not 8 against any single
 * restaurant's server.
 */
const SCRAPE_CONCURRENCY = 8;

/**
 * Caps how many venues per run may fall through to the paid rendering + LLM
 * tiers. Both are gated on the free static pass finding nothing, and in a
 * dense area that can be most candidates — without a ceiling, one search in
 * Manhattan could consume an entire credit balance. Candidates are processed
 * in discovery order, so the budget goes to the closest venues.
 */
const MAX_ENRICHMENT_BUDGET = 8;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function citySlugForOrigin(): string {
  // Auto-discovered venues aren't tied to one of the 3 demo city buckets —
  // they're grouped by discovery run instead, distance filtering happens
  // by lat/lng at query time regardless of this label.
  return "auto";
}

async function upsertVenueDraft(draft: VenueDraft) {
  const supabase = createServiceClient();

  const { data: venue, error: venueError } = await supabase
    .from("venues")
    .upsert(
      {
        source: "auto_discovered",
        place_source_id: draft.placeSourceId,
        name: draft.name,
        formatted_address: draft.formattedAddress,
        lat: draft.lat,
        lng: draft.lng,
        city_slug: citySlugForOrigin(),
        category: draft.category,
        price_tier: draft.priceTier,
        price_tier_trust: draft.priceTierTrust,
        min_spend_usd: draft.minSpendUsd,
        min_spend_trust: draft.minSpendTrust,
        phone: draft.phone,
        email: draft.email,
        website: draft.website,
        description: draft.description,
        source_note: draft.sourceNote,
        menu_url: draft.menuUrl,
        menu_trust: draft.menuTrust,
        dietary_notes: draft.dietaryNotes,
        dietary_trust: draft.dietaryTrust,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "place_source_id" }
    )
    .select("id")
    .single();

  if (venueError || !venue) {
    console.error("Failed to upsert discovered venue", draft.name, venueError);
    return;
  }

  // Rooms are fully replaced on every re-scrape so stale capacity figures
  // don't linger after a venue updates its site.
  await supabase.from("venue_rooms").delete().eq("venue_id", venue.id);
  if (draft.rooms.length > 0) {
    await supabase.from("venue_rooms").insert(
      draft.rooms.map((room) => ({
        venue_id: venue.id,
        room_name: room.roomName,
        min_capacity: room.minCapacity ?? null,
        max_capacity: room.maxCapacity,
        style: room.style,
        capacity_trust: room.capacityTrust,
        notes: room.notes ?? null,
      }))
    );
  }

  // Photos are replaced on every re-scrape too, same as rooms — a venue that
  // gains a real photo on a later scrape (or loses one) should reflect that
  // rather than keeping a stale one.
  //
  // No placeholder fallback: this previously inserted a random stock photo so
  // cards were never empty, which meant a planner evaluating a venue was
  // looking at a picture of somewhere else entirely. The card has an explicit
  // "no photo found" state, and that's strictly more useful than a confident
  // wrong image. Only genuine Google Places photos of this exact location are
  // stored.
  await supabase.from("venue_photos").delete().eq("venue_id", venue.id);
  if (draft.imageUrl) {
    await supabase.from("venue_photos").insert({
      venue_id: venue.id,
      url: draft.imageUrl,
      alt_text: draft.name,
      sort_order: 0,
      is_primary: true,
    });
  }
}

/**
 * Runs live discovery for an area: find candidate venues, scrape each for
 * private-dining signals, derive trust labels, and upsert everything into
 * Supabase. Called by the search flow when there isn't fresh cached
 * coverage for the area already (see src/lib/discovery/ensure-coverage.ts).
 */
export async function runDiscoveryPipeline(origin: LatLng, radiusMeters: number): Promise<{ discovered: number }> {
  const candidates = await discoverNearbyVenues(origin, radiusMeters);
  const toScrape = candidates.slice(0, candidateCap(candidates.length));

  let enrichmentSpent = 0;

  const drafts = await mapWithConcurrency(toScrape, SCRAPE_CONCURRENCY, async (candidate) => {
    const signals = candidate.website ? await scrapeVenueForPrivateDining(candidate.website) : null;

    // The LLM tier exists for pages that clearly host private events but state
    // capacity in prose. Running it where a figure was already matched
    // verbatim would spend tokens to second-guess better evidence — except
    // when a second opinion is what we want, which is what the enrichment
    // budget below funds.
    const needsLlmRead =
      signals != null &&
      signals.combinedText.length > 0 &&
      signals.capacityNumbers.length === 0 &&
      signals.privateDiningPageFound &&
      isLlmExtractionConfigured();

    if (!needsLlmRead || enrichmentSpent >= MAX_ENRICHMENT_BUDGET) {
      return buildVenueDraft(candidate, signals);
    }

    enrichmentSpent += 1;
    const llm = await extractPrivateDiningWithLlm(candidate.name, signals!.combinedText);
    return buildVenueDraft(candidate, signals, llm);
  });

  await Promise.all(drafts.map(upsertVenueDraft));

  return { discovered: drafts.length };
}
