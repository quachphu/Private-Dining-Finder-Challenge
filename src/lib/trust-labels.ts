import type { TrustLevel } from "@/lib/supabase/types";

/**
 * Human-facing wording for each trust tier, in one place.
 *
 * These are `Record<TrustLevel, ...>` rather than if/else chains on purpose:
 * adding a tier to the enum then becomes a type error everywhere it needs
 * wording, instead of silently falling through to whatever the final `else`
 * happened to say. That exact bug shipped once — a planner-confirmed capacity
 * was described as "unverified" because it wasn't literally `verified`.
 */
export const TRUST_LABELS: Record<TrustLevel, string> = {
  confirmed_by_planner: "Confirmed by call",
  verified: "Verified",
  likely: "Likely",
  ai_extracted: "AI-extracted",
  unverified: "Needs a call",
};

/** Sentence-length explanations of what a capacity figure's tier means. */
export const CAPACITY_TRUST_REASONS: Record<TrustLevel, string> = {
  confirmed_by_planner: "Capacity confirmed by a planner who contacted the venue directly",
  verified: "Capacity verified directly from the venue's own private-dining page",
  likely: "Capacity likely correct, but not independently confirmed — worth a quick call",
  ai_extracted: "Capacity read from the venue's page by AI, not stated in a standard format — confirm it",
  unverified: "Capacity unverified — call the venue to confirm before booking",
};

/** Short qualifier for a price figure, e.g. "Minimum spend ~$3,500 (confirmed by call)". */
export const PRICE_TRUST_QUALIFIERS: Record<TrustLevel, string> = {
  confirmed_by_planner: "confirmed by call",
  verified: "from the venue's site",
  likely: "estimated",
  ai_extracted: "AI-extracted",
  unverified: "unconfirmed",
};
