import { CAPACITY_TRUST_REASONS, PRICE_TRUST_QUALIFIERS } from "@/lib/trust-labels";
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

// Ordered by strength of evidence, not by how confident the data feels:
// - confirmed_by_planner: a human phoned the venue and reported the answer.
// - verified: a figure printed on the venue's own private-dining page.
// - likely: the venue confirms private events but publishes no number.
// - ai_extracted: the venue's own words, but read by a model rather than
//   matched verbatim, so it must not outrank a verbatim figure.
const TRUST_WEIGHT: Record<TrustLevel, number> = {
  confirmed_by_planner: 1,
  verified: 0.9,
  likely: 0.6,
  ai_extracted: 0.45,
  unverified: 0.3,
};

/**
 * How many results rest on evidence a planner doesn't need to re-check by
 * phone, for the "N of M results are confirmed" readout during search.
 *
 * Deliberately excludes `likely` and `ai_extracted`. Both are useful signals,
 * neither is confirmation, and counting them would turn the one number a
 * planner uses to gauge the list's reliability into marketing.
 */
export function countConfirmedCapacities(results: RankedVenue[]): number {
  return results.filter(
    (r) => r.bestRoom.capacity_trust === "verified" || r.bestRoom.capacity_trust === "confirmed_by_planner"
  ).length;
}

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

  reasons.push(CAPACITY_TRUST_REASONS[room.capacity_trust]);

  if (criteria.style && criteria.style !== "either" && room.style !== "either") {
    reasons.push(
      room.style === criteria.style
        ? `${room.style === "reception" ? "Reception" : "Seated"}-style room matches what you're looking for`
        : `Room is set up ${room.style}-style, not ${criteria.style}-style — ask about reconfiguring`
    );
  }

  if (venue.min_spend_usd != null) {
    reasons.push(`Minimum spend ~$${venue.min_spend_usd.toLocaleString()} (${PRICE_TRUST_QUALIFIERS[venue.min_spend_trust]})`);
  } else if (venue.price_tier) {
    reasons.push(`Price signal: ${venue.price_tier} (${PRICE_TRUST_QUALIFIERS[venue.price_tier_trust]})`);
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
    const rawCapacityFit = 1 - Math.min(1, (bestRoom.max_capacity - criteria.headcount) / Math.max(bestRoom.max_capacity, 1));
    // Fit credit is proportional to how much the capacity figure is believed.
    //
    // Venues with no published capacity fall back to a category estimate (see
    // estimateCapacityByCategory in discovery/trust.ts), and a guess of ~60
    // happens to be a near-perfect "fit" for a party of 50. Scoring raw fit let
    // that fabricated tightness beat a real, site-confirmed 200-seat room:
    // a Times Square load test put Joe's Pizza and Raising Cane's above
    // Carmine's private party room. A number we invented cannot be allowed to
    // outscore one the venue published.
    const capacityFitScore = rawCapacityFit * TRUST_WEIGHT[bestRoom.capacity_trust];
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
