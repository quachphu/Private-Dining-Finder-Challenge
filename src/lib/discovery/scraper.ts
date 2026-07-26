import * as cheerio from "cheerio";
import { renderPage } from "@/lib/discovery/render";

export type ScrapedSignals = {
  privateDiningPageFound: boolean;
  scrapedUrls: string[];
  capacityNumbers: number[];
  minSpendUsd: number[];
  email: string | null;
  phone: string | null;
  descriptionExcerpt: string | null;
  menuUrl: string | null;
  /** Comma-joined dietary accommodations mentioned near private-dining content. */
  dietaryNotes: string | null;
  /** True when a JS-rendering pass produced signals the static pass missed. */
  renderedWithJs: boolean;
  /** Combined page text, retained so a later LLM pass can re-read the same
   *  source without re-fetching it. Not persisted. */
  combinedText: string;
};

const PRIVATE_DINING_KEYWORDS =
  /private\s*(dining|event)s?|group\s*(dining|event|booking)s?|banquet|meetings?\s*(&|and)?\s*events|weddings?|celebrations|book\s*(an\s*)?event|buyouts?/i;

const CAPACITY_PATTERN = /(?:up\s*to|seats?|accommodat(?:es|ing)|hold[s]?|for)\s*(\d{1,4})\s*(?:guests?|people|persons?|pax)/gi;
const MIN_SPEND_PATTERN = /(?:minimum\s*spend|f&b\s*minimum|food\s*(?:and|&)\s*beverage\s*minimum)[^\d$]{0,20}\$?\s?([\d,]{3,7})/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_PATTERN = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const MENU_LINK_PATTERN = /\bmenus?\b/i;

// Matched only against text already pulled from a venue's own pages. Kept to
// concrete, checkable accommodations — a generic "we accommodate dietary
// needs" is captured too, but as that phrase, not as a claim about which
// specific diets are handled.
const DIETARY_PATTERN =
  /\b(vegetarian|vegan|gluten[-\s]?free|dairy[-\s]?free|nut[-\s]?free|shellfish[-\s]?free|halal|kosher|pescatarian|plant[-\s]?based|dietary\s+(?:restrictions?|requirements?|needs?|preferences?)|food\s+allerg(?:y|ies)|allergens?)\b/gi;

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

/** Normalizes matched dietary phrases into a stable, de-duplicated list. */
export function extractDietaryNotes(text: string): string | null {
  const found = new Set<string>();
  for (const match of text.matchAll(DIETARY_PATTERN)) {
    found.add(match[0].toLowerCase().replace(/\s+/g, " ").replace(/\s/g, "-").replace(/-free/, " free"));
  }
  if (found.size === 0) return null;
  // Capped so a menu page listing every allergen doesn't produce an
  // unreadable wall of tags on the card.
  return Array.from(found).slice(0, 6).join(", ");
}

/** Picks the most plausible menu link, preferring PDFs on the venue's own host. */
export function pickMenuUrl(links: Array<{ href: string; text: string }>, baseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  const candidates: Array<{ url: string; isPdf: boolean }> = [];
  for (const { href, text } of links) {
    if (!MENU_LINK_PATTERN.test(text) && !MENU_LINK_PATTERN.test(href)) continue;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) continue;
      candidates.push({ url: resolved.toString(), isPdf: /\.pdf($|\?)/i.test(resolved.pathname) });
    } catch {
      // ignore malformed hrefs (mailto:, tel:, javascript:, etc.)
    }
  }

  if (candidates.length === 0) return null;
  // A linked PDF is almost always the real menu document; an HTML /menu page
  // is a good second choice.
  return (candidates.find((c) => c.isPdf) ?? candidates[0]).url;
}

function textFromHtml(html: string): { text: string; links: Array<{ href: string; text: string }> } {
  const $ = cheerio.load(html);
  const links: Array<{ href: string; text: string }> = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push({ href, text: $(el).text() });
  });

  $("script, style, nav, footer, noscript, iframe, template").remove();
  // Defense in depth: some sites embed literal HTML strings inside text
  // nodes (e.g. malformed analytics snippets) that cheerio's own tag
  // stripping won't catch since they aren't real child elements.
  const text = $("body")
    .text()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { text, links };
}

/**
 * Fetches a venue's homepage, follows links that look like a private
 * dining / events / banquet page (up to MAX_SUBPAGES of them), and
 * extracts capacity numbers, minimum-spend figures, menu links, dietary
 * accommodations, and contact details via pattern matching over the visible
 * text. This is the automated replacement for manually reading a venue's
 * website.
 *
 * When the static pass finds no capacity figure — either because the site
 * renders that content client-side, or because it blocked a plain fetch
 * outright — a JS-rendering pass retries the most relevant URL (see
 * src/lib/discovery/render.ts). If that also finds nothing, the venue still
 * degrades honestly to "unverified — needs a call" rather than guessing.
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
    menuUrl: null,
    dietaryNotes: null,
    renderedWithJs: false,
    combinedText: "",
  };

  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return empty;
  }

  // Deliberately not scraping og:image / twitter:image as a photo source:
  // for chains and franchises (common among discovered venues) that meta
  // tag is usually generic brand marketing imagery, not a photo of this
  // specific location — showing it as "the venue's photo" is misleading,
  // not just low-quality. The one accurate photo source is Google Places
  // Photos (a photo actually submitted for this exact location), wired in
  // at the discovery step (see src/lib/discovery/places.ts).

  const homepageHtml = await fetchText(website);

  const scrapedUrls: string[] = [];
  const textChunks: string[] = [];
  const allLinks: Array<{ href: string; text: string }> = [];
  let privateDiningPageFound = false;
  let privateDiningUrl: string | null = null;

  if (homepageHtml) {
    const homepage = textFromHtml(homepageHtml);
    allLinks.push(...homepage.links);

    const candidateLinks = new Set<string>();
    for (const { href, text } of homepage.links) {
      if (!PRIVATE_DINING_KEYWORDS.test(text) && !PRIVATE_DINING_KEYWORDS.test(href)) continue;
      try {
        const resolved = new URL(href, base).toString();
        if (new URL(resolved).hostname === base.hostname) candidateLinks.add(resolved);
      } catch {
        // ignore malformed hrefs
      }
    }

    scrapedUrls.push(website);
    textChunks.push(homepage.text);

    for (const url of Array.from(candidateLinks).slice(0, MAX_SUBPAGES)) {
      const html = await fetchText(url);
      if (!html) continue;
      const page = textFromHtml(html);
      scrapedUrls.push(url);
      textChunks.push(page.text);
      allLinks.push(...page.links);
      if (PRIVATE_DINING_KEYWORDS.test(page.text)) {
        privateDiningPageFound = true;
        privateDiningUrl ??= url;
      }
    }

    // Recorded even when the static pass can't reach the page itself: a
    // homepage link labeled "Private Events" is the best URL to render.
    if (!privateDiningUrl) privateDiningUrl = Array.from(candidateLinks)[0] ?? null;
  }

  let renderedWithJs = false;
  let capacityNumbers = extractNumbers(textChunks.join(" \n "), CAPACITY_PATTERN).sort((a, b) => a - b);

  // Gated on the static pass having produced no capacity figure, so rendering
  // spend goes only to pages the cheap path genuinely couldn't read.
  if (capacityNumbers.length === 0) {
    const rendered = await renderPage(privateDiningUrl ?? website);
    if (rendered?.text) {
      // Kept whatever it contains, not only when it mentions private dining:
      // sites that block a plain fetch outright leave rendering as the only
      // read available, and discarding it would also discard the contact
      // details, menu link, and the page text the LLM tier needs.
      renderedWithJs = true;
      capacityNumbers = extractNumbers(rendered.text, CAPACITY_PATTERN).sort((a, b) => a - b);
      textChunks.push(rendered.text);
      if (!scrapedUrls.includes(rendered.url)) scrapedUrls.push(rendered.url);
      allLinks.push(...rendered.links.map((href) => ({ href, text: href })));

      // The trust-relevant claim stays gated on evidence: only a rendered page
      // that is itself a private-dining page counts, not a homepage that
      // merely mentions the phrase.
      if (PRIVATE_DINING_KEYWORDS.test(rendered.text) && rendered.url !== website) privateDiningPageFound = true;
    }
  }

  if (scrapedUrls.length === 0) return empty;

  const combinedText = textChunks.join(" \n ");
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
    menuUrl: pickMenuUrl(allLinks, website),
    dietaryNotes: extractDietaryNotes(combinedText),
    renderedWithJs,
    combinedText,
  };
}
