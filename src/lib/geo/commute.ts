export type LatLng = { lat: number; lng: number };
export type CommuteMode = "walk" | "drive";

export type CommuteResult = {
  distanceMeters: number;
  durationSeconds: number;
  /** true when this came from the haversine fallback, not a real routing engine */
  estimated: boolean;
};

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Straight-line distance underestimates real walking/driving routes because
// it ignores street grids, one-ways, and water/park detours. A route-factor
// multiplier (industry-standard approximation) corrects for this so the
// fallback commute time is closer to reality than raw as-the-crow-flies math.
const ROUTE_FACTOR: Record<CommuteMode, number> = { walk: 1.3, drive: 1.4 };
const AVERAGE_SPEED_MPS: Record<CommuteMode, number> = {
  walk: 1.34, // ~3 mph
  drive: 8.9, // ~20 mph average urban driving incl. lights/traffic
};

function haversineEstimate(origin: LatLng, destination: LatLng, mode: CommuteMode): CommuteResult {
  const straightLineMeters = haversineMeters(origin, destination);
  const distanceMeters = straightLineMeters * ROUTE_FACTOR[mode];
  const durationSeconds = distanceMeters / AVERAGE_SPEED_MPS[mode];
  return { distanceMeters, durationSeconds, estimated: true };
}

const ORS_PROFILE: Record<CommuteMode, string> = { walk: "foot-walking", drive: "driving-car" };

/**
 * Real routing via OpenRouteService (free tier, signup required — no
 * credit card) when ORS_API_KEY is set; otherwise a labeled haversine
 * estimate. Batches all destinations into a single Matrix API call.
 */
export async function getCommuteMatrix(
  origin: LatLng,
  destinations: LatLng[],
  mode: CommuteMode
): Promise<CommuteResult[]> {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey || destinations.length === 0) {
    return destinations.map((d) => haversineEstimate(origin, d, mode));
  }

  try {
    const locations = [[origin.lng, origin.lat], ...destinations.map((d) => [d.lng, d.lat])];
    const res = await fetch(`https://api.openrouteservice.org/v2/matrix/${ORS_PROFILE[mode]}`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations,
        sources: [0],
        destinations: destinations.map((_, i) => i + 1),
        metrics: ["distance", "duration"],
      }),
    });

    if (!res.ok) throw new Error(`ORS matrix request failed: ${res.status}`);

    const data = (await res.json()) as {
      distances: number[][];
      durations: number[][];
    };

    return destinations.map((d, i) => {
      const distanceMeters = data.distances?.[0]?.[i];
      const durationSeconds = data.durations?.[0]?.[i];
      if (typeof distanceMeters !== "number" || typeof durationSeconds !== "number") {
        return haversineEstimate(origin, d, mode);
      }
      return { distanceMeters, durationSeconds, estimated: false };
    });
  } catch {
    // Network hiccup or quota exceeded — degrade gracefully rather than
    // failing the whole search.
    return destinations.map((d) => haversineEstimate(origin, d, mode));
  }
}

export async function getCommute(origin: LatLng, destination: LatLng, mode: CommuteMode): Promise<CommuteResult> {
  const [result] = await getCommuteMatrix(origin, [destination], mode);
  return result;
}
