import type { LatLng } from "@/lib/geo/commute";

export type CandidateVenue = {
  placeSourceId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  category: string;
  website?: string;
  phone?: string;
  /** Google's 0-4 price_level, when available */
  priceLevelGoogle?: number;
  /**
   * A real, location-accurate photo URL — only ever populated from Google
   * Places Photos (a photo actually submitted for *this* location).
   * Deliberately not populated from OSM/website scraping: a chain
   * restaurant's site typically uses generic marketing imagery that isn't
   * a photo of this specific branch, which is misleading, not just
   * low-quality — better to show no photo than a wrong one.
   */
  photoUrl?: string;
};

const GOOGLE_TYPES = ["restaurant", "bar", "banquet_hall", "night_club"] as const;

async function discoverViaGooglePlaces(origin: LatLng, radiusMeters: number, apiKey: string): Promise<CandidateVenue[]> {
  const byPlaceId = new Map<string, CandidateVenue>();

  for (const type of GOOGLE_TYPES) {
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    searchUrl.searchParams.set("location", `${origin.lat},${origin.lng}`);
    searchUrl.searchParams.set("radius", String(radiusMeters));
    searchUrl.searchParams.set("type", type);
    searchUrl.searchParams.set("key", apiKey);

    const res = await fetch(searchUrl);
    if (!res.ok) continue;
    const data = (await res.json()) as {
      results: Array<{
        place_id: string;
        name: string;
        vicinity?: string;
        geometry: { location: { lat: number; lng: number } };
        price_level?: number;
      }>;
    };

    for (const r of data.results ?? []) {
      if (byPlaceId.has(r.place_id)) continue;
      byPlaceId.set(r.place_id, {
        placeSourceId: r.place_id,
        name: r.name,
        formattedAddress: r.vicinity ?? "",
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        category: type.replace("_", " "),
        priceLevelGoogle: r.price_level,
      });
    }
  }

  // Enrich the top candidates with website/phone/photo via Place Details —
  // capped to keep quota/latency bounded (this is what makes the scraper
  // possible, and where the one accurate photo source comes from).
  const candidates = Array.from(byPlaceId.values()).slice(0, 20);
  await Promise.all(
    candidates.map(async (candidate) => {
      const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      detailsUrl.searchParams.set("place_id", candidate.placeSourceId);
      detailsUrl.searchParams.set("fields", "website,formatted_phone_number,formatted_address,photos");
      detailsUrl.searchParams.set("key", apiKey);

      try {
        const res = await fetch(detailsUrl);
        if (!res.ok) return;
        const data = (await res.json()) as {
          result?: {
            website?: string;
            formatted_phone_number?: string;
            formatted_address?: string;
            photos?: Array<{ photo_reference: string }>;
          };
        };
        if (data.result?.website) candidate.website = data.result.website;
        if (data.result?.formatted_phone_number) candidate.phone = data.result.formatted_phone_number;
        if (data.result?.formatted_address) candidate.formattedAddress = data.result.formatted_address;

        const photoReference = data.result?.photos?.[0]?.photo_reference;
        if (photoReference) {
          const photoUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
          photoUrl.searchParams.set("maxwidth", "1200");
          photoUrl.searchParams.set("photo_reference", photoReference);
          photoUrl.searchParams.set("key", apiKey);
          candidate.photoUrl = photoUrl.toString();
        }
      } catch {
        // Leave candidate without enrichment — it still surfaces as
        // unverified since the scraper will have nothing to crawl.
      }
    })
  );

  return candidates;
}

const OVERPASS_AMENITIES = "restaurant|bar|nightclub|events_venue|community_centre";

// The main instance rate-limits/queues aggressively under load; kumi.systems
// mirrors the same public dataset and is used as an automatic fallback.
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function discoverViaOverpass(origin: LatLng, radiusMeters: number): Promise<CandidateVenue[]> {
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"${OVERPASS_AMENITIES}"](around:${radiusMeters},${origin.lat},${origin.lng});
      way["amenity"~"${OVERPASS_AMENITIES}"](around:${radiusMeters},${origin.lat},${origin.lng});
    );
    out center tags;
  `;

  // A real query at this radius (~2.5km, matching a 15-20 min commute)
  // legitimately takes ~10s to process — measured directly against
  // Overpass, not a symptom of rate limiting. 10s was cutting that off
  // right at the edge; 20s gives real queries room to finish while still
  // capping a genuinely dead/504'ing endpoint well under the old 45-50s+
  // hang.
  const PER_ENDPOINT_TIMEOUT_MS = 20_000;

  let res: Response | null = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_ENDPOINT_TIMEOUT_MS);
    try {
      const attempt = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "private-dining-finder/0.1 (event-planning research tool)",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (attempt.ok) {
        res = attempt;
        break;
      }
      console.error(`Overpass discovery request to ${endpoint} failed: ${attempt.status} ${attempt.statusText}`);
    } catch (err) {
      console.error(`Overpass discovery request to ${endpoint} timed out or threw:`, err);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!res) return [];

  const data = (await res.json()) as {
    elements: Array<{
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };

  const candidates: CandidateVenue[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const addressParts = [tags["addr:housenumber"], tags["addr:street"], tags["addr:city"], tags["addr:state"]].filter(Boolean);

    candidates.push({
      placeSourceId: `osm-${el.id}`,
      name,
      formattedAddress: addressParts.length > 0 ? addressParts.join(" ") : `Near ${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`,
      lat,
      lng,
      category: tags.amenity ?? "venue",
      website: tags.website ?? tags["contact:website"],
      phone: tags.phone ?? tags["contact:phone"],
    });
  }

  return candidates;
}

/**
 * Finds candidate venues near a point. Prefers Google Places (richer
 * metadata, needs a billed API key); falls back to the free, keyless
 * OpenStreetMap Overpass API so the pipeline still works with zero config.
 */
export async function discoverNearbyVenues(origin: LatLng, radiusMeters: number): Promise<CandidateVenue[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (apiKey) {
    return discoverViaGooglePlaces(origin, radiusMeters, apiKey);
  }
  return discoverViaOverpass(origin, radiusMeters);
}
