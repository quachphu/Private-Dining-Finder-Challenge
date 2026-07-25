/**
 * Loads the curated fallback venues (src/data/seed-venues.ts) into Supabase.
 * Geocodes each address via Nominatim (same adapter the app uses at
 * runtime) so seeded venues use real coordinates rather than hand-typed
 * approximations. Safe to re-run — venues are upserted by name+address.
 *
 * Usage: npm run seed
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { createClient } from "@supabase/supabase-js";
import { seedVenues } from "../src/data/seed-venues";
import { geocodeAddress } from "../src/lib/geo/geocode";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (in .env.local) before seeding.");
  }

  const supabase = createClient(url, serviceKey);

  for (const seed of seedVenues) {
    process.stdout.write(`Geocoding ${seed.name}... `);
    const geocoded = await geocodeAddress(seed.formattedAddress);
    if (!geocoded) {
      console.warn(`FAILED — skipping ${seed.name} (could not geocode "${seed.formattedAddress}")`);
      continue;
    }
    console.log(`${geocoded.lat.toFixed(4)}, ${geocoded.lng.toFixed(4)}`);

    const { data: existing } = await supabase
      .from("venues")
      .select("id")
      .eq("source", "curated_seed")
      .eq("name", seed.name)
      .maybeSingle();

    const venuePayload = {
      source: "curated_seed" as const,
      place_source_id: `seed-${seed.name}`,
      name: seed.name,
      formatted_address: seed.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      city_slug: seed.citySlug,
      category: seed.category,
      neighborhood: seed.neighborhood ?? null,
      price_tier: seed.priceTier ?? null,
      price_tier_trust: seed.priceTierTrust,
      min_spend_usd: seed.minSpendUsd ?? null,
      min_spend_trust: seed.minSpendTrust,
      phone: seed.phone ?? null,
      email: seed.email ?? null,
      website: seed.website ?? null,
      description: seed.description,
      dietary_notes: seed.dietaryNotes ?? null,
      menu_url: seed.menuUrl ?? null,
      source_note: seed.sourceNote,
      last_checked_at: new Date().toISOString(),
    };

    let venueId: string;
    if (existing) {
      venueId = existing.id;
      await supabase.from("venues").update(venuePayload).eq("id", venueId);
      await supabase.from("venue_rooms").delete().eq("venue_id", venueId);
      await supabase.from("venue_photos").delete().eq("venue_id", venueId);
    } else {
      const { data: inserted, error } = await supabase.from("venues").insert(venuePayload).select("id").single();
      if (error || !inserted) {
        console.error(`  Failed to insert ${seed.name}:`, error);
        continue;
      }
      venueId = inserted.id;
    }

    await supabase.from("venue_rooms").insert(
      seed.rooms.map((room) => ({
        venue_id: venueId,
        room_name: room.roomName,
        min_capacity: room.minCapacity ?? null,
        max_capacity: room.maxCapacity,
        style: room.style,
        capacity_trust: room.capacityTrust,
        notes: room.notes ?? null,
      }))
    );

    await supabase.from("venue_photos").insert(
      seed.photos.map((p, i) => ({
        venue_id: venueId,
        url: p.url,
        alt_text: p.alt,
        sort_order: i,
        is_primary: p.isPrimary ?? i === 0,
      }))
    );
  }

  console.log(`\nSeeded ${seedVenues.length} venues.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
