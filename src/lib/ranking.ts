import type { CommuteMode, CommuteResult } from "@/lib/geo/commute";
import type { RoomStyle, TrustLevel, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

export type VenueWithRelations = VenueRow & {
  rooms: VenueRoomRow[];
  photos: VenuePhotoRow[];
};

export type SearchCriteria = {
  headcount: number;
  maxCommuteMinutes: number;
  commuteMode: CommuteMode;
  style?: RoomStyle;
};

export type RankedVenue = {
  venue: VenueWithRelations;
  bestRoom: VenueRoomRow;
  commuteMinutes: number;
  commuteMiles: number;
  commuteEstimated: boolean;
  score: number;
  reasons: string[];
};

const TRUST_WEIGHT: Record<TrustLevel, number> = { verified: 1, likely: 0.6, unverified: 0.3 };

/** Picks the tightest-fitting room that can actually hold the group. */
function pickBestRoom(rooms: VenueRoomRow[], headcount: number): VenueRoomRow | null {
  const fitting = rooms.filter((r) => r.max_capacity >= headcount);
  if (fitting.length === 0) return null;
  // Prefer the smallest room that still fits — a 50-person group in a
  // 60-cap room reads as "the right size"; the same group in a 1500-cap
  // ballroom is technically fine but a worse experiential fit.
  return fitting.sort((a, b) => a.max_capacity - b.max_capacity)[0];
}

function styleScore(roomStyle: RoomStyle, requested?: RoomStyle): number {
  if (!requested || requested === "either" || roomStyle === "either") return 1;
  return roomStyle === requested ? 1 : 0.4;
}

function trustScore(venue: VenueWithRelations, room: VenueRoomRow): number {
  // Capacity trust matters most (it's the fact the search itself depends
  // on); price trust is informative but secondary.
  return TRUST_WEIGHT[room.capacity_trust] * 0.7 + TRUST_WEIGHT[venue.price_tier_trust] * 0.3;
}

function buildReasons(
  venue: VenueWithRelations,
  room: VenueRoomRow,
  commuteMinutes: number,
  criteria: SearchCriteria,
  commuteEstimated: boolean
): string[] {
  const reasons: string[] = [];
  const modeLabel = criteria.commuteMode === "walk" ? "walk" : "drive";
  reasons.push(
    `${Math.round(commuteMinutes)} min ${modeLabel}${commuteEstimated ? " (estimated)" : ""} — under your ${criteria.maxCommuteMinutes} min max`
  );

  reasons.push(`Fits ${criteria.headcount} in ${room.room_name} (up to ${room.max_capacity}${room.min_capacity ? ` from ${room.min_capacity}` : ""})`);

  if (room.capacity_trust === "verified") {
    reasons.push("Capacity verified directly from the venue's own private-dining page");
  } else if (room.capacity_trust === "likely") {
    reasons.push("Capacity likely correct, but not independently confirmed — worth a quick call");
  } else {
    reasons.push("Capacity unverified — call the venue to confirm before booking");
  }

  if (criteria.style && criteria.style !== "either" && room.style !== "either") {
    reasons.push(
      room.style === criteria.style
        ? `${room.style === "reception" ? "Reception" : "Seated"}-style room matches what you're looking for`
        : `Room is set up ${room.style}-style, not ${criteria.style}-style — ask about reconfiguring`
    );
  }

  if (venue.min_spend_usd != null) {
    reasons.push(`Minimum spend ~$${venue.min_spend_usd.toLocaleString()} (${venue.min_spend_trust})`);
  } else if (venue.price_tier) {
    reasons.push(`Price signal: ${venue.price_tier} (${venue.price_tier_trust})`);
  }

  return reasons;
}

/**
 * Filters venues to ones that can actually fit the group within the
 * commute cutoff, then ranks the rest by a weighted "best overall fit"
 * score: commute closeness, capacity fit, data trust, and style match.
 */
export function rankVenues(
  criteria: SearchCriteria,
  venues: VenueWithRelations[],
  commutes: Map<string, CommuteResult>
): RankedVenue[] {
  const ranked: RankedVenue[] = [];

  for (const venue of venues) {
    const commute = commutes.get(venue.id);
    if (!commute) continue;

    const commuteMinutes = commute.durationSeconds / 60;
    if (commuteMinutes > criteria.maxCommuteMinutes) continue;

    const bestRoom = pickBestRoom(venue.rooms, criteria.headcount);
    if (!bestRoom) continue;

    const commuteScoreValue = Math.max(0, 1 - commuteMinutes / criteria.maxCommuteMinutes);
    const capacityFitScore = 1 - Math.min(1, (bestRoom.max_capacity - criteria.headcount) / Math.max(bestRoom.max_capacity, 1));
    const trust = trustScore(venue, bestRoom);
    const style = styleScore(bestRoom.style, criteria.style);

    const score = commuteScoreValue * 0.35 + capacityFitScore * 0.3 + trust * 0.25 + style * 0.1;

    ranked.push({
      venue,
      bestRoom,
      commuteMinutes,
      commuteMiles: commute.distanceMeters / 1609.34,
      commuteEstimated: commute.estimated,
      score,
      reasons: buildReasons(venue, bestRoom, commuteMinutes, criteria, commute.estimated),
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
