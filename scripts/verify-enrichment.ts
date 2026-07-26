/**
 * Verifies the two enrichment tiers against real venue sites, since unit tests
 * can only prove the wiring, not that the external APIs still behave as
 * documented. Run with: npx tsx scripts/verify-enrichment.ts
 *
 * Costs a small number of Firecrawl credits and Grok tokens per run.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { extractPrivateDiningWithLlm, isLlmExtractionConfigured } from "../src/lib/discovery/llm-extract";
import { isRenderFallbackConfigured, renderPage } from "../src/lib/discovery/render";
import { scrapeVenueForPrivateDining } from "../src/lib/discovery/scraper";

const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["https://www.wayfaretavern.com/private-events", "https://www.perbaccosf.com/private-dining/"];

async function main() {
  console.log(`Firecrawl configured: ${isRenderFallbackConfigured()}`);
  console.log(`Grok configured:      ${isLlmExtractionConfigured()}\n`);

  console.log("--- Firecrawl render, direct ---");
  const rendered = await renderPage(SITES[0]);
  console.log(
    rendered
      ? `  OK ${SITES[0]} -> ${rendered.text.length} chars, ${rendered.links.length} links\n  excerpt: ${rendered.text.slice(0, 160)}...`
      : `  FAILED to render ${SITES[0]}`
  );

  for (const site of SITES) {
    console.log(`\n=== ${site} ===`);
    const signals = await scrapeVenueForPrivateDining(site);
    console.log(`  pages scraped:        ${signals.scrapedUrls.length}`);
    console.log(`  private dining page:  ${signals.privateDiningPageFound}`);
    console.log(`  rendered with JS:     ${signals.renderedWithJs}`);
    console.log(`  capacity numbers:     ${signals.capacityNumbers.join(", ") || "none"}`);
    console.log(`  min spend:            ${signals.minSpendUsd.join(", ") || "none"}`);
    console.log(`  menu url:             ${signals.menuUrl ?? "none"}`);
    console.log(`  dietary:              ${signals.dietaryNotes ?? "none"}`);
    console.log(`  text captured:        ${signals.combinedText.length} chars`);

    if (!signals.combinedText) continue;

    const llm = await extractPrivateDiningWithLlm("Test Venue", signals.combinedText);
    if (!llm) {
      console.log("  LLM extraction:       FAILED / returned nothing");
      continue;
    }
    console.log(`  LLM hosts events:     ${llm.hostsPrivateEvents}`);
    console.log(`  LLM rooms:            ${llm.rooms.map((r) => `${r.roomName} (${r.minCapacity ?? "?"}-${r.maxCapacity})`).join("; ") || "none"}`);
    console.log(`  LLM min spend:        ${llm.minSpendUsd ?? "none"}`);
    console.log(`  LLM dietary:          ${llm.dietaryNotes ?? "none"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
