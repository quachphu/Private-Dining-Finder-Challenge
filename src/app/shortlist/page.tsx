import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Check, Columns3, PartyPopper, Share2, Utensils, X } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { clearSelectedVenueAction, removeFromShortlistAction, selectVenueAction } from "@/app/actions";
import { TrustBadge } from "@/components/trust-badge";
import { BackToResults } from "@/components/back-to-results";
import { CopyEventLink } from "@/components/copy-event-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { priceSignal } from "@/lib/price-signal";
import { cn } from "@/lib/utils";
import type { ShortlistItemRow, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

/**
 * The decide-and-commit step.
 *
 * Deliberately free of discussion threads and media tools, which used to sit
 * inline on every row: a page whose job is "compare these and pick one"
 * becomes unusable when each candidate is taller than the screen, and the
 * comparison is exactly what gets pushed off it. Per-venue conversation lives
 * on that venue's own page, and the attendee-facing conversation lives on
 * /event/[code] once a venue is chosen.
 */
export default async function ShortlistPage() {
  const company = await getCurrentCompany();
  if (!company) redirect("/");

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("shortlist_items")
    .select("*, venue:venues(*, rooms:venue_rooms(*), photos:venue_photos(*))")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  const items = (data ?? []) as unknown as (ShortlistItemRow & {
    venue: VenueRow & { rooms: VenueRoomRow[]; photos: VenuePhotoRow[] };
  })[];

  const selected = items.find((i) => i.is_selected) ?? null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <BackToResults />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">Shortlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared with everyone at {company.name} who has the workspace code. Compare the candidates, then pick the one
            you&apos;re going with.
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex gap-2">
            {items.length >= 2 && (
              <Link href="/compare" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <Columns3 className="size-4" />
                Compare
              </Link>
            )}
            <Link href={`/summary/${company.code}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Share2 className="size-4" />
              Shareable summary
            </Link>
          </div>
        )}
      </div>

      {selected && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-600/25 bg-emerald-50/60 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <PartyPopper className="size-3.5" />
              Going with this one
            </div>
            <Link href={`/venue/${selected.venue.id}`} className="mt-0.5 block font-medium hover:underline">
              {selected.venue.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              Send attendees the invite link below so they can tell you about allergies and dietary needs — not the
              workspace code, which would give them access to search and shortlist too.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <CopyEventLink code={company.code} variant="default" />
            <Link href={`/event/${company.code}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Open event page
            </Link>
            <form action={clearSelectedVenueAction}>
              <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
                Change
              </Button>
            </form>
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <Utensils className="size-5 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Nothing shortlisted yet — add venues from the search results.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const bestRoom = [...item.venue.rooms].sort((a, b) => a.max_capacity - b.max_capacity)[0];
            const primaryPhoto = item.venue.photos.find((p) => p.is_primary) ?? item.venue.photos[0];
            const price = priceSignal(item.venue);
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
                  item.is_selected && "border-emerald-600/30 ring-1 ring-emerald-600/15"
                )}
              >
                <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {primaryPhoto && (
                    <Image src={primaryPhoto.url} alt={item.venue.name} fill className="object-cover" unoptimized />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/venue/${item.venue.id}`} className="font-medium hover:underline">
                    {item.venue.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{item.venue.formatted_address}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {bestRoom && (
                      <span className="inline-flex items-center gap-1">
                        <Badge variant="secondary">Up to {bestRoom.max_capacity}</Badge>
                        <TrustBadge level={bestRoom.capacity_trust} subject="Capacity" />
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Badge variant="secondary">{price.label}</Badge>
                      <TrustBadge level={price.trust} subject="Price" />
                    </span>
                    {item.added_by && <span className="text-xs text-muted-foreground">added by {item.added_by}</span>}
                  </div>
                </div>

                {item.is_selected ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-600/10 px-2.5 py-1 text-xs font-medium text-emerald-700">
                    <Check className="size-3.5" />
                    Chosen
                  </span>
                ) : (
                  <form action={selectVenueAction} className="shrink-0">
                    <input type="hidden" name="venueId" value={item.venue.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Choose for the event
                    </Button>
                  </form>
                )}

                <form action={removeFromShortlistAction}>
                  <input type="hidden" name="venueId" value={item.venue.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${item.venue.name} from shortlist`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-4" />
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
