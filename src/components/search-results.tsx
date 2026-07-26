import { createServiceClient } from "@/lib/supabase/server";
import { VenueCard } from "@/components/venue-card";
import { MapPanel } from "@/components/map-panel";
import type { SearchStages } from "@/lib/search-stages";
import type { CommuteMode } from "@/lib/geo/commute";

/**
 * The results half of the search page, split into its own async component so
 * the page shell (form, progress panel) can stream to the browser while the
 * pipeline is still working. Everything here waits on the final stage.
 */
export async function SearchResults({
  stages,
  companyId,
  headcount,
  maxCommuteMinutes,
  commuteMode,
}: {
  stages: SearchStages;
  companyId: string;
  headcount: number;
  maxCommuteMinutes: number;
  commuteMode: CommuteMode;
}) {
  const outcome = await stages.outcome;

  if (outcome.error) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        {outcome.error}
      </p>
    );
  }

  let shortlistedIds = new Set<string>();
  if (outcome.results.length > 0) {
    const supabase = createServiceClient();
    const { data: shortlist } = await supabase.from("shortlist_items").select("venue_id").eq("company_id", companyId);
    shortlistedIds = new Set((shortlist ?? []).map((s) => s.venue_id));
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm text-muted-foreground">
        {outcome.results.length} venue{outcome.results.length === 1 ? "" : "s"} within {maxCommuteMinutes} min{" "}
        {commuteMode} of <span className="font-medium text-foreground">{outcome.origin.label}</span>
      </h2>

      {outcome.results.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No venues fit that commute and headcount yet. Try a longer commute window or a smaller/larger group — or check
          back shortly, we may still be discovering venues in this area.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_460px]">
          <div className="grid gap-4 self-start sm:grid-cols-2 xl:grid-cols-3 order-2 lg:order-1">
            {outcome.results.map((ranked, i) => (
              <VenueCard
                key={ranked.venue.id}
                ranked={ranked}
                rank={i + 1}
                searchId={outcome.searchId}
                isShortlisted={shortlistedIds.has(ranked.venue.id)}
                headcount={headcount}
              />
            ))}
          </div>
          <div className="order-1 h-[320px] lg:sticky lg:top-4 lg:order-2 lg:h-[calc(100vh-8rem)]">
            <MapPanel
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
  );
}
