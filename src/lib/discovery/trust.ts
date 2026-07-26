import type { CandidateVenue } from "@/lib/discovery/places";
import type { LlmExtraction } from "@/lib/discovery/llm-extract";
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
  menuUrl: string | null;
  menuTrust: TrustLevel;
  dietaryNotes: string | null;
  dietaryTrust: TrustLevel;
};

/**
 * How far two independent capacity reads may differ and still count as
 * agreeing. Venues describe the same room as "up to 60" and "seats 55"
 * routinely, so an exact-match requirement would flag normal paraphrasing as
 * a conflict; 20% is loose enough to absorb that and tight enough that 60 vs
 * 120 still surfaces as a real disagreement.
 */
const AGREEMENT_TOLERANCE = 0.2;

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
 * Cross-references the regex read of a page against the LLM read of the same
 * page. Two independent methods agreeing is stronger evidence than either
 * alone, so agreement earns `verified` — but disagreement is never silently
 * resolved by picking a winner. Both figures are surfaced and the label drops
 * to `likely` so the planner knows to check.
 */
function reconcileCapacity(
  regexMax: number | null,
  llmMax: number | null
): { trust: TrustLevel; note: string } | null {
  if (regexMax == null || llmMax == null) return null;

  const spread = Math.abs(regexMax - llmMax) / Math.max(regexMax, llmMax);
  if (spread <= AGREEMENT_TOLERANCE) {
    return {
      trust: "verified",
      note: `Two independent reads of the venue's page agree on capacity (page text: ${regexMax}, AI extraction: ${llmMax}).`,
    };
  }

  return {
    trust: "likely",
    note: `Sources disagree — the page text reads as up to ${regexMax} guests, while AI extraction of the same page reads ${llmMax}. Confirm the real figure with the venue.`,
  };
}

/**
 * Turns a discovered candidate + whatever the scraper found into a
 * database-ready draft, with every confidence field derived from what was
 * actually observed rather than assumed. This is the single place that
 * decides verified vs. likely vs. ai_extracted vs. unverified.
 */
export function buildVenueDraft(
  candidate: CandidateVenue,
  signals: ScrapedSignals | null,
  llm: LlmExtraction | null = null
): VenueDraft {
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
      menuUrl: null,
      menuTrust: "unverified",
      dietaryNotes: null,
      dietaryTrust: "unverified",
    };
  }

  const hasCapacityNumbers = signals.capacityNumbers.length > 0;
  const regexMax = hasCapacityNumbers ? signals.capacityNumbers.at(-1)! : null;
  const llmRooms = llm?.rooms ?? [];
  const llmMax = llmRooms.length > 0 ? Math.max(...llmRooms.map((r) => r.maxCapacity)) : null;
  const reconciled = reconcileCapacity(regexMax, llmMax);

  const capacityTrust: TrustLevel = signals.privateDiningPageFound
    ? hasCapacityNumbers
      ? "verified"
      : "likely"
    : "unverified";

  let rooms: DraftRoom[];

  if (hasCapacityNumbers) {
    rooms = [
      {
        roomName: "Private Dining / Event Space",
        minCapacity: signals.capacityNumbers[0] !== regexMax ? signals.capacityNumbers[0] : undefined,
        maxCapacity: regexMax!,
        style,
        // Agreement between two independent reads can raise an otherwise
        // `likely` figure; disagreement can lower an otherwise `verified` one.
        capacityTrust: reconciled?.trust ?? capacityTrust,
        notes: reconciled
          ? reconciled.note
          : "Capacity figure(s) extracted from the venue's own private-dining/events page.",
      },
    ];
  } else if (llmRooms.length > 0) {
    // The regex pass found no figure but the model read named rooms out of the
    // page's prose. Each becomes a real room, labeled by how it was obtained.
    rooms = llmRooms.map((room) => ({
      roomName: room.roomName,
      minCapacity: room.minCapacity ?? undefined,
      maxCapacity: room.maxCapacity,
      style,
      capacityTrust: "ai_extracted",
      notes: "Read from the venue's own page by AI because the page states capacity in prose rather than a standard format. Confirm before booking.",
    }));
  } else {
    rooms = [
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
  }

  const regexMinSpend = signals.minSpendUsd.length > 0 ? Math.min(...signals.minSpendUsd) : null;
  const minSpendUsd = regexMinSpend ?? llm?.minSpendUsd ?? null;
  const minSpendTrust: TrustLevel = regexMinSpend != null ? "verified" : llm?.minSpendUsd != null ? "ai_extracted" : "unverified";

  // Regex-matched phrases come straight off the venue's page, so they're
  // `likely` — the phrase is real, but "vegan" appearing near private-dining
  // copy isn't a commitment to cater a vegan event. An LLM summary of the same
  // page is labeled by its method instead.
  const dietaryNotes = signals.dietaryNotes ?? llm?.dietaryNotes ?? null;
  const dietaryTrust: TrustLevel = signals.dietaryNotes ? "likely" : llm?.dietaryNotes ? "ai_extracted" : "unverified";

  const sourceNoteParts = [
    `Auto-discovered and cross-checked against ${signals.scrapedUrls.length} page(s) of the venue's own website.`,
    signals.privateDiningPageFound
      ? hasCapacityNumbers
        ? "A dedicated private-dining/events page was found with an explicit capacity figure."
        : "A private-events page was found but it doesn't publish a specific capacity number."
      : "No dedicated private-dining or events page was found on the site.",
    signals.renderedWithJs
      ? "This site renders its content with JavaScript, so a browser-rendering pass was used to read it."
      : null,
    "Always confirm details directly with the venue before booking.",
  ].filter((part): part is string => part !== null);

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
    minSpendTrust,
    description: signals.descriptionExcerpt ?? `${candidate.name} — discovered near your search location.`,
    sourceNote: sourceNoteParts.join(" "),
    rooms,
    imageUrl: candidate.photoUrl ?? null,
    menuUrl: signals.menuUrl,
    // A menu link found while a private-dining page was confirmed is a real
    // artifact on the venue's own site; the same link found without one could
    // just be the regular restaurant menu.
    menuTrust: signals.menuUrl ? (signals.privateDiningPageFound ? "verified" : "likely") : "unverified",
    dietaryNotes,
    dietaryTrust,
  };
}
