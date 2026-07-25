import { redirect } from "next/navigation";
import { getCurrentCompany, getDisplayName } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { performSearch } from "@/lib/search";
import { SearchForm } from "@/components/search-form";
import { AddressPicker } from "@/components/address-picker";
import { VenueCard } from "@/components/venue-card";
import MapView from "@/components/map-view-loader";
import type { RoomStyle } from "@/lib/supabase/types";

const SEARCH_FORM_ID = "pdf-search-form";

type SearchPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const company = await getCurrentCompany();
  if (!company) redirect("/");

  const params = await searchParams;
  const get = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const supabase = createServiceClient();
  const { data: savedAddresses } = await supabase
    .from("saved_addresses")
    .select("*")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });

  const savedAddressId = get("savedAddressId") || undefined;
  const addressQuery = get("addressQuery") || undefined;
  const headcountRaw = get("headcount");
  const maxCommuteRaw = get("maxCommuteMinutes");
  const commuteMode = get("commuteMode") === "drive" ? "drive" : "walk";
  const styleRaw = get("style");
  const style: RoomStyle | undefined = styleRaw === "seated" || styleRaw === "reception" ? styleRaw : undefined;

  const hasOrigin = Boolean(savedAddressId || addressQuery);
  const headcount = headcountRaw ? parseInt(headcountRaw, 10) : undefined;
  const maxCommuteMinutes = maxCommuteRaw ? parseInt(maxCommuteRaw, 10) : undefined;
  const shouldSearch = hasOrigin && !!headcount && !!maxCommuteMinutes;
  // headcount/maxCommuteMinutes are always present once the form has been
  // submitted at least once (they carry defaults), so their presence with
  // no origin means the user searched without picking or typing an address.
  const searchedWithoutOrigin = (headcountRaw !== undefined || maxCommuteRaw !== undefined) && !hasOrigin;
  const isPristine = headcountRaw === undefined && maxCommuteRaw === undefined;

  const outcome = shouldSearch
    ? await performSearch({
        companyId: company.id,
        savedAddressId,
        addressQuery,
        headcount: headcount!,
        maxCommuteMinutes: maxCommuteMinutes!,
        commuteMode,
        style,
        createdBy: await getDisplayName(),
      })
    : null;

  let shortlistedIds = new Set<string>();
  if (outcome && outcome.results.length > 0) {
    const { data: shortlist } = await supabase.from("shortlist_items").select("venue_id").eq("company_id", company.id);
    shortlistedIds = new Set((shortlist ?? []).map((s) => s.venue_id));
  }

  return (
    <div className="mx-auto flex max-w-[100rem] flex-col gap-6 px-6 py-8 lg:px-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find private dining venues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by address, headcount, and how far people can travel.
        </p>
      </div>

      <div className="flex flex-col gap-6 rounded-xl border bg-card p-5 shadow-sm">
        <AddressPicker
          searchFormId={SEARCH_FORM_ID}
          addresses={savedAddresses ?? []}
          selectedSavedAddressId={savedAddressId}
          addressQueryDefault={addressQuery}
          defaultToFirstSaved={isPristine}
        />
        <SearchForm
          formId={SEARCH_FORM_ID}
          defaultValues={{
            headcount: headcountRaw,
            maxCommuteMinutes: maxCommuteRaw,
            commuteMode,
            style: styleRaw,
          }}
        />
      </div>

      {searchedWithoutOrigin && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Pick a saved office or enter an address above before searching.
        </p>
      )}

      {outcome?.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{outcome.error}</p>
      )}

      {outcome && !outcome.error && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm text-muted-foreground">
            {outcome.results.length} venue{outcome.results.length === 1 ? "" : "s"} within {maxCommuteMinutes} min {commuteMode} of{" "}
            <span className="font-medium text-foreground">{outcome.origin.label}</span>
          </h2>

          {outcome.results.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No venues fit that commute and headcount yet. Try a longer commute window or a smaller/larger group — or
              check back shortly, we may still be discovering venues in this area.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_460px]">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 order-2 lg:order-1">
                {outcome.results.map((ranked, i) => (
                  <VenueCard
                    key={ranked.venue.id}
                    ranked={ranked}
                    rank={i + 1}
                    searchId={outcome.searchId}
                    isShortlisted={shortlistedIds.has(ranked.venue.id)}
                  />
                ))}
              </div>
              <div className="order-1 h-[320px] lg:sticky lg:top-4 lg:order-2 lg:h-[calc(100vh-8rem)]">
                <MapView
                  className="h-full w-full"
                  origin={{ lat: outcome.origin.lat, lng: outcome.origin.lng, label: outcome.origin.label }}
                  venues={outcome.results.map((r, i) => ({
                    id: r.venue.id,
                    name: r.venue.name,
                    lat: r.venue.lat,
                    lng: r.venue.lng,
                    rank: i + 1,
                    commuteMinutes: r.commuteMinutes,
                    capacity: r.bestRoom.max_capacity,
                    trustLevel: r.bestRoom.capacity_trust,
                  }))}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
