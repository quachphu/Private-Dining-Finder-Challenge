/**
 * Exercises the 3 required scenarios directly against performSearch(),
 * bypassing the HTTP/cookie layer (no browser available in this sandbox).
 * Not part of the app — delete before shipping, or keep as a smoke test.
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { createClient } from "@supabase/supabase-js";
import { performSearch } from "../src/lib/search";

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: company, error } = await supabase
    .from("companies")
    .insert({ name: "Test Co", code: `TEST-${Date.now()}` })
    .select("*")
    .single();
  if (error || !company) throw error ?? new Error("no company");
  console.log(`Created test company ${company.id} (${company.code})\n`);

  const scenarios = [
    {
      label: "NYC — 50 people near Times Square, <20 min commute",
      addressQuery: "Times Square, New York, NY",
      headcount: 50,
      maxCommuteMinutes: 20,
      commuteMode: "walk" as const,
    },
    {
      label: "SF — 30 people near Salesforce Tower, <15 min commute",
      addressQuery: "415 Mission St, San Francisco, CA 94105",
      headcount: 30,
      maxCommuteMinutes: 15,
      commuteMode: "walk" as const,
    },
    {
      label: "Waikiki — 200 people, reception style, near Hilton Hawaiian Village, <15 min walk",
      addressQuery: "Hilton Hawaiian Village Waikiki Beach Resort, Waikiki, HI",
      headcount: 200,
      maxCommuteMinutes: 15,
      commuteMode: "walk" as const,
      style: "reception" as const,
    },
  ];

  for (const scenario of scenarios) {
    console.log(`\n=== ${scenario.label} ===`);
    const outcome = await performSearch({
      companyId: company.id,
      addressQuery: scenario.addressQuery,
      headcount: scenario.headcount,
      maxCommuteMinutes: scenario.maxCommuteMinutes,
      commuteMode: scenario.commuteMode,
      style: scenario.style,
      createdBy: "smoke-test",
    });

    if (outcome.error) {
      console.error("  ERROR:", outcome.error);
      continue;
    }

    console.log(`  Origin resolved to: ${outcome.origin.label} (${outcome.origin.lat.toFixed(4)}, ${outcome.origin.lng.toFixed(4)})`);
    console.log(`  ${outcome.results.length} result(s):`);
    for (const r of outcome.results) {
      console.log(
        `   - ${r.venue.name} | ${Math.round(r.commuteMinutes)} min | room "${r.bestRoom.room_name}" up to ${r.bestRoom.max_capacity} (${r.bestRoom.capacity_trust}) | score=${r.score.toFixed(2)}`
      );
    }
  }

  await supabase.from("companies").delete().eq("id", company.id);
  console.log("\nCleaned up test company.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
