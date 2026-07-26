import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { TrustBadge } from "@/components/trust-badge";
import { addToShortlistAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import { costPerPerson, priceSignal } from "@/lib/price-signal";
import { isPlaceholderPhoto } from "@/lib/photos";
import type { RankedVenue } from "@/lib/ranking";

export function VenueCard({
  ranked,
  rank,
  searchId,
  isShortlisted,
  headcount,
}: {
  ranked: RankedVenue;
  rank: number;
  searchId: string | null;
  isShortlisted: boolean;
  headcount: number;
}) {
  const { venue, bestRoom, commuteMinutes, reasons } = ranked;
  const primaryPhoto = venue.photos.find((p) => p.is_primary) ?? venue.photos[0];
  const price = priceSignal(venue);
  const perPerson = costPerPerson(venue, headcount);
  const isPlaceholder = primaryPhoto ? isPlaceholderPhoto(primaryPhoto.url) : false;

  return (
    <Card className="group overflow-hidden py-0 gap-0 transition-shadow duration-200 hover:shadow-md">
      <Link href={`/venue/${venue.id}`} className="block">
        <div className="relative h-44 w-full bg-muted">
          {primaryPhoto ? (
            <>
              <Image
                src={primaryPhoto.url}
                alt={isPlaceholder ? `Placeholder image — not a photo of ${venue.name}` : (primaryPhoto.alt_text ?? venue.name)}
                fill
                sizes="(max-width: 640px) 100vw, 33vw"
                className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                unoptimized
              />
              {isPlaceholder && (
                <span className="absolute inset-x-0 bottom-0 bg-foreground/70 px-2 py-1 text-center text-[10px] font-medium text-background">
                  Placeholder image — not this venue
                </span>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImageOff className="size-5" />
              <span className="text-xs">No photo found</span>
            </div>
          )}
          <span
            className={cn(
              "absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background shadow-sm"
            )}
          >
            {rank}
          </span>
          {venue.source === "auto_discovered" && (
            <Badge className="absolute right-2 top-2 bg-background/90 text-foreground" variant="outline">
              Newly discovered
            </Badge>
          )}
        </div>
      </Link>

      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/venue/${venue.id}`} className="font-medium leading-tight hover:underline">
            {venue.name}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">{venue.formatted_address}</p>

        {/* Capacity and price are deliberately paired with their own trust
            badge rather than sharing one: they're independently sourced, so
            a verified capacity says nothing about how reliable the price is. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
          <Badge variant="secondary">{Math.round(commuteMinutes)} min</Badge>
          <span className="inline-flex items-center gap-1">
            <Badge variant="secondary">
              Fits {bestRoom.max_capacity}
              {bestRoom.min_capacity ? `–${bestRoom.min_capacity}` : ""}
            </Badge>
            <TrustBadge level={bestRoom.capacity_trust} subject="Capacity" />
          </span>
          <span className="inline-flex items-center gap-1">
            <Badge variant="secondary">{price.label}</Badge>
            <TrustBadge level={price.trust} subject="Price" />
          </span>
          {/* Shares the price signal's trust badge above rather than repeating
              it — the estimate is arithmetic on that same figure, so a second
              badge would imply a second, independent source. */}
          {perPerson && <Badge variant="outline">{perPerson.label}</Badge>}
        </div>

        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {reasons.slice(0, 2).map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="flex items-center justify-between gap-2 py-4">
        <Link href={`/venue/${venue.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          View details
        </Link>
        <form action={addToShortlistAction}>
          <input type="hidden" name="venueId" value={venue.id} />
          {searchId && <input type="hidden" name="searchId" value={searchId} />}
          <Button type="submit" size="sm" variant={isShortlisted ? "default" : "outline"}>
            {isShortlisted ? "Shortlisted" : "Add to shortlist"}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
