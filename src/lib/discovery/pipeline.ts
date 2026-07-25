import { createServiceClient } from "@/lib/supabase/server";
import { discoverNearbyVenues } from "@/lib/discovery/places";
import { scrapeVenueForPrivateDining } from "@/lib/discovery/scraper";
import { buildVenueDraft, type VenueDraft } from "@/lib/discovery/trust";
import type { LatLng } from "@/lib/geo/commute";

const MAX_CANDIDATES_TO_SCRAPE = 12;
const SCRAPE_CONCURRENCY = 4;

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

  // Photos are replaced on every re-scrape too, same as rooms — a venue
  // that gets a real photo on a later scrape (or loses one) should reflect
  // that rather than keeping a stale one. Real photo (Google Places, when
  // GOOGLE_PLACES_API_KEY is set) takes priority; otherwise falls back to
  // a deterministic placeholder so the UI never shows an empty card.
  await supabase.from("venue_photos").delete().eq("venue_id", venue.id);
  await supabase.from("venue_photos").insert({
    venue_id: venue.id,
    url: draft.imageUrl ?? `https://picsum.photos/seed/${encodeURIComponent(draft.placeSourceId)}/1200/800`,
    alt_text: draft.imageUrl ? draft.name : `${draft.name} (placeholder photo)`,
    sort_order: 0,
    is_primary: true,
  });
}

/**
 * Runs live discovery for an area: find candidate venues, scrape each for
 * private-dining signals, derive trust labels, and upsert everything into
 * Supabase. Called by the search flow when there isn't fresh cached
 * coverage for the area already (see src/lib/discovery/ensure-coverage.ts).
 */
export async function runDiscoveryPipeline(origin: LatLng, radiusMeters: number): Promise<{ discovered: number }> {
  const candidates = await discoverNearbyVenues(origin, radiusMeters);
  const toScrape = candidates.slice(0, MAX_CANDIDATES_TO_SCRAPE);

  const drafts = await mapWithConcurrency(toScrape, SCRAPE_CONCURRENCY, async (candidate) => {
    const signals = candidate.website ? await scrapeVenueForPrivateDining(candidate.website) : null;
    return buildVenueDraft(candidate, signals);
  });

  await Promise.all(drafts.map(upsertVenueDraft));

  return { discovered: drafts.length };
}
