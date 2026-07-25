import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { addToShortlistAction, removeFromShortlistAction } from "@/app/actions";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShortlistItemRow, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
        <p className="text-sm text-muted-foreground">
          Shared with everyone at {company.name} who has the workspace code — leave a note on any venue so the team
          can weigh in.
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing shortlisted yet — add venues from the search results.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => {
            const bestRoom = [...item.venue.rooms].sort((a, b) => a.max_capacity - b.max_capacity)[0];
            const primaryPhoto = item.venue.photos.find((p) => p.is_primary) ?? item.venue.photos[0];
            return (
              <div key={item.id} className="flex flex-col gap-3 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-4">
                  <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
                    {primaryPhoto && (
                      <Image src={primaryPhoto.url} alt={item.venue.name} fill className="object-cover" unoptimized />
                    )}
                  </div>
                  <div className="flex-1">
                    <Link href={`/venue/${item.venue.id}`} className="font-medium hover:underline">
                      {item.venue.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{item.venue.formatted_address}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {bestRoom && <Badge variant="secondary">Up to {bestRoom.max_capacity}</Badge>}
                      {bestRoom && <TrustBadge level={bestRoom.capacity_trust} />}
                      {item.added_by && <span className="text-xs text-muted-foreground">added by {item.added_by}</span>}
                    </div>
                  </div>
                  <form action={removeFromShortlistAction}>
                    <input type="hidden" name="venueId" value={item.venue.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </div>

                <form action={addToShortlistAction} className="flex items-center gap-2 border-t pt-3">
                  <input type="hidden" name="venueId" value={item.venue.id} />
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    name="note"
                    defaultValue={item.note ?? ""}
                    placeholder="Add a note for the team — e.g. great price, but no AV setup"
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </form>
                {item.note && (
                  <p className="pl-6 text-xs text-muted-foreground">
                    Last note from {item.added_by ?? "a teammate"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
