/**
 * Checks the free-text parser against real sentences, including ones that
 * deliberately omit fields — the important behaviour isn't that it fills
 * everything in, it's that it leaves unstated fields alone.
 *
 * Run with: npx tsx scripts/verify-nl-query.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { isNaturalLanguageSearchConfigured, parseNaturalLanguageQuery } from "@/lib/nl-query";

const CASES: Array<{ text: string; expect: string }> = [
  {
    text: "50 people near Times Square, New York, NY, under 20 minute commute",
    expect: "all four fields: Times Square / 50 / 20 / any mode",
  },
  {
    text: "30 for a sit-down dinner by Salesforce Tower at 415 Mission St, San Francisco, nothing over a 15 minute walk",
    expect: "address + 30 + 15 + walk + seated",
  },
  {
    text: "200 guests, happy hour reception style, near Hilton Hawaiian Village Waikiki, 15 minute walk max",
    expect: "address + 200 + 15 + walk + reception",
  },
  {
    text: "somewhere nice for a team dinner",
    expect: "everything null — no location, headcount, or time was stated",
  },
  {
    text: "drinks for the team near our Flatiron office",
    expect: "address + reception, but headcount and commute must stay null",
  },
];

async function main() {
  if (!isNaturalLanguageSearchConfigured()) {
    console.log("XAI_API_KEY not set — free-text parsing is disabled and the form is used directly.");
    return;
  }

  for (const testCase of CASES) {
    const parsed = await parseNaturalLanguageQuery(testCase.text);
    console.log(`\n"${testCase.text}"`);
    console.log(`  expected: ${testCase.expect}`);
    console.log(`  parsed:   ${JSON.stringify(parsed)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
