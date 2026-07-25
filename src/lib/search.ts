import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { getCommuteMatrix, type CommuteMode, type LatLng } from "@/lib/geo/commute";
import { boundingBox } from "@/lib/geo/bounding-box";
import { ensureCoverage } from "@/lib/discovery/ensure-coverage";
import { rankVenues, type RankedVenue, type VenueWithRelations } from "@/lib/ranking";
import type { RoomStyle } from "@/lib/supabase/types";

export type SearchInput = {
  companyId: string;
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

  if (input.savedAddressId) {
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

export async function performSearch(input: SearchInput): Promise<SearchOutcome> {
  const origin = await resolveOrigin(input);
  if (!origin) {
    return { origin: { lat: 0, lng: 0, label: "" }, results: [], searchId: null, error: "Could not find that address. Try adding city and state." };
  }

  const radiusMeters = radiusForCommute(input.maxCommuteMinutes, input.commuteMode);

  await ensureCoverage(origin, radiusMeters);

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
