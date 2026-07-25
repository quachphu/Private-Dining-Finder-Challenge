import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { MessageSquare } from "lucide-react";
import { addToShortlistAction, removeFromShortlistAction } from "@/app/actions";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import type { VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

type VenuePageProps = {
  params: Promise<{ id: string }>;
};

export default async function VenuePage({ params }: VenuePageProps) {
  const company = await getCurrentCompany();
  if (!company) redirect("/");

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: venue } = await supabase
    .from("venues")
    .select("*, rooms:venue_rooms(*), photos:venue_photos(*)")
    .eq("id", id)
    .maybeSingle();

  if (!venue) notFound();

  const typedVenue = venue as unknown as VenueRow & { rooms: VenueRoomRow[]; photos: VenuePhotoRow[] };
  const rooms = [...typedVenue.rooms].sort((a, b) => a.max_capacity - b.max_capacity);
  const photos = [...typedVenue.photos].sort((a, b) => a.sort_order - b.sort_order);

  const { data: shortlisted } = await supabase
    .from("shortlist_items")
    .select("id, note, added_by")
    .eq("company_id", company.id)
    .eq("venue_id", id)
    .maybeSingle();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <Link href="/search" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to search
      </Link>

      {photos.length > 1 ? (
        <Carousel className="w-full">
          <CarouselContent>
            {photos.map((photo) => (
              <CarouselItem key={photo.id}>
                <div className="relative h-80 w-full overflow-hidden rounded-lg bg-muted">
                  <Image src={photo.url} alt={photo.alt_text ?? typedVenue.name} fill className="object-cover" unoptimized />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-2" />
          <CarouselNext className="right-2" />
        </Carousel>
      ) : photos[0] ? (
        <div className="relative h-80 w-full overflow-hidden rounded-lg bg-muted">
          <Image src={photos[0].url} alt={photos[0].alt_text ?? typedVenue.name} fill className="object-cover" unoptimized />
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{typedVenue.name}</h1>
          <p className="text-sm text-muted-foreground">{typedVenue.formatted_address}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {typedVenue.category}
            {typedVenue.neighborhood ? ` · ${typedVenue.neighborhood}` : ""}
          </p>
        </div>
        <form action={shortlisted ? removeFromShortlistAction : addToShortlistAction}>
          <input type="hidden" name="venueId" value={typedVenue.id} />
          <Button type="submit" variant={shortlisted ? "default" : "outline"}>
            {shortlisted ? "Remove from shortlist" : "Add to shortlist"}
          </Button>
        </form>
      </div>

      {typedVenue.description && <p className="text-sm leading-relaxed">{typedVenue.description}</p>}

      {shortlisted && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
          <form action={addToShortlistAction} className="flex items-center gap-2">
            <input type="hidden" name="venueId" value={typedVenue.id} />
            <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            <Input
              name="note"
              defaultValue={shortlisted.note ?? ""}
              placeholder="Add a note for the team — e.g. great price, but no AV setup"
              className="h-8 bg-background text-sm"
            />
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>
          {shortlisted.note && (
            <p className="pl-6 text-xs text-muted-foreground">Last note from {shortlisted.added_by ?? "a teammate"}</p>
          )}
        </div>
      )}

      <Separator />

      <section>
        <h2 className="mb-3 font-medium">Private rooms &amp; spaces</h2>
        <div className="flex flex-col gap-3">
          {rooms.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No room details available yet — call the venue directly to ask about private dining.
            </p>
          )}
          {rooms.map((room) => (
            <div key={room.id} className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{room.room_name}</div>
                <div className="text-sm text-muted-foreground">
                  {room.min_capacity ? `${room.min_capacity}–` : "Up to "}
                  {room.max_capacity} guests · {room.style === "either" ? "seated or reception" : room.style}
                </div>
                {room.notes && <div className="mt-1 text-xs text-muted-foreground">{room.notes}</div>}
              </div>
              <TrustBadge level={room.capacity_trust} />
            </div>
          ))}
        </div>
      </section>

      <Separator />

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 font-medium">Price signal</h2>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Price tier</span>
              <Badge variant="secondary">{typedVenue.price_tier ?? "Unknown"}</Badge>
              <TrustBadge level={typedVenue.price_tier_trust} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Minimum spend</span>
              <Badge variant="secondary">{typedVenue.min_spend_usd != null ? `$${typedVenue.min_spend_usd.toLocaleString()}` : "Unknown"}</Badge>
              <TrustBadge level={typedVenue.min_spend_trust} />
            </div>
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-medium">Contact</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {typedVenue.phone && <li>{typedVenue.phone}</li>}
            {typedVenue.email && (
              <li>
                <a href={`mailto:${typedVenue.email}`} className="text-primary hover:underline">
                  {typedVenue.email}
                </a>
              </li>
            )}
            {typedVenue.website && (
              <li>
                <a href={typedVenue.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Website ↗
                </a>
              </li>
            )}
            {typedVenue.menu_url && (
              <li>
                <a href={typedVenue.menu_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Menu ↗
                </a>
              </li>
            )}
            {!typedVenue.phone && !typedVenue.email && !typedVenue.website && (
              <li className="text-muted-foreground">No contact info found — search for the venue directly.</li>
            )}
          </ul>
        </div>
      </section>

      {typedVenue.dietary_notes && (
        <section>
          <h2 className="mb-2 font-medium">Dietary accommodations</h2>
          <p className="text-sm text-muted-foreground">{typedVenue.dietary_notes}</p>
        </section>
      )}

      {typedVenue.source_note && (
        <>
          <Separator />
          <section className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Why we show this: </span>
            {typedVenue.source_note}
          </section>
        </>
      )}
    </div>
  );
}
