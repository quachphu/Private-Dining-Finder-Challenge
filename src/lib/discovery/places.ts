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
  /**
   * Normalized 0-4 price level. Google's newer API reports this as an enum
   * (PRICE_LEVEL_MODERATE etc.); it's mapped back onto the 0-4 scale here so
   * downstream trust/tier logic has a single numeric contract regardless of
   * which discovery provider produced the candidate.
   */
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

// Places API (New) requires an explicit field mask; unmasked fields are not
// returned at all. Asking for website/phone/photos here means one request per
// type covers everything the scraper and UI need — the legacy implementation
// had to follow up with a separate Place Details call per candidate.
const GOOGLE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.priceLevel",
  "places.photos",
].join(",");

// searchNearby caps a single response at 20 places, so each venue type is
// requested separately and merged — that's what keeps a dense downtown core
// (Times Square) from being represented by 20 pizza counters.
const GOOGLE_MAX_PER_TYPE = 20;

const PRICE_LEVEL_TO_NUMBER: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  priceLevel?: string;
  photos?: Array<{ name?: string }>;
};

/**
 * Places API (New). The legacy `maps.googleapis.com/maps/api/place/*`
 * endpoints are intentionally not used: Google no longer enables them for
 * newer Cloud projects, so a legacy call fails outright rather than
 * degrading.
 */
async function discoverViaGooglePlaces(origin: LatLng, radiusMeters: number, apiKey: string): Promise<CandidateVenue[]> {
  const byPlaceId = new Map<string, CandidateVenue>();

  await Promise.all(
    GOOGLE_TYPES.map(async (type) => {
      try {
        const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
          },
          body: JSON.stringify({
            includedTypes: [type],
            maxResultCount: GOOGLE_MAX_PER_TYPE,
            locationRestriction: {
              circle: {
                center: { latitude: origin.lat, longitude: origin.lng },
                radius: radiusMeters,
              },
            },
          }),
        });

        if (!res.ok) {
          console.error(`Google Places searchNearby (${type}) failed: ${res.status} ${await res.text()}`);
          return;
        }

        const data = (await res.json()) as { places?: GooglePlace[] };
        for (const place of data.places ?? []) {
          const lat = place.location?.latitude;
          const lng = place.location?.longitude;
          const name = place.displayName?.text;
          if (!place.id || !name || lat == null || lng == null) continue;
          if (byPlaceId.has(place.id)) continue;

          // Photo bytes are served through our own route so the API key is
          // never embedded in a stored URL or shipped to the browser.
          const photoName = place.photos?.[0]?.name;

          byPlaceId.set(place.id, {
            placeSourceId: place.id,
            name,
            formattedAddress: place.formattedAddress ?? "",
            lat,
            lng,
            category: type.replace("_", " "),
            website: place.websiteUri,
            phone: place.nationalPhoneNumber,
            priceLevelGoogle: place.priceLevel ? PRICE_LEVEL_TO_NUMBER[place.priceLevel] : undefined,
            photoUrl: photoName ? `/api/place-photo?name=${encodeURIComponent(photoName)}` : undefined,
          });
        }
      } catch (err) {
        console.error(`Google Places searchNearby (${type}) threw:`, err);
      }
    })
  );

  return Array.from(byPlaceId.values());
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
 * metadata, needs an enabled+billed API key); falls back to the free, keyless
 * OpenStreetMap Overpass API.
 *
 * The fallback also triggers when Google is configured but returns nothing —
 * a disabled API, quota exhaustion, or a restricted key would otherwise
 * silently produce an empty search rather than degrading to the free source.
 */
export async function discoverNearbyVenues(origin: LatLng, radiusMeters: number): Promise<CandidateVenue[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (apiKey) {
    const candidates = await discoverViaGooglePlaces(origin, radiusMeters, apiKey);
    if (candidates.length > 0) return candidates;
    console.error("Google Places returned no candidates — falling back to Overpass.");
  }

  return discoverViaOverpass(origin, radiusMeters);
}
