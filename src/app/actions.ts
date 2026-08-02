"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { isEmptyParse, isNaturalLanguageSearchConfigured, parseNaturalLanguageQuery } from "@/lib/nl-query";
import { isDietarySummaryConfigured, summarizeDietaryNeeds } from "@/lib/dietary-summary";
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
    await supabase
      .from("shortlist_items")
      .insert({ company_id: company.id, venue_id: venueId, search_id: searchId, note, added_by: addedBy, is_selected: false });
  }

  revalidatePath("/shortlist");
  revalidatePath(`/venue/${venueId}`);
}

/**
 * Records which shortlisted venue the host is actually going with — the step
 * that turns a comparison into an event, and the point from which attendees
 * (rather than colleagues) become the audience.
 *
 * Two statements rather than one because a workspace can only have one chosen
 * venue: the partial unique index from migration 0010 rejects a second, so the
 * previous choice is stood down first. Clearing first also means the worst
 * outcome of a failure between the two is "nothing selected", which the
 * shortlist shows plainly, rather than two venues both claiming to be chosen.
 */
export async function selectVenueAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const venueId = String(formData.get("venueId") ?? "");
  if (!venueId) throw new Error("Venue is required.");

  const supabase = createServiceClient();
  await supabase.from("shortlist_items").update({ is_selected: false }).eq("company_id", company.id).eq("is_selected", true);

  const { error } = await supabase
    .from("shortlist_items")
    .update({ is_selected: true })
    .eq("company_id", company.id)
    .eq("venue_id", venueId);
  if (error) throw new Error("Could not select that venue.");

  revalidatePath("/shortlist");
  revalidatePath(`/venue/${venueId}`);
  revalidatePath(`/event/${company.code}`);
}

/** Reopens the decision without losing the shortlist or the event thread. */
export async function clearSelectedVenueAction() {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const supabase = createServiceClient();
  await supabase.from("shortlist_items").update({ is_selected: false }).eq("company_id", company.id).eq("is_selected", true);

  revalidatePath("/shortlist");
  revalidatePath(`/event/${company.code}`);
}

// Caps on what an un-authenticated attendee can write. The event page is
// reachable by anyone holding the link, so these bound the damage a bored
// guest can do to the host's roster without making a legitimate "I'm allergic
// to shellfish and peanuts" reply hit a limit.
const MAX_ATTENDEE_NAME_CHARS = 60;
const MAX_EVENT_MESSAGE_CHARS = 600;

/**
 * Posts an attendee's reply into the chosen venue's event thread.
 *
 * Addressed by workspace code and a typed name rather than by cookie, unlike
 * every other write in this file. The people answering "does anyone have an
 * allergy?" are dinner guests, not planners: requiring two hundred of them to
 * join a workspace first would lose most of the answers, and the answers are
 * the entire point. Possession of the event link is the credential, the same
 * model /summary/[code] already uses.
 *
 * No revalidatePath: everyone on the event page is already subscribed to
 * this thread over Realtime (see src/components/event-chat.tsx), so
 * re-rendering the page here would just be a redundant round-trip for the
 * sender on top of the push they already get.
 */
export async function sendEventMessageAction(formData: FormData) {
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_ATTENDEE_NAME_CHARS);
  const message = String(formData.get("message") ?? "")
    .trim()
    .slice(0, MAX_EVENT_MESSAGE_CHARS);

  if (!code) throw new Error("Missing event code.");
  if (!name) throw new Error("Add your name first so the host knows whose restriction this is.");
  if (!message) throw new Error("Message can't be empty.");

  const supabase = createServiceClient();
  const { data: company } = await supabase.from("companies").select("id").eq("code", code).maybeSingle();
  if (!company) throw new Error("That event link is no longer valid.");

  const { data: item } = await supabase
    .from("shortlist_items")
    .select("id")
    .eq("company_id", company.id)
    .eq("is_selected", true)
    .maybeSingle();
  if (!item) throw new Error("The host hasn't picked the venue yet — check back shortly.");

  const { error } = await supabase.from("shortlist_messages").insert({
    shortlist_item_id: item.id,
    company_id: company.id,
    author: name,
    message,
    is_highlight_reel: false,
    channel: "event",
  });
  if (error) throw new Error("Could not send that message.");
}

/**
 * Reads the event thread into a dietary roster the host can hand to the venue.
 *
 * Kept an explicit action rather than something that runs on every page view:
 * it costs an LLM call, and more importantly the host needs a snapshot they
 * can read, correct and forward — not a list that silently rewords itself
 * while they're looking at it. Each run is stored, so the page can say how
 * many replies it was based on and whether any have landed since.
 *
 * Fails loudly and changes nothing when the model is unavailable. The raw
 * replies stay on the page in that case, so an unreachable API degrades the
 * host to reading the thread themselves rather than to a half-built roster
 * they might mistake for complete — which, for allergies, is the failure that
 * actually matters.
 */
export async function generateDietarySummaryAction(formData: FormData) {
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  if (!code) throw new Error("Missing event code.");

  if (!isDietarySummaryConfigured()) {
    throw new Error("Automatic summarizing isn't configured (XAI_API_KEY). Everyone's replies are still listed below.");
  }

  const supabase = createServiceClient();
  const { data: company } = await supabase.from("companies").select("id").eq("code", code).maybeSingle();
  if (!company) throw new Error("That event link is no longer valid.");

  const { data: item } = await supabase
    .from("shortlist_items")
    .select("id")
    .eq("company_id", company.id)
    .eq("is_selected", true)
    .maybeSingle();
  if (!item) throw new Error("Pick the venue first — there's no event thread to read yet.");

  const { data: messages } = await supabase
    .from("shortlist_messages")
    .select("author, message")
    .eq("shortlist_item_id", item.id)
    .eq("channel", "event")
    .order("created_at", { ascending: true });

  const usable = (messages ?? []).filter((m) => m.message.trim());
  if (usable.length === 0) throw new Error("Nobody has replied yet, so there's nothing to summarize.");

  const summary = await summarizeDietaryNeeds(usable);
  if (!summary) throw new Error("Couldn't read the replies just now — nothing was changed. Try again in a moment.");

  const { error } = await supabase.from("dietary_summaries").insert({
    shortlist_item_id: item.id,
    company_id: company.id,
    summary,
    message_count: usable.length,
    generated_by: (await getDisplayName()) ?? null,
  });
  if (error) throw new Error("Could not save that summary.");

  revalidatePath(`/event/${code}`);
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
