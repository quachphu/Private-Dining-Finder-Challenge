/**
 * Where the browser remembers the last search that actually ran.
 *
 * Session storage rather than a cookie: the shortlist page needs this at
 * render time, and Next only permits writing cookies from Server Actions and
 * Route Handlers, never while rendering a page — so a cookie would have cost
 * an extra round-trip just to remember something the tab already knows.
 * Scoped per tab, which is the right lifetime for "the results I was looking
 * at a moment ago".
 */
export const LAST_SEARCH_STORAGE_KEY = "pdf_last_search";

/** Reads the remembered query string, tolerating storage being unavailable. */
export function readLastSearch(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_SEARCH_STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled by policy — callers fall back to a
    // bare /search, which is where they'd have landed anyway.
    return null;
  }
}
