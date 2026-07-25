import * as cheerio from "cheerio";

export type ScrapedSignals = {
  privateDiningPageFound: boolean;
  scrapedUrls: string[];
  capacityNumbers: number[];
  minSpendUsd: number[];
  email: string | null;
  phone: string | null;
  descriptionExcerpt: string | null;
};

const PRIVATE_DINING_KEYWORDS =
  /private\s*(dining|event)s?|group\s*(dining|event|booking)s?|banquet|meetings?\s*(&|and)?\s*events|weddings?|celebrations|book\s*(an\s*)?event|buyouts?/i;

const CAPACITY_PATTERN = /(?:up\s*to|seats?|accommodat(?:es|ing)|hold[s]?|for)\s*(\d{1,4})\s*(?:guests?|people|persons?|pax)/gi;
const MIN_SPEND_PATTERN = /(?:minimum\s*spend|f&b\s*minimum|food\s*(?:and|&)\s*beverage\s*minimum)[^\d$]{0,20}\$?\s?([\d,]{3,7})/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

const FETCH_TIMEOUT_MS = 8000;
const MAX_SUBPAGES = 2;

async function fetchText(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "private-dining-finder/0.1 (event-planning research tool)" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractNumbers(text: string, pattern: RegExp): number[] {
  const numbers: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const raw = match[1]?.replace(/,/g, "");
    const value = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isNaN(value) && value > 0) numbers.push(value);
  }
  return numbers;
}

/**
 * Fetches a venue's homepage, follows links that look like a private
 * dining / events / banquet page (up to MAX_SUBPAGES of them), and
 * extracts capacity numbers, minimum-spend figures, and contact details
 * via pattern matching over the visible text. This is the automated
 * replacement for manually reading a venue's website.
 *
 * Limitation: static fetch + parse, no JS execution — sites that render
 * their private-dining content client-side (SPA-heavy sites) will come
 * back with privateDiningPageFound: false even if the info exists, which
 * correctly degrades that venue to an "unverified — needs a call" trust
 * label rather than silently missing data.
 */
export async function scrapeVenueForPrivateDining(website: string): Promise<ScrapedSignals> {
  const empty: ScrapedSignals = {
    privateDiningPageFound: false,
    scrapedUrls: [],
    capacityNumbers: [],
    minSpendUsd: [],
    email: null,
    phone: null,
    descriptionExcerpt: null,
  };

  const homepageHtml = await fetchText(website);
  if (!homepageHtml) return empty;

  const base = new URL(website);
  const $ = cheerio.load(homepageHtml);

  // Deliberately not scraping og:image / twitter:image as a photo source:
  // for chains and franchises (common among discovered venues) that meta
  // tag is usually generic brand marketing imagery, not a photo of this
  // specific location — showing it as "the venue's photo" is misleading,
  // not just low-quality. The one accurate photo source is Google Places
  // Photos (a photo actually submitted for this exact location), wired in
  // at the discovery step (see src/lib/discovery/places.ts) when
  // GOOGLE_PLACES_API_KEY is set. Without that key, venues simply show no
  // photo rather than a wrong one.

  const candidateLinks = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text();
    if (!href) return;
    if (!PRIVATE_DINING_KEYWORDS.test(text) && !PRIVATE_DINING_KEYWORDS.test(href)) return;
    try {
      const resolved = new URL(href, base).toString();
      if (new URL(resolved).hostname === base.hostname) candidateLinks.add(resolved);
    } catch {
      // ignore malformed hrefs (mailto:, tel:, javascript:, etc.)
    }
  });

  const pagesToScrape = [website, ...Array.from(candidateLinks).slice(0, MAX_SUBPAGES)];
  const scrapedUrls: string[] = [];
  const textChunks: string[] = [];
  let privateDiningPageFound = false;

  for (const url of pagesToScrape) {
    const html = url === website ? homepageHtml : await fetchText(url);
    if (!html) continue;
    scrapedUrls.push(url);

    const page$ = cheerio.load(html);
    page$("script, style, nav, footer, noscript, iframe, template").remove();
    // Defense in depth: some sites embed literal HTML strings inside text
    // nodes (e.g. malformed analytics snippets) that cheerio's own tag
    // stripping won't catch since they aren't real child elements.
    const text = page$("body")
      .text()
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    textChunks.push(text);

    if (url !== website && PRIVATE_DINING_KEYWORDS.test(text)) privateDiningPageFound = true;
  }

  const combinedText = textChunks.join(" \n ");
  const capacityNumbers = extractNumbers(combinedText, CAPACITY_PATTERN).sort((a, b) => a - b);
  const minSpendUsd = extractNumbers(combinedText, MIN_SPEND_PATTERN);
  const email = combinedText.match(EMAIL_PATTERN)?.[0] ?? null;
  const phone = combinedText.match(PHONE_PATTERN)?.[0] ?? null;

  // Prefer an excerpt from the private-dining page itself (chunk index 1+)
  // over the homepage for the venue description.
  const descriptionSource = textChunks[1] ?? textChunks[0] ?? "";
  const descriptionExcerpt = descriptionSource ? descriptionSource.slice(0, 320).trim() : null;

  return {
    privateDiningPageFound,
    scrapedUrls,
    capacityNumbers,
    minSpendUsd,
    email,
    phone,
    descriptionExcerpt,
  };
}
