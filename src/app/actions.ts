"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
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

export async function removeFromShortlistAction(formData: FormData) {
  const company = await getCurrentCompany();
  if (!company) throw new Error("No active workspace.");

  const venueId = String(formData.get("venueId") ?? "");
  const supabase = createServiceClient();
  await supabase.from("shortlist_items").delete().eq("company_id", company.id).eq("venue_id", venueId);

  revalidatePath("/shortlist");
  revalidatePath(`/venue/${venueId}`);
}
