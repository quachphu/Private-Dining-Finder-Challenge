/**
 * JS-rendering fallback for venue sites the static scraper can't read.
 *
 * Why Firecrawl over self-hosting Playwright: this app runs on serverless
 * Next.js, where bundling a headless Chromium means a ~300MB dependency, cold
 * starts measured in seconds, and per-host anti-bot handling we'd own
 * ourselves. Firecrawl is a hosted call that returns rendered text, so the
 * fallback stays a single fetch with a timeout and degrades like any other
 * network call. The trade-off is a paid dependency and per-page cost, which is
 * why callers gate this behind "the static pass already came back empty"
 * rather than rendering everything.
 *
 * Deliberately requests `markdown` only (1 credit/page) rather than
 * Firecrawl's `json` extraction format (5 credits/page): extraction happens
 * separately, so the regex pass and the LLM pass stay two genuinely
 * independent reads of the same page and can be cross-referenced against
 * each other.
 *
 * Verified against the Firecrawl v2 API (api.firecrawl.dev/v2/scrape).
 */

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v2/scrape";
const RENDER_TIMEOUT_MS = 30_000;

export type RenderedPage = {
  url: string;
  text: string;
  links: string[];
};

export function isRenderFallbackConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

export async function renderPage(url: string): Promise<RenderedPage | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const res = await fetch(FIRECRAWL_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown", "links"], onlyMainContent: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Firecrawl render failed for ${url}: ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as {
      success?: boolean;
      data?: { markdown?: string; links?: Array<string | { url?: string }>; metadata?: { statusCode?: number } };
    };

    const markdown = payload.data?.markdown;
    // Firecrawl reports upstream 4xx/5xx as a successful scrape of an error
    // page, so the real status has to be checked separately or we'd extract
    // signals out of a 404 body.
    const statusCode = payload.data?.metadata?.statusCode;
    if (!payload.success || !markdown || (statusCode != null && statusCode >= 400)) return null;

    const links = (payload.data?.links ?? [])
      .map((link) => (typeof link === "string" ? link : link.url))
      .filter((link): link is string => Boolean(link));

    return { url, text: markdown.replace(/\s+/g, " ").trim(), links };
  } catch (err) {
    console.error(`Firecrawl render threw for ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
