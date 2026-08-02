/**
 * Checks the dietary extraction against realistic event threads.
 *
 * The behaviour that matters here isn't that it produces a tidy list — it's
 * what it refuses to do. An invented allergy, or a preference promoted to an
 * allergy, is a failure that reaches a kitchen, so the cases below deliberately
 * include chatter with no dietary content, a preference phrased casually, a
 * later correction that must override an earlier message, and a thread where
 * the right answer is "nobody said anything".
 *
 * Run with: npx tsx scripts/verify-dietary-summary.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { isDietarySummaryConfigured, summarizeDietaryNeeds, type DietaryInputMessage } from "@/lib/dietary-summary";

const CASES: Array<{ label: string; expect: string; thread: DietaryInputMessage[] }> = [
  {
    label: "host asks, two allergies from the same person",
    expect: "one person (Phu Quach) with peanuts + soybeans, kind=allergy; the host's question is not a restriction",
    thread: [
      { author: "Phu Quach", message: "Hi are there anyone got allergy ?" },
      { author: "Phu Quach", message: "I got allergy with peanut" },
      { author: "Phu Quach", message: "I got allergy with Soybeans" },
    ],
  },
  {
    label: "allergy vs preference vs irrelevant chatter",
    expect: "Maya=allergy(shellfish), Tom=preference(meat/fish), Dana=preference(no pork); Raj omitted entirely",
    thread: [
      { author: "Host", message: "We're at Kokkari on the 14th — any allergies or dietary needs?" },
      { author: "Maya", message: "I'm severely allergic to shellfish, anaphylactic" },
      { author: "Tom", message: "vegetarian here, no meat or fish thanks" },
      { author: "Raj", message: "Is there parking nearby? I'm driving from the south bay" },
      { author: "Dana", message: "no pork for me please" },
    ],
  },
  {
    label: "one message mixing a preference and an allergy",
    expect: "Dana has pork=preference AND peanut=allergy — the two must not collapse into one severity",
    thread: [{ author: "Dana Ruiz", message: "no pork for me, and I got allergy with peanut" }],
  },
  {
    label: "later correction overrides earlier message",
    expect: "Sam appears once as intolerance (dairy), not allergy — the correction wins",
    thread: [
      { author: "Sam", message: "I'm allergic to dairy" },
      { author: "Sam", message: "actually correction — it's lactose intolerance, not a true allergy" },
    ],
  },
  {
    label: "nothing about food",
    expect: "empty people and aggregate; orderNote says none were reported. No invented entries.",
    thread: [
      { author: "Host", message: "Sending the address shortly" },
      { author: "Lee", message: "great, looking forward to it" },
    ],
  },
];

async function main() {
  if (!isDietarySummaryConfigured()) {
    console.log("XAI_API_KEY not set — the event page lists raw replies instead of a generated roster.");
    return;
  }

  for (const testCase of CASES) {
    const summary = await summarizeDietaryNeeds(testCase.thread);
    console.log(`\n── ${testCase.label}`);
    console.log(`   expected: ${testCase.expect}`);
    if (!summary) {
      console.log("   FAILED: no summary returned");
      continue;
    }
    for (const person of summary.people) {
      const needs = person.needs.map((n) => `${n.item}[${n.kind}]`).join(", ");
      console.log(`   ${person.name}: ${needs}  — "${person.quote}"`);
    }
    if (summary.people.length === 0) console.log("   (no people reported)");
    console.log(`   totals:  ${summary.aggregate.map((a) => `${a.requirement}×${a.count}`).join(", ") || "none"}`);
    if (summary.unclear.length > 0) console.log(`   unclear: ${summary.unclear.join(" | ")}`);
    console.log(`   note:    ${summary.orderNote}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
