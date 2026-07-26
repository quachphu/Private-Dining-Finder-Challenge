/**
 * No venue in the current dataset carries a stock placeholder photo — curated
 * seed venues either have a genuine photo (see realPhoto() in seed-venues.ts)
 * or none at all, and auto-discovered venues only ever store a real Google
 * Places photo of that exact location. A stock photo captioned "Wayfare
 * Tavern private dining room" is a factual claim about a room the planner is
 * evaluating, and a false one, so an earlier version of this dataset that used
 * picsum.photos filler was removed rather than kept "labeled but misleading."
 *
 * This check is kept as a defensive backstop rather than deleted: it costs
 * nothing, and it means any future placeholder that sneaks back in (a bad
 * manual DB edit, a regression in seed data) still gets caught and labeled
 * instead of silently rendering as if it were real.
 */
const PLACEHOLDER_HOSTS = ["picsum.photos"];

export function isPlaceholderPhoto(url: string): boolean {
  try {
    return PLACEHOLDER_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
