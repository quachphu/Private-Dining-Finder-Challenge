import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { TrustBadge } from "@/components/trust-badge";
import { Badge } from "@/components/ui/badge";
import { costPerPerson, priceSignal } from "@/lib/price-signal";
import { TRUST_LABELS } from "@/lib/trust-labels";
import type { ShortlistItemRow, VenueRoomRow, VenueRow } from "@/lib/supabase/types";

/**
 * Read-only shortlist summary a planner can forward to a decision-maker.
 *
 * Auth model matches the rest of the app: possession of the workspace code is
 * the credential, the same way a Google Doc share link works. No cookie is set
 * and nothing here mutates state — deliberately, since the recipient is likely
 * an exec who should be able to open it and read it, not join a workspace.
 *
 * Still strictly a research artifact: there is no booking, holding, or payment
 * action anywhere on this page.
 */
type ShortlistWithVenue = ShortlistItemRow & {
  venue: VenueRow & { rooms: VenueRoomRow[] };
};

export default async function SummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const headcountRaw = Array.isArray(query.headcount) ? query.headcount[0] : query.headcount;
  const headcount = headcountRaw ? Number.parseInt(headcountRaw, 10) : null;

  const supabase = createServiceClient();

  const { data: company } = await supabase.from("companies").select("id, name, code").eq("code", code).maybeSingle();
  if (!company) notFound();

  const { data } = await supabase
    .from("shortlist_items")
    .select("*, venue:venues(*, rooms:venue_rooms(*))")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });

  const items = ((data ?? []) as unknown as ShortlistWithVenue[]).filter((i) => i.venue);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 print:py-0">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Private dining shortlist</p>
        <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? "venue" : "venues"} researched
          {headcount ? ` for ${headcount} guests` : ""}. Every figure below is labeled with how it was sourced — nothing here is a
          reservation, and no venue has been contacted on your behalf.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing shortlisted yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {items.map((item, index) => {
            const rooms = [...item.venue.rooms].sort((a, b) => a.max_capacity - b.max_capacity);
            const bestRoom = headcount ? (rooms.find((r) => r.max_capacity >= headcount) ?? rooms.at(-1)) : rooms[0];
            const price = priceSignal(item.venue);
            const perPerson = headcount ? costPerPerson(item.venue, headcount) : null;

            return (
              <li key={item.id} className="rounded-lg border p-4 break-inside-avoid">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">{index + 1}.</span>
                  <h2 className="font-medium">{item.venue.name}</h2>
                </div>
                <p className="mt-0.5 pl-5 text-sm text-muted-foreground">{item.venue.formatted_address}</p>

                <dl className="mt-3 grid gap-2 pl-5 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Space</dt>
                    <dd className="flex flex-wrap items-center gap-1.5">
                      {bestRoom ? (
                        <>
                          <span>{bestRoom.room_name}</span>
                          <Badge variant="secondary">up to {bestRoom.max_capacity}</Badge>
                          <TrustBadge level={bestRoom.capacity_trust} subject="Capacity" />
                        </>
                      ) : (
                        <span className="text-muted-foreground">No rooms listed</span>
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">Price</dt>
                    <dd className="flex flex-wrap items-center gap-1.5">
                      <span>{price.label}</span>
                      <TrustBadge level={price.trust} subject="Price" />
                      {perPerson && <Badge variant="outline">{perPerson.label}</Badge>}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">Contact</dt>
                    <dd>{[item.venue.phone, item.venue.email].filter(Boolean).join(" · ") || "None published"}</dd>
                  </div>

                  <div>
                    <dt className="text-xs text-muted-foreground">Dietary</dt>
                    <dd>{item.venue.dietary_notes ?? "Nothing published"}</dd>
                  </div>
                </dl>

                {item.note && (
                  <p className="mt-3 ml-5 border-l-2 pl-3 text-sm">
                    <span className="text-muted-foreground">{item.added_by ? `${item.added_by}: ` : ""}</span>
                    {item.note}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <footer className="border-t pt-4 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">What the labels mean</p>
        <ul className="flex flex-col gap-0.5">
          <li>
            <span className="font-medium">{TRUST_LABELS.confirmed_by_planner}</span> — someone contacted the venue and reported the
            figure back.
          </li>
          <li>
            <span className="font-medium">{TRUST_LABELS.verified}</span> — stated on the venue&apos;s own private-dining page.
          </li>
          <li>
            <span className="font-medium">{TRUST_LABELS.likely}</span> — the venue hosts private events but doesn&apos;t publish this
            number.
          </li>
          <li>
            <span className="font-medium">{TRUST_LABELS.ai_extracted}</span> — read from the venue&apos;s own wording by AI, not stated
            in a standard format.
          </li>
          <li>
            <span className="font-medium">{TRUST_LABELS.unverified}</span> — not confirmed anywhere; treat as a starting point only.
          </li>
        </ul>
      </footer>
    </div>
  );
}
