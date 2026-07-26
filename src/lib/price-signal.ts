import type { TrustLevel, VenueRow } from "@/lib/supabase/types";

export type PriceSignal = {
  label: string;
  trust: TrustLevel;
  /** false when the venue publishes no price information at all */
  known: boolean;
};

type PriceFields = Pick<VenueRow, "min_spend_usd" | "min_spend_trust" | "price_tier" | "price_tier_trust">;

/**
 * Resolves the single price figure to show alongside its *own* trust label.
 *
 * The price signal must never inherit the capacity trust label — a venue can
 * publish an exact room capacity while saying nothing about cost, and showing
 * that price as "verified" because the capacity was verified would be a lie.
 * Minimum spend wins over price tier when both exist (it's the concrete
 * number a planner budgets against); with neither, the result is an explicit
 * unknown that still reads as "needs a call" rather than rendering blank.
 */
export function priceSignal(venue: PriceFields): PriceSignal {
  if (venue.min_spend_usd != null) {
    return {
      label: `$${venue.min_spend_usd.toLocaleString()} min spend`,
      trust: venue.min_spend_trust,
      known: true,
    };
  }

  if (venue.price_tier) {
    return { label: venue.price_tier, trust: venue.price_tier_trust, known: true };
  }

  return { label: "Price unknown", trust: "unverified", known: false };
}

export type CostPerPerson = {
  label: string;
  trust: TrustLevel;
};

/**
 * Per-head cost implied by the minimum spend, which is the number a planner is
 * actually asked for by their finance team.
 *
 * Only derived from a concrete minimum spend — a price tier ("$$$") carries no
 * arithmetic, and inventing a dollar range from it would manufacture precision
 * the source doesn't have. Returns null instead.
 *
 * The estimate inherits the minimum spend's trust label verbatim: an estimate
 * built on an unverified figure is itself unverified, and rounding it into a
 * clean per-person number makes it look far more solid than it is.
 *
 * Note this is a floor, not a forecast: the minimum spend is what the venue
 * requires you to spend, so actual cost per head can only go up from here.
 */
export function costPerPerson(venue: PriceFields, headcount: number): CostPerPerson | null {
  if (venue.min_spend_usd == null || headcount <= 0) return null;

  const perHead = venue.min_spend_usd / headcount;
  // Sub-dollar precision is noise at this confidence level.
  const rounded = perHead >= 10 ? Math.round(perHead) : Math.round(perHead * 10) / 10;

  return { label: `~$${rounded.toLocaleString()}/person min`, trust: venue.min_spend_trust };
}
