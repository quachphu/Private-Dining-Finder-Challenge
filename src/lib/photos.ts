/**
 * The curated seed venues carry placeholder imagery so the UI has something to
 * lay out, but a stock photo captioned "Wayfare Tavern private dining room" is
 * a factual claim about a room the planner is evaluating — and a false one.
 *
 * Rather than deleting the images (which would leave the demo dataset visually
 * bare) or leaving them misleading, they're detected here and labeled in the
 * UI. Auto-discovered venues never get a placeholder at all: only genuine
 * Google Places photos of that exact location are stored, and venues without
 * one show an explicit "no photo found" state.
 */
const PLACEHOLDER_HOSTS = ["picsum.photos"];

export function isPlaceholderPhoto(url: string): boolean {
  try {
    return PLACEHOLDER_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
