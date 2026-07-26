"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { isEmptyParse, isNaturalLanguageSearchConfigured, parseNaturalLanguageQuery } from "@/lib/nl-query";
import {
  createCompanyWorkspace,
  getCurrentCompany,
  getDisplayName,
  joinCompanyWorkspace,
  leaveCompanyWorkspace,
  setDisplayName,
} from "@/lib/workspace";

export async function joinOrCreateWorkspaceAction(formData: FormData) {
  const mode = String(formData.get("mode") ?? "join");
  const displayName = String(formData.get("displayName") ?? "").trim();
  // Required in both flows: a workspace's organizer (creator) and every
  // joining member need a real name attached, so shortlist notes and the
  // workspace itself can always be attributed to someone.
  if (!displayName) throw new Error("Your name is required.");
  await setDisplayName(displayName);

  if (mode === "create") {
    // Creating a workspace starts from the office address, not the other
    // way around — the first saved address is established as part of
    // creation so a brand-new workspace is never empty.
    const companyName = String(formData.get("companyName") ?? "").trim();
    const addressLabel = String(formData.get("addressLabel") ?? "").trim();
    const addressQuery = String(formData.get("addressQuery") ?? "").trim();
    if (!addressLabel || !addressQuery) throw new Error("Office label and address are required.");
    if (!companyName) throw new Error("Workspace name is required.");

    const geocoded = await geocodeAddress(addressQuery);
    if (!geocoded) throw new Error("Could not find that address. Try adding city and state.");

    const { company } = await createCompanyWorkspace(companyName, displayName);

    const supabase = createServiceClient();
    await supabase.from("saved_addresses").insert({
      company_id: company.id,
      label: addressLabel,
      formatted_address: geocoded.formattedAddress,
      lat: geocoded.lat,
      lng: geocoded.lng,
      created_by: displayName,
    });
  } else {
    const code = String(formData.get("code") ?? "").trim();
    if (!code) throw new Error("Company code is required.");
    const company = await joinCompanyWorkspace(code);
    if (!company) throw new Error("No workspace found for that code — double check it or create a new one.");
  }

  redirect("/search");
}

export async function leaveWorkspaceAction() {
  await leaveCompanyWorkspace();
  redirect("/");
}

export async function saveAddressAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const label = String(formData.get("label") ?? "").trim();
  const addressQuery = String(formData.get("formattedAddress") ?? "").trim();
  if (!label || !addressQuery) throw new Error("Label and address are required.");

  const geocoded = await geocodeAddress(addressQuery);
  if (!geocoded) throw new Error("Could not geocode that address.");

  const createdBy = await getDisplayName();
  const supabase = createServiceClient();
  await supabase.from("saved_addresses").insert({
    company_id: company.id,
    label,
    formatted_address: geocoded.formattedAddress,
    lat: geocoded.lat,
    lng: geocoded.lng,
    created_by: createdBy,
  });

  revalidatePath("/search");
}

export async function deleteSavedAddressAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const id = String(formData.get("id") ?? "");
  const supabase = createServiceClient();
  await supabase.from("saved_addresses").delete().eq("id", id).eq("company_id", company.id);

  revalidatePath("/search");
}

export async function addToShortlistAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const venueId = String(formData.get("venueId") ?? "");
  const searchId = formData.get("searchId") ? String(formData.get("searchId")) : null;
  const note = formData.get("note") ? String(formData.get("note")) : null;
  const addedBy = await getDisplayName();

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from("shortlist_items")
    .select("id, search_id")
    .eq("company_id", company.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  if (existing) {
    // Editing a note (from the shortlist page) doesn't carry a searchId —
    // don't let that clobber the original search this venue was added from.
    await supabase
      .from("shortlist_items")
      .update({ note, added_by: addedBy, search_id: searchId ?? existing.search_id })
      .eq("id", existing.id);
  } else {
    await supabase.from("shortlist_items").insert({ company_id: company.id, venue_id: venueId, search_id: searchId, note, added_by: addedBy });
  }

  revalidatePath("/shortlist");
  revalidatePath(`/venue/${venueId}`);
}

/**
 * Records a figure a planner obtained by contacting the venue directly.
 *
 * Two writes, deliberately:
 *  1. An append-only `venue_confirmations` row — the provenance. Who reported
 *     it, from which workspace, and when.
 *  2. The denormalized figure on the room/venue itself, at
 *     `confirmed_by_planner` trust. This is what makes the feature a flywheel
 *     rather than a private note: every existing read path and the ranker pick
 *     it up with no changes, for every workspace, so the next planner
 *     searching that area starts from a confirmed number instead of
 *     "unverified — needs a call".
 *
 * Confirmations intentionally apply catalog-wide rather than per-workspace. A
 * venue's room capacity is a fact about the venue, not about the company that
 * asked, and scoping it privately would throw away the entire compounding
 * benefit.
 */
export async function confirmVenueDetailAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const venueId = String(formData.get("venueId") ?? "");
  if (!venueId) throw new Error("Venue is required.");

  const roomId = formData.get("roomId") ? String(formData.get("roomId")) : null;
  const note = formData.get("note") ? String(formData.get("note")).trim() : null;

  const rawCapacity = String(formData.get("confirmedMaxCapacity") ?? "").trim();
  const rawMinSpend = String(formData.get("confirmedMinSpendUsd") ?? "").trim();
  const confirmedMaxCapacity = rawCapacity ? Number.parseInt(rawCapacity, 10) : null;
  const confirmedMinSpendUsd = rawMinSpend ? Number.parseInt(rawMinSpend.replace(/[$,]/g, ""), 10) : null;

  if (confirmedMaxCapacity == null && confirmedMinSpendUsd == null) {
    throw new Error("Enter a confirmed capacity, a confirmed minimum spend, or both.");
  }
  if (confirmedMaxCapacity != null && (!Number.isFinite(confirmedMaxCapacity) || confirmedMaxCapacity <= 0)) {
    throw new Error("Confirmed capacity must be a positive number.");
  }
  if (confirmedMinSpendUsd != null && (!Number.isFinite(confirmedMinSpendUsd) || confirmedMinSpendUsd < 0)) {
    throw new Error("Confirmed minimum spend can't be negative.");
  }
  if (confirmedMaxCapacity != null && roomId == null) {
    throw new Error("Pick which room this capacity applies to.");
  }

  // A display name is set when joining or creating a workspace, but the cookie
  // can be lost. Attribution still resolves to the workspace rather than
  // recording the confirmation anonymously.
  const confirmedBy = (await getDisplayName()) ?? `Someone at ${company.name}`;
  const supabase = createServiceClient();

  const { error: insertError } = await supabase.from("venue_confirmations").insert({
    venue_id: venueId,
    room_id: roomId,
    company_id: company.id,
    confirmed_by: confirmedBy,
    confirmed_max_capacity: confirmedMaxCapacity,
    confirmed_min_spend_usd: confirmedMinSpendUsd,
    note,
  });
  if (insertError) throw new Error(`Could not record that confirmation: ${insertError.message}`);

  const attribution = `Confirmed by ${confirmedBy} (${company.name}) on ${new Date().toLocaleDateString("en-US", { dateStyle: "medium" })}.`;

  if (confirmedMaxCapacity != null && roomId) {
    await supabase
      .from("venue_rooms")
      .update({
        max_capacity: confirmedMaxCapacity,
        capacity_trust: "confirmed_by_planner",
        notes: note ? `${attribution} "${note}"` : attribution,
      })
      .eq("id", roomId)
      .eq("venue_id", venueId);
  }

  if (confirmedMinSpendUsd != null) {
    await supabase
      .from("venues")
      .update({ min_spend_usd: confirmedMinSpendUsd, min_spend_trust: "confirmed_by_planner" })
      .eq("id", venueId);
  }

  revalidatePath(`/venue/${venueId}`);
  revalidatePath("/shortlist");
  revalidatePath("/search");
}

/**
 * Turns a free-text event description into the structured search the form
 * already understands, then redirects so those values land in the URL and the
 * form fields visibly populate with them.
 *
 * It deliberately does not search on the planner's behalf with values they
 * haven't seen. Redirecting into the populated form means the parse is always
 * reviewable and correctable, and an address the model got wrong is obvious
 * before anyone reads a ranked list built on it.
 */
export async function naturalLanguageSearchAction(formData: FormData) {
  const text = String(formData.get("nlQuery") ?? "").trim();
  if (!text) redirect("/search");

  const params = new URLSearchParams({ nlQuery: text });

  if (!isNaturalLanguageSearchConfigured()) {
    redirect(`/search?${new URLSearchParams({ nlQuery: text, nlStatus: "unconfigured" })}`);
  }

  const parsed = await parseNaturalLanguageQuery(text);

  if (!parsed || isEmptyParse(parsed)) {
    params.set("nlStatus", parsed ? "empty" : "failed");
    redirect(`/search?${params}`);
  }

  // Only fields the sentence actually specified are written. Everything else is
  // left off the URL entirely so the form falls back to its own defaults rather
  // than to a value nobody chose.
  if (parsed.addressQuery) params.set("addressQuery", parsed.addressQuery);
  if (parsed.headcount) params.set("headcount", String(parsed.headcount));
  if (parsed.maxCommuteMinutes) params.set("maxCommuteMinutes", String(parsed.maxCommuteMinutes));
  if (parsed.commuteMode) params.set("commuteMode", parsed.commuteMode);
  if (parsed.style) params.set("style", parsed.style);
  params.set("nlStatus", "parsed");

  redirect(`/search?${params}`);
}

export async function removeFromShortlistAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const venueId = String(formData.get("venueId") ?? "");
  const supabase = createServiceClient();
  await supabase.from("shortlist_items").delete().eq("company_id", company.id).eq("venue_id", venueId);

  revalidatePath("/shortlist");
  revalidatePath(`/venue/${venueId}`);
}
