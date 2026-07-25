import type { CandidateVenue } from "@/lib/discovery/places";
import type { ScrapedSignals } from "@/lib/discovery/scraper";
import type { RoomStyle, TrustLevel } from "@/lib/supabase/types";

export type DraftRoom = {
  roomName: string;
  minCapacity?: number;
  maxCapacity: number;
  style: RoomStyle;
  capacityTrust: TrustLevel;
  notes?: string;
};

export type VenueDraft = {
  placeSourceId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  category: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  priceTier: string | null;
  priceTierTrust: TrustLevel;
  minSpendUsd: number | null;
  minSpendTrust: TrustLevel;
  description: string;
  sourceNote: string;
  rooms: DraftRoom[];
  imageUrl: string | null;
};

function inferStyle(category: string): RoomStyle {
  const c = category.toLowerCase();
  if (c.includes("bar") || c.includes("night") || c.includes("club")) return "reception";
  if (c.includes("banquet") || c.includes("hotel") || c.includes("event")) return "either";
  return "either";
}

// Used only when no private-dining info could be scraped at all, so the
// required "capacity" field still has *something* to show — always paired
// with capacityTrust: 'unverified' and an explicit note, never presented
// as a confirmed number.
function estimateCapacityByCategory(category: string): number {
  const c = category.toLowerCase();
  if (c.includes("banquet")) return 150;
  if (c.includes("night") || c.includes("club")) return 120;
  if (c.includes("bar")) return 80;
  return 60; // restaurant / generic default
}

function priceLevelToTier(level: number | undefined): string | null {
  if (level == null) return null;
  return ["$", "$", "$$", "$$$", "$$$$"][level] ?? null;
}

/**
 * Turns a discovered candidate + whatever the scraper found into a
 * database-ready draft, with every confidence field derived from what was
 * actually observed rather than assumed. This is the single place that
 * decides verified vs. likely vs. unverified.
 */
export function buildVenueDraft(candidate: CandidateVenue, signals: ScrapedSignals | null): VenueDraft {
  const style = inferStyle(candidate.category);
  const priceTier = priceLevelToTier(candidate.priceLevelGoogle);

  if (!signals) {
    return {
      placeSourceId: candidate.placeSourceId,
      name: candidate.name,
      formattedAddress: candidate.formattedAddress,
      lat: candidate.lat,
      lng: candidate.lng,
      category: candidate.category,
      website: null,
      phone: candidate.phone ?? null,
      email: null,
      priceTier,
      priceTierTrust: priceTier ? "likely" : "unverified",
      minSpendUsd: null,
      minSpendTrust: "unverified",
      description: `${candidate.name} — discovered near your search location.`,
      sourceNote:
        "No website found for this venue during discovery, so private-dining availability and capacity are unconfirmed. Call the venue directly.",
      rooms: [
        {
          roomName: "Capacity unconfirmed",
          maxCapacity: estimateCapacityByCategory(candidate.category),
          style,
          capacityTrust: "unverified",
          notes: "Estimated from venue category only — no source to confirm against.",
        },
      ],
      // Google Places can have a photo for a venue even with no website
      // on file — only Overpass-sourced candidates (no Google key) truly
      // have zero photo options here.
      imageUrl: candidate.photoUrl ?? null,
    };
  }

  const hasCapacityNumbers = signals.capacityNumbers.length > 0;
  const capacityTrust: TrustLevel = signals.privateDiningPageFound
    ? hasCapacityNumbers
      ? "verified"
      : "likely"
    : "unverified";

  const rooms: DraftRoom[] = hasCapacityNumbers
    ? [
        {
          roomName: "Private Dining / Event Space",
          minCapacity: signals.capacityNumbers[0] !== signals.capacityNumbers.at(-1) ? signals.capacityNumbers[0] : undefined,
          maxCapacity: signals.capacityNumbers.at(-1)!,
          style,
          capacityTrust,
          notes: "Capacity figure(s) extracted from the venue's own private-dining/events page.",
        },
      ]
    : [
        {
          roomName: signals.privateDiningPageFound ? "Private events available (capacity unpublished)" : "Capacity unconfirmed",
          maxCapacity: estimateCapacityByCategory(candidate.category),
          style,
          capacityTrust,
          notes: signals.privateDiningPageFound
            ? "Venue confirms private events but does not publish a specific capacity number — call to confirm fit."
            : "Estimated from venue category only — no private-dining page found to confirm against.",
        },
      ];

  const minSpendUsd = signals.minSpendUsd.length > 0 ? Math.min(...signals.minSpendUsd) : null;

  const sourceNoteParts = [
    `Auto-discovered and cross-checked against ${signals.scrapedUrls.length} page(s) of the venue's own website.`,
    signals.privateDiningPageFound
      ? hasCapacityNumbers
        ? "A dedicated private-dining/events page was found with an explicit capacity figure."
        : "A private-events page was found but it doesn't publish a specific capacity number."
      : "No dedicated private-dining or events page was found on the site.",
    "Always confirm details directly with the venue before booking.",
  ];

  return {
    placeSourceId: candidate.placeSourceId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress,
    lat: candidate.lat,
    lng: candidate.lng,
    category: candidate.category,
    website: candidate.website ?? null,
    phone: signals.phone ?? candidate.phone ?? null,
    email: signals.email,
    priceTier,
    priceTierTrust: priceTier ? "likely" : "unverified",
    minSpendUsd,
    minSpendTrust: minSpendUsd != null ? "verified" : "unverified",
    description: signals.descriptionExcerpt ?? `${candidate.name} — discovered near your search location.`,
    sourceNote: sourceNoteParts.join(" "),
    rooms,
    imageUrl: candidate.photoUrl ?? null,
  };
}
