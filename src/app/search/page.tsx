import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentCompany, getDisplayName } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { startSearchStages } from "@/lib/search-stages";
import { SearchForm } from "@/components/search-form";
import { AddressPicker } from "@/components/address-picker";
import { NlSearchBox } from "@/components/nl-search-box";
import { PersonaPicker } from "@/components/persona-picker";
import { defaultsForPersona, parsePersona, resolveFormDefaults } from "@/lib/personas";
import type { CommuteMode } from "@/lib/geo/commute";
import { SearchPipeline } from "@/components/search-pipeline";
import { SearchResults } from "@/components/search-results";
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
  const persona = parsePersona(get("persona"));
  const personaDefaults = defaultsForPersona(persona);
  // The persona's mode is the fallback, so a planner who picked "Event marketer"
  // and searched without touching the dropdown gets driving distance as shown in
  // the form, not a silent revert to walking.
  const commuteMode: CommuteMode = get("commuteMode") === "drive" ? "drive" : get("commuteMode") === "walk" ? "walk" : personaDefaults.commuteMode;
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
  // A free-text parse counts as "the planner has expressed a choice" even when
  // it only recovered an address: without this, the pristine-page convenience of
  // pre-selecting the first saved office would silently discard the address they
  // just described.
  const isPristine = headcountRaw === undefined && maxCommuteRaw === undefined && get("nlQuery") === undefined;

  // Started, not awaited: the shell below streams to the browser immediately
  // and each stage fills itself in as it finishes. Awaiting here instead would
  // hold the entire page back until the slowest scrape returned.
  const stages = shouldSearch
    ? startSearchStages({
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

  return (
    <div className="mx-auto flex max-w-[100rem] flex-col gap-6 px-6 py-8 lg:px-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find private dining venues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by address, headcount, and how far people can travel.
        </p>
      </div>

      <div className="flex flex-col gap-6 rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-5">
          <PersonaPicker selected={persona} />
          <NlSearchBox defaultValue={get("nlQuery")} status={get("nlStatus")} />
        </div>

        <div className="flex flex-col gap-5 border-t pt-5">
          <AddressPicker
            searchFormId={SEARCH_FORM_ID}
            addresses={savedAddresses ?? []}
            selectedSavedAddressId={savedAddressId}
            addressQueryDefault={addressQuery}
            defaultToFirstSaved={isPristine}
          />
          <SearchForm
            formId={SEARCH_FORM_ID}
            persona={persona}
            defaultValues={resolveFormDefaults(persona, {
              headcount: headcountRaw,
              maxCommuteMinutes: maxCommuteRaw,
              commuteMode: get("commuteMode"),
              style: styleRaw,
            })}
          />
        </div>
      </div>

      {searchedWithoutOrigin && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Pick a saved office or enter an address above before searching.
        </p>
      )}

      {stages && (
        <>
          <SearchPipeline stages={stages} />
          <Suspense fallback={null}>
            <SearchResults
              stages={stages}
              companyId={company.id}
              headcount={headcount!}
              maxCommuteMinutes={maxCommuteMinutes!}
              commuteMode={commuteMode}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}
