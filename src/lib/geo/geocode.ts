export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

// Nominatim's usage policy caps anonymous use at ~1 req/sec and requires an
// identifying User-Agent. This module-level throttle is best-effort (it
// only holds within a single server instance) but keeps normal interactive
// use well under the limit without needing an API key.
let lastRequestAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const waitMs = 1100 - elapsed;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

async function nominatimSearch(query: string): Promise<GeocodeResult | null> {
  await throttle();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: {
      "User-Agent": "private-dining-finder/0.1 (event-planning research tool)",
      Accept: "application/json",
    },
  });

  if (!res.ok) return null;
  const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const first = results[0];
  if (!first) return null;

  return {
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    formattedAddress: first.display_name,
  };
}

const MAX_VARIANTS = 5;

// Real venue names are often more specific than OpenStreetMap's own naming
// (e.g. "Hilton Hawaiian Village Waikiki Beach Resort" vs. OSM's "Hilton
// Hawaiian Village") and a full-string search comes back empty. Rather than
// fail outright, progressively drop trailing words from the first
// comma-separated segment (the venue/street part) while keeping the
// city/state segments intact, and retry until something matches.
function buildQueryVariants(query: string): string[] {
  const segments = query.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return [query];

  const variants = [query];
  const [first, ...rest] = segments;
  const words = first.split(/\s+/);

  for (let cut = words.length - 1; cut >= 2; cut--) {
    const shortened = [words.slice(0, cut).join(" "), ...rest].join(", ");
    if (!variants.includes(shortened)) variants.push(shortened);
    if (variants.length >= MAX_VARIANTS) break;
  }

  return variants;
}

/**
 * Free, keyless geocoding via OpenStreetMap Nominatim. Good enough for
 * turning a planner-typed address into coordinates; swap for Google
 * Geocoding API if you need higher accuracy/throughput in production.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  for (const variant of buildQueryVariants(query)) {
    const result = await nominatimSearch(variant);
    if (result) return result;
  }
  return null;
}
