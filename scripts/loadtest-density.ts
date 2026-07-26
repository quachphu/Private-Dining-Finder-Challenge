/**
 * Density load test for the discovery pipeline.
 *
 * The concern this answers: the number of candidates we're willing to fetch per
 * search is capped, and in a dense downtown core the venues that actually host
 * private events are frequently *not* in the first handful of results —
 * discovery order reflects proximity and place type, not private-dining
 * capability. If the cap is too low for Times Square, real venues are missing
 * from results and (worse) nothing in the UI would indicate that.
 *
 * This deliberately bypasses the 30-day coverage cache and forces a live run,
 * so it makes real network calls and should not be run casually.
 *
 * Run with: npx tsx scripts/loadtest-density.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { discoverNearbyVenues } from "@/lib/discovery/places";
import { runDiscoveryPipeline } from "@/lib/discovery/pipeline";
import { boundingBox } from "@/lib/geo/bounding-box";
import { createServiceClient } from "@/lib/supabase/server";
import type { LatLng } from "@/lib/geo/commute";

// Mirrors radiusForCommute() in src/lib/search.ts for a 20-minute drive, which
// is required scenario 1.
const SPEED_MPS = { walk: 1.34, drive: 8.9 };
const RADIUS_SAFETY_FACTOR = 1.6;
const radiusFor = (minutes: number, mode: keyof typeof SPEED_MPS) => SPEED_MPS[mode] * minutes * 60 * RADIUS_SAFETY_FACTOR;

const AREAS: Array<{ label: string; origin: LatLng; minutes: number; mode: keyof typeof SPEED_MPS }> = [
  { label: "Times Square, NYC (20 min drive)", origin: { lat: 40.757, lng: -73.9855 }, minutes: 20, mode: "drive" },
  { label: "Salesforce Tower, SF (15 min walk)", origin: { lat: 37.7898, lng: -122.3969 }, minutes: 15, mode: "walk" },
];

async function report(label: string, origin: LatLng, radiusMeters: number) {
  const supabase = createServiceClient();
  const box = boundingBox(origin, radiusMeters);

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, source, rooms:venue_rooms(max_capacity, capacity_trust)")
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);

  const rows = venues ?? [];
  const withRooms = rows.filter((v) => v.rooms.length > 0);
  const withConfirmedCapacity = rows.filter((v) =>
    v.rooms.some((r) => r.capacity_trust === "verified" || r.capacity_trust === "confirmed_by_planner")
  );
  const fits50 = rows.filter((v) => v.rooms.some((r) => r.max_capacity >= 50));
  const fits200 = rows.filter((v) => v.rooms.some((r) => r.max_capacity >= 200));

  console.log(`  cached in area:        ${rows.length}`);
  console.log(`  with any room listed: ${withRooms.length}`);
  console.log(`  capacity confirmed:   ${withConfirmedCapacity.length}`);
  console.log(`  could host 50:        ${fits50.length}`);
  console.log(`  could host 200:       ${fits200.length}`);
  console.log(`  curated vs discovered: ${rows.filter((v) => v.source === "curated_seed").length} / ${rows.filter((v) => v.source === "auto_discovered").length}`);
  void label;
}

async function main() {
  for (const area of AREAS) {
    const radiusMeters = radiusFor(area.minutes, area.mode);
    console.log(`\n=== ${area.label} — radius ${(radiusMeters / 1000).toFixed(1)} km ===`);

    const candidates = await discoverNearbyVenues(area.origin, radiusMeters);
    console.log(`  candidates returned:  ${candidates.length}`);
    console.log(`  with a website:       ${candidates.filter((c) => c.website).length}`);

    console.log("  before this run:");
    await report(area.label, area.origin, radiusMeters);

    const started = Date.now();
    const { discovered } = await runDiscoveryPipeline(area.origin, radiusMeters);
    console.log(`  scraped this run:     ${discovered} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    console.log("  after this run:");
    await report(area.label, area.origin, radiusMeters);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
