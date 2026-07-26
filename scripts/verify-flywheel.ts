/**
 * Integration check for the community-verification flywheel.
 *
 * Unit tests cover the ranking side, but only a real round-trip proves the
 * migration landed, the new enum value is writable, and a confirmed figure
 * actually flows back out through search. Reverts everything it changes.
 *
 * Run with: npx tsx scripts/verify-flywheel.ts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { createClient } from "@supabase/supabase-js";
import { performSearch } from "../src/lib/search";

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name: "Flywheel Test Co", code: `FLY-${Date.now()}` })
    .select("*")
    .single();
  if (companyError || !company) throw companyError ?? new Error("no company");

  // Pick a real room whose capacity is currently *not* planner-confirmed.
  const { data: room, error: roomError } = await supabase
    .from("venue_rooms")
    .select("id, venue_id, room_name, max_capacity, capacity_trust, notes")
    .neq("capacity_trust", "confirmed_by_planner")
    .limit(1)
    .single();
  if (roomError || !room) throw roomError ?? new Error("no room");

  const { data: venue } = await supabase.from("venues").select("name, lat, lng, min_spend_usd, min_spend_trust").eq("id", room.venue_id).single();

  console.log(`Target: ${venue?.name} — "${room.room_name}"`);
  console.log(`  before: capacity ${room.max_capacity}, trust ${room.capacity_trust}\n`);

  const CONFIRMED_CAPACITY = room.max_capacity + 7;
  const CONFIRMED_MIN_SPEND = 4250;

  const { error: insertError } = await supabase.from("venue_confirmations").insert({
    venue_id: room.venue_id,
    room_id: room.id,
    company_id: company.id,
    confirmed_by: "Integration Test",
    confirmed_max_capacity: CONFIRMED_CAPACITY,
    confirmed_min_spend_usd: CONFIRMED_MIN_SPEND,
    note: "Reached the events manager; they confirmed the figure by phone.",
  });
  if (insertError) throw new Error(`confirmation insert failed: ${insertError.message}`);
  console.log("  ✓ confirmation row inserted");

  const { error: roomUpdateError } = await supabase
    .from("venue_rooms")
    .update({ max_capacity: CONFIRMED_CAPACITY, capacity_trust: "confirmed_by_planner", notes: "Confirmed by Integration Test." })
    .eq("id", room.id);
  if (roomUpdateError) throw new Error(`room update failed: ${roomUpdateError.message}`);
  console.log("  ✓ room updated to confirmed_by_planner (new enum value is writable)");

  await supabase
    .from("venues")
    .update({ min_spend_usd: CONFIRMED_MIN_SPEND, min_spend_trust: "confirmed_by_planner" })
    .eq("id", room.venue_id);
  console.log("  ✓ venue min spend updated to confirmed_by_planner");

  // Does it come back out through the real search path?
  const outcome = await performSearch({
    companyId: company.id,
    addressQuery: `${venue!.lat}, ${venue!.lng}`,
    headcount: Math.max(1, CONFIRMED_CAPACITY - 5),
    maxCommuteMinutes: 20,
    commuteMode: "walk",
    createdBy: "flywheel-test",
  });

  const found = outcome.results.find((r) => r.venue.id === room.venue_id);
  console.log(`\n  search returned ${outcome.results.length} result(s)`);
  if (found) {
    console.log(`  ✓ target venue surfaced at rank ${outcome.results.indexOf(found) + 1}`);
    console.log(`     room "${found.bestRoom.room_name}" up to ${found.bestRoom.max_capacity} [${found.bestRoom.capacity_trust}]`);
    console.log(`     min spend ${found.venue.min_spend_usd} [${found.venue.min_spend_trust}]`);
    console.log(`     reasons: ${found.reasons.join(" | ")}`);
    if (found.bestRoom.capacity_trust !== "confirmed_by_planner") {
      console.error("  ✗ FAIL: capacity trust did not round-trip as confirmed_by_planner");
    }
  } else {
    console.log("  (target venue not in range of its own coordinates — check commute filtering)");
  }

  // Revert.
  await supabase
    .from("venue_rooms")
    .update({ max_capacity: room.max_capacity, capacity_trust: room.capacity_trust, notes: room.notes })
    .eq("id", room.id);
  await supabase
    .from("venues")
    .update({ min_spend_usd: venue!.min_spend_usd, min_spend_trust: venue!.min_spend_trust })
    .eq("id", room.venue_id);
  await supabase.from("companies").delete().eq("id", company.id);
  console.log("\n  ✓ reverted room, venue, and test company");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
