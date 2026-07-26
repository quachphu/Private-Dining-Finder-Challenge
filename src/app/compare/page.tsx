import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ImageOff } from "lucide-react";
import { getCurrentCompany } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isPlaceholderPhoto } from "@/lib/photos";
import { costPerPerson, priceSignal } from "@/lib/price-signal";
import { cn } from "@/lib/utils";
import type { ShortlistItemRow, VenuePhotoRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

type ShortlistWithVenue = ShortlistItemRow & {
  venue: VenueRow & { rooms: VenueRoomRow[]; photos: VenuePhotoRow[] };
};

// Three columns is the practical limit for reading a comparison at a glance on
// a laptop; beyond that the table stops being a comparison and becomes a list
// again, which the search results page already does better.
const MAX_COLUMNS = 3;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const company = await getCurrentCompany();
  if (!company) redirect("/");

  const params = await searchParams;
  const headcountRaw = Array.isArray(params.headcount) ? params.headcount[0] : params.headcount;
  const headcount = headcountRaw ? Number.parseInt(headcountRaw, 10) : null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("shortlist_items")
    .select("*, venue:venues(*, rooms:venue_rooms(*), photos:venue_photos(*))")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });

  const items = ((data ?? []) as unknown as ShortlistWithVenue[]).filter((i) => i.venue).slice(0, MAX_COLUMNS);

  if (items.length < 2) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">Compare venues</h1>
        <p className="text-muted-foreground">
          Shortlist at least two venues and they&apos;ll appear here side by side — capacity, commute-ready contact details, price, and
          how much of each is actually confirmed.
        </p>
        <Link href="/search" className={cn(buttonVariants())}>
          Back to search
        </Link>
      </div>
    );
  }

  // Highlights the tightest fit per column when a headcount is known. Read from
  // the URL rather than stored, because "which room fits" is a property of the
  // event being planned, not of the shortlist.
  const bestRoomFor = (rooms: VenueRoomRow[]) => {
    const sorted = [...rooms].sort((a, b) => a.max_capacity - b.max_capacity);
    if (headcount) return sorted.find((r) => r.max_capacity >= headcount) ?? sorted.at(-1) ?? null;
    return sorted[0] ?? null;
  };

  const rows: Array<{ label: string; render: (item: ShortlistWithVenue) => React.ReactNode }> = [
    {
      label: "Address",
      render: (i) => <span className="text-muted-foreground">{i.venue.formatted_address}</span>,
    },
    {
      label: headcount ? `Best room for ${headcount}` : "Smallest private room",
      render: (i) => {
        const room = bestRoomFor(i.venue.rooms);
        if (!room) return <span className="text-muted-foreground">No rooms listed</span>;
        const fits = headcount ? room.max_capacity >= headcount : true;
        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{room.room_name}</span>
            <span className="flex flex-wrap items-center gap-1">
              <Badge variant={fits ? "secondary" : "outline"}>
                up to {room.max_capacity}
                {room.min_capacity ? ` (from ${room.min_capacity})` : ""}
              </Badge>
              <TrustBadge level={room.capacity_trust} subject="Capacity" />
            </span>
            {!fits && <span className="text-xs text-destructive">Too small for {headcount}</span>}
          </div>
        );
      },
    },
    {
      label: "All spaces",
      render: (i) =>
        i.venue.rooms.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {[...i.venue.rooms]
              .sort((a, b) => a.max_capacity - b.max_capacity)
              .map((room) => (
                <li key={room.id}>
                  {room.room_name} — {room.max_capacity}
                </li>
              ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">None listed</span>
        ),
    },
    {
      label: "Price signal",
      render: (i) => {
        const price = priceSignal(i.venue);
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary">{price.label}</Badge>
            <TrustBadge level={price.trust} subject="Price" />
          </span>
        );
      },
    },
    {
      label: headcount ? `Cost per person (${headcount})` : "Cost per person",
      render: (i) => {
        const perPerson = headcount ? costPerPerson(i.venue, headcount) : null;
        return perPerson ? (
          <Badge variant="outline">{perPerson.label}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {headcount ? "No minimum spend published to divide" : "Add a headcount to estimate"}
          </span>
        );
      },
    },
    {
      label: "Contact",
      render: (i) => {
        const parts = [i.venue.phone, i.venue.email].filter(Boolean);
        return parts.length > 0 || i.venue.website ? (
          <div className="flex flex-col gap-0.5 text-xs">
            {parts.map((p) => (
              <span key={p}>{p}</span>
            ))}
            {i.venue.website && (
              <a href={i.venue.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Website ↗
              </a>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">None found</span>
        );
      },
    },
    {
      label: "Menu",
      render: (i) =>
        i.venue.menu_url ? (
          <span className="flex flex-wrap items-center gap-1">
            <a href={i.venue.menu_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
              Menu ↗
            </a>
            <TrustBadge level={i.venue.menu_trust} subject="Menu" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">None found</span>
        ),
    },
    {
      label: "Dietary",
      render: (i) =>
        i.venue.dietary_notes ? (
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-xs">{i.venue.dietary_notes}</span>
            <TrustBadge level={i.venue.dietary_trust} subject="Dietary info" />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Nothing published</span>
        ),
    },
    {
      label: "Your note",
      render: (i) => <span className="text-xs text-muted-foreground">{i.note ?? "—"}</span>,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Compare venues</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} shortlisted {items.length === 1 ? "venue" : "venues"}, side by side. Trust labels travel with each figure so
            you can see which comparisons rest on confirmed data.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/shortlist" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back to shortlist
          </Link>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="w-40 border-b p-2 text-left align-bottom text-xs font-medium text-muted-foreground">&nbsp;</th>
              {items.map((item) => {
                const photo = item.venue.photos.find((p) => p.is_primary) ?? item.venue.photos[0];
                const placeholder = photo ? isPlaceholderPhoto(photo.url) : false;
                return (
                  <th key={item.id} className="border-b p-2 text-left align-bottom">
                    <div className="relative mb-2 h-24 w-full overflow-hidden rounded-md bg-muted">
                      {photo ? (
                        <>
                          <Image
                            src={photo.url}
                            alt={placeholder ? `Placeholder image — not a photo of ${item.venue.name}` : (photo.alt_text ?? item.venue.name)}
                            fill
                            sizes="240px"
                            className="object-cover"
                            unoptimized
                          />
                          {placeholder && (
                            <span className="absolute inset-x-0 bottom-0 bg-foreground/70 px-1 py-0.5 text-center text-[9px] text-background">
                              Placeholder
                            </span>
                          )}
                        </>
                      ) : (
                        <div className="flex h-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-4" />
                        </div>
                      )}
                    </div>
                    <Link href={`/venue/${item.venue.id}`} className="font-medium hover:underline">
                      {item.venue.name}
                    </Link>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="align-top">
                <th scope="row" className="border-b p-2 text-left text-xs font-medium text-muted-foreground">
                  {row.label}
                </th>
                {items.map((item) => (
                  <td key={item.id} className="border-b p-2">
                    {row.render(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
