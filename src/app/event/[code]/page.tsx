import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, MapPin } from "lucide-react";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentCompany, getDisplayName } from "@/lib/workspace";
import { EventThread } from "@/components/event-thread";
import { CopyEventLink } from "@/components/copy-event-link";
import type {
  DietarySummaryRow,
  ShortlistItemRow,
  ShortlistMessageRow,
  VenuePhotoRow,
  VenueRow,
} from "@/lib/supabase/types";

/**
 * The event page: one link the host shares with everyone attending, once a
 * venue is chosen.
 *
 * Auth model matches /summary/[code] — possession of the link is the
 * credential. That's a deliberate trade: the alternative is asking every
 * attendee to enter a workspace code and register a name before they can type
 * "I'm allergic to shellfish", and at 50 or 200 guests that friction costs the
 * host the very replies the page exists to collect. The blast radius is bounded
 * to posting a message into one thread, which the host can read and correct.
 *
 * Attendee-facing content comes first: there is one host and potentially
 * hundreds of guests, so the page is ordered for the guest who arrived to do
 * one thing and leave.
 *
 * "Host" here means whoever's browser holds this workspace's cookie (the
 * same test every other page in the app uses to mean "on the team"), not a
 * distinct role in the database — the extra controls (asking the question,
 * building the roster) only need to be hidden from randoms holding the
 * link, not from every colleague.
 */
export default async function EventPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createServiceClient();

  const { data: company } = await supabase.from("companies").select("id, name, code").eq("code", code).maybeSingle();
  if (!company) notFound();

  const viewer = await getCurrentCompany();
  const isHost = viewer?.id === company.id;

  const { data: selectedRow } = await supabase
    .from("shortlist_items")
    .select("*, venue:venues(*, photos:venue_photos(*))")
    .eq("company_id", company.id)
    .eq("is_selected", true)
    .maybeSingle();

  const selected = selectedRow as unknown as (ShortlistItemRow & { venue: VenueRow & { photos: VenuePhotoRow[] } }) | null;

  if (!selected?.venue) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-20 text-center">
        <CalendarCheck className="size-6 text-muted-foreground/50" />
        <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">
          The venue hasn&apos;t been picked yet. Check back once the host has chosen where you&apos;re going — you&apos;ll
          be able to tell them about allergies and dietary needs right here.
        </p>
      </div>
    );
  }

  const [{ data: messageRows }, { data: summaryRows }] = await Promise.all([
    supabase
      .from("shortlist_messages")
      .select("*")
      .eq("shortlist_item_id", selected.id)
      .eq("channel", "event")
      .order("created_at", { ascending: true }),
    supabase
      .from("dietary_summaries")
      .select("*")
      .eq("shortlist_item_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const messages = (messageRows ?? []) as ShortlistMessageRow[];
  const latestSummary = ((summaryRows ?? []) as DietarySummaryRow[])[0] ?? null;
  const photo = selected.venue.photos.find((p) => p.is_primary) ?? selected.venue.photos[0];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{company.name} · private dining</p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">
          We&apos;re going to {selected.venue.name}
        </h1>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          {selected.venue.formatted_address}
        </p>
      </header>

      {photo && (
        <div className="relative h-56 w-full overflow-hidden rounded-2xl bg-muted">
          <Image src={photo.url} alt={selected.venue.name} fill className="object-cover" unoptimized />
        </div>
      )}

      {isHost && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed bg-muted/40 p-3.5">
          <p className="text-xs text-muted-foreground">
            This is the page to send attendees — not the workspace code, which would give them access to the whole
            search &amp; shortlist platform instead of just this.
          </p>
          <CopyEventLink code={company.code} />
        </div>
      )}

      <EventThread
        code={company.code}
        shortlistItemId={selected.id}
        initialMessages={messages}
        defaultName={await getDisplayName()}
        isHost={isHost}
        venueName={selected.venue.name}
        venueEmail={selected.venue.email}
        latestSummary={latestSummary}
      />

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        Nothing on this page books or holds anything — it&apos;s where the group&apos;s requirements are collected so the
        host can pass them on.{" "}
        <Link href={`/venue/${selected.venue.id}`} className="underline hover:text-foreground">
          See the venue&apos;s rooms, menu and contact details
        </Link>
        .
      </footer>
    </div>
  );
}
