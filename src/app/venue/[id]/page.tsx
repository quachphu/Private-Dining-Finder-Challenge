import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PartyPopper } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { addToShortlistAction, removeFromShortlistAction } from "@/app/actions";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { VenueConfirmationCard } from "@/components/venue-confirmation-card";
import { CopyEventLink } from "@/components/copy-event-link";
import { BackToSearch } from "@/components/back-to-search";
import { cn } from "@/lib/utils";
import type { VenueConfirmationRow, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

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
    .select("id, note, added_by, is_selected")
    .eq("company_id", company.id)
    .eq("venue_id", id)
    .maybeSingle();

  // Not filtered by company: confirmations are facts about the venue that any
  // workspace contributed, and seeing who confirmed what is the point.
  const { data: confirmationRows } = await supabase
    .from("venue_confirmations")
    .select("*")
    .eq("venue_id", id)
    .order("created_at", { ascending: false });

  const confirmations = (confirmationRows ?? []) as VenueConfirmationRow[];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <BackToSearch />

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
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">{typedVenue.name}</h1>
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

      {/* No discussion thread here while still comparing — a candidate's
          detail page is for reading facts about it, not for chatting.
          A live chat only makes sense once there's one venue and an actual
          headcount of attendees to have it with, which is why it lives on
          /event/[code] instead, gated behind is_selected. */}
      {shortlisted && (
        <section
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4",
            shortlisted.is_selected ? "border-emerald-600/25 bg-emerald-50/60" : "bg-muted/40"
          )}
        >
          {shortlisted.is_selected ? (
            <>
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <PartyPopper className="size-3.5" />
                  Chosen for the event
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Send attendees the invite link so they can tell you about allergies and dietary needs.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <CopyEventLink code={company.code} variant="default" />
                <Link href={`/event/${company.code}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  Open event page
                </Link>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Shortlisted{shortlisted.added_by ? ` by ${shortlisted.added_by}` : ""}. Choose it from the{" "}
              <Link href="/shortlist" className="underline hover:text-foreground">
                shortlist
              </Link>{" "}
              to open a chat for everyone attending.
            </p>
          )}
        </section>
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
            <li className="flex items-center gap-2">
              {typedVenue.menu_url ? (
                <>
                  <a href={typedVenue.menu_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Menu ↗
                  </a>
                  <TrustBadge level={typedVenue.menu_trust} subject="Menu" />
                </>
              ) : (
                <span className="text-muted-foreground">No menu found on the venue&apos;s site — ask when you call.</span>
              )}
            </li>
            {!typedVenue.phone && !typedVenue.email && !typedVenue.website && (
              <li className="text-muted-foreground">No contact info found — search for the venue directly.</li>
            )}
          </ul>
        </div>
      </section>

      {/* Rendered even when empty: "we looked and found nothing published" is
          real information to a planner with dietary requirements, whereas
          hiding the section leaves them unsure whether it was checked. */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-medium">Dietary accommodations</h2>
          {typedVenue.dietary_notes && <TrustBadge level={typedVenue.dietary_trust} subject="Dietary info" />}
        </div>
        <p className="text-sm text-muted-foreground">
          {typedVenue.dietary_notes ?? "Nothing published on the venue's own site. Confirm requirements directly when you call."}
        </p>
      </section>

      <Separator />

      <VenueConfirmationCard
        venueId={typedVenue.id}
        venueName={typedVenue.name}
        venueEmail={typedVenue.email}
        venuePhone={typedVenue.phone}
        rooms={rooms}
        confirmations={confirmations}
      />

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
