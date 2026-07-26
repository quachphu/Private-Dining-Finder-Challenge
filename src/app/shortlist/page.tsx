import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Columns3, Share2, Utensils, X } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { removeFromShortlistAction } from "@/app/actions";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ShortlistChat } from "@/components/shortlist-chat";
import { priceSignal } from "@/lib/price-signal";
import { cn } from "@/lib/utils";
import type { ShortlistItemRow, ShortlistMessageRow, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

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

  const { data: messageRows } = items.length
    ? await supabase
        .from("shortlist_messages")
        .select("*")
        .in(
          "shortlist_item_id",
          items.map((i) => i.id)
        )
        .order("created_at", { ascending: true })
    : { data: [] as ShortlistMessageRow[] };

  const messagesByItem = new Map<string, ShortlistMessageRow[]>();
  for (const row of messageRows ?? []) {
    const list = messagesByItem.get(row.shortlist_item_id) ?? [];
    list.push(row);
    messagesByItem.set(row.shortlist_item_id, list);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
          <p className="text-sm text-muted-foreground">
            Shared with everyone at {company.name} who has the workspace code — message the team on any venue to weigh
            in, live.
          </p>
        </div>
        {items.length >= 2 && (
          <div className="flex gap-2">
            <Link href="/compare" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Columns3 className="size-4" />
              Compare
            </Link>
            <Link href={`/summary/${company.code}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              <Share2 className="size-4" />
              Shareable summary
            </Link>
          </div>
        )}
      </div>

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
                className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-center gap-4">
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

                <div className="border-t pt-3">
                  <ShortlistChat shortlistItemId={item.id} initialMessages={messagesByItem.get(item.id) ?? []} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
