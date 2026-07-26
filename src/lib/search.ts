import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { getCommuteMatrix, type CommuteMode, type LatLng } from "@/lib/geo/commute";
import { boundingBox } from "@/lib/geo/bounding-box";
import { ensureCoverage, type CoverageSummary } from "@/lib/discovery/ensure-coverage";
import { rankVenues, type RankedVenue, type VenueWithRelations } from "@/lib/ranking";
import type { RoomStyle } from "@/lib/supabase/types";

export type SearchInput = {
  /**
   * Omitted for the public landing-page preview, which runs the identical
   * pipeline but has no workspace to attribute the search to. Making it
   * optional (rather than forging a company id) keeps the `searches` audit
   * table meaning exactly one thing: searches a real workspace ran.
   */
  companyId?: string;
  addressQuery?: string;
  savedAddressId?: string;
  headcount: number;
  maxCommuteMinutes: number;
  commuteMode: CommuteMode;
  style?: RoomStyle;
  createdBy?: string | null;
};

export type SearchOutcome = {
  origin: LatLng & { label: string };
  results: RankedVenue[];
  searchId: string | null;
  error?: string;
};

// Average speed per mode (see commute.ts) with a safety buffer so the
// discovery/candidate radius comfortably covers anything that could still
// come in under the cutoff once real routing (which is never a straight
// line) is applied.
const SPEED_MPS: Record<CommuteMode, number> = { walk: 1.34, drive: 8.9 };
const RADIUS_SAFETY_FACTOR = 1.6;

function radiusForCommute(maxCommuteMinutes: number, mode: CommuteMode): number {
  return SPEED_MPS[mode] * maxCommuteMinutes * 60 * RADIUS_SAFETY_FACTOR;
}

async function resolveOrigin(input: SearchInput): Promise<(LatLng & { label: string }) | null> {
  const supabase = createServiceClient();

  if (input.savedAddressId && input.companyId) {
    const { data } = await supabase
      .from("saved_addresses")
      .select("*")
      .eq("id", input.savedAddressId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (data) return { lat: data.lat, lng: data.lng, label: data.formatted_address };
  }

  if (input.addressQuery) {
    const geocoded = await geocodeAddress(input.addressQuery);
    if (geocoded) return { lat: geocoded.lat, lng: geocoded.lng, label: geocoded.formattedAddress };
  }

  return null;
}

export const ORIGIN_NOT_FOUND = "Could not find that address. Try adding city and state.";

/**
 * Stage 1 of 3. Split out so the UI can report "found the address" before the
 * much slower discovery stage has finished — see src/lib/search-stages.ts.
 */
export async function resolveSearchOrigin(input: SearchInput): Promise<(LatLng & { label: string }) | null> {
  return resolveOrigin(input);
}

/** Stage 2 of 3: make sure the area has been crawled recently enough to search. */
export async function ensureSearchCoverage(
  origin: LatLng,
  input: Pick<SearchInput, "maxCommuteMinutes" | "commuteMode">
): Promise<CoverageSummary> {
  return ensureCoverage(origin, radiusForCommute(input.maxCommuteMinutes, input.commuteMode));
}

/** Stage 3 of 3: measure commute to everything in range, rank it, log the search. */
export async function completeSearch(input: SearchInput, origin: LatLng & { label: string }): Promise<SearchOutcome> {
  const radiusMeters = radiusForCommute(input.maxCommuteMinutes, input.commuteMode);
  const supabase = createServiceClient();
  const box = boundingBox(origin, radiusMeters);
  const { data: venueRows } = await supabase
    .from("venues")
    .select("*, rooms:venue_rooms(*), photos:venue_photos(*)")
    .gte("lat", box.minLat)
    .lte("lat", box.maxLat)
    .gte("lng", box.minLng)
    .lte("lng", box.maxLng);

  const venues = (venueRows ?? []) as unknown as VenueWithRelations[];

  const commutes = await getCommuteMatrix(
    origin,
    venues.map((v) => ({ lat: v.lat, lng: v.lng })),
    input.commuteMode
  );
  const commuteMap = new Map(venues.map((v, i) => [v.id, commutes[i]]));

  const results = rankVenues(
    {
      headcount: input.headcount,
      maxCommuteMinutes: input.maxCommuteMinutes,
      commuteMode: input.commuteMode,
      style: input.style,
    },
    venues,
    commuteMap
  );

  if (!input.companyId) return { origin, results, searchId: null };

  const { data: searchRow } = await supabase
    .from("searches")
    .insert({
      company_id: input.companyId,
      saved_address_id: input.savedAddressId ?? null,
      origin_label: origin.label,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      headcount: input.headcount,
      max_commute_minutes: input.maxCommuteMinutes,
      commute_mode: input.commuteMode,
      style: input.style ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();

  return { origin, results, searchId: searchRow?.id ?? null };
}

/**
 * Runs all three stages back to back. Used by callers that just want the final
 * answer (the scenario scripts, the landing-page preview); the search page
 * drives the stages individually so it can show progress as it happens.
 */
export async function performSearch(input: SearchInput): Promise<SearchOutcome> {
  const origin = await resolveSearchOrigin(input);
  if (!origin) {
    return { origin: { lat: 0, lng: 0, label: "" }, results: [], searchId: null, error: ORIGIN_NOT_FOUND };
  }

  await ensureSearchCoverage(origin, input);
  return completeSearch(input, origin);
}
