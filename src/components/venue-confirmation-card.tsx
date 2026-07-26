"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Mail, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { confirmVenueDetailAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { VenueConfirmationRow, VenueRoomRow } from "@/lib/supabase/types";

type Props = {
  venueId: string;
  venueName: string;
  venueEmail: string | null;
  venuePhone: string | null;
  rooms: VenueRoomRow[];
  confirmations: VenueConfirmationRow[];
  /** Headcount from the search that led here, when known. */
  defaultHeadcount?: number;
};

const INPUT_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function VenueConfirmationCard({
  venueId,
  venueName,
  venueEmail,
  venuePhone,
  rooms,
  confirmations,
  defaultHeadcount,
}: Props) {
  const smallestRoom = useMemo(() => [...rooms].sort((a, b) => a.max_capacity - b.max_capacity)[0], [rooms]);

  const [headcount, setHeadcount] = useState(String(defaultHeadcount ?? smallestRoom?.max_capacity ?? 30));
  const [eventDate, setEventDate] = useState("");
  const [roomId, setRoomId] = useState(smallestRoom?.id ?? "");
  const [copied, setCopied] = useState(false);

  const selectedRoom = rooms.find((r) => r.id === roomId) ?? smallestRoom;

  const draft = useMemo(() => {
    const when = eventDate ? `on ${eventDate}` : "on a date we're still finalizing";
    const room = selectedRoom ? `your "${selectedRoom.room_name}" space` : "your private dining space";
    return [
      `Hi ${venueName} team,`,
      "",
      `I'm planning a private group dinner for ${headcount} guests ${when}, and I'm looking at ${room}.`,
      "",
      "Could you confirm a few details?",
      `  • Maximum seated capacity for that space`,
      `  • Whether ${headcount} guests fits comfortably`,
      "  • Any food & beverage minimum or minimum spend",
      "  • Whether you can accommodate dietary restrictions",
      "",
      "Thank you!",
    ].join("\n");
  }, [venueName, headcount, eventDate, selectedRoom]);

  const subject = `Private dining inquiry — ${headcount} guests`;
  // Composed only. This hands the draft to the planner's own email client;
  // nothing is ever sent from the app itself.
  const mailtoHref = venueEmail
    ? `mailto:${venueEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`
    : null;

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast.success("Draft copied — paste it into your email client.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy automatically — select the text and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Confirm the details</CardTitle>
        <p className="text-sm text-muted-foreground">
          Everything above was read off the venue&apos;s own website. Ask them directly, then record what they tell you — it upgrades
          this venue for everyone searching this area, not just you.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="draft-headcount">Headcount</Label>
              <Input
                id="draft-headcount"
                type="number"
                min={1}
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="draft-date">Target date (optional)</Label>
              <Input id="draft-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="draft-room">Space</Label>
              <select id="draft-room" className={INPUT_CLASS} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.room_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <pre className="max-h-44 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{draft}</pre>

          <div className="flex flex-wrap items-center gap-2">
            {mailtoHref ? (
              <a href={mailtoHref} className={cn(buttonVariants({ size: "sm" }))}>
                <Mail className="size-4" />
                Open in email client
              </a>
            ) : (
              <Badge variant="secondary">No email published — copy the draft or call</Badge>
            )}
            <Button type="button" size="sm" variant="outline" onClick={copyDraft}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              Copy draft
            </Button>
            {venuePhone && (
              <a href={`tel:${venuePhone.replace(/[^\d+]/g, "")}`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
                <PhoneCall className="size-4" />
                {venuePhone}
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            This app never contacts venues for you. The draft opens in your own email client so you stay in control of what gets sent.
          </p>
        </div>

        <Separator />

        <form action={confirmVenueDetailAction} className="flex flex-col gap-3">
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="roomId" value={roomId} />

          <div>
            <h3 className="text-sm font-medium">Heard back? Record it</h3>
            <p className="text-xs text-muted-foreground">
              Applies to <span className="font-medium">{selectedRoom?.room_name ?? "this venue"}</span>, attributed to your workspace
              and timestamped.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="confirmedMaxCapacity">Confirmed max capacity</Label>
              <Input id="confirmedMaxCapacity" name="confirmedMaxCapacity" type="number" min={1} placeholder="e.g. 64" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirmedMinSpendUsd">Confirmed minimum spend (USD)</Label>
              <Input id="confirmedMinSpendUsd" name="confirmedMinSpendUsd" type="number" min={0} placeholder="e.g. 3500" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="confirm-note">What did they say? (optional)</Label>
            <textarea
              id="confirm-note"
              name="note"
              rows={2}
              className={INPUT_CLASS}
              placeholder="e.g. 64 seated, 80 standing. $3,500 F&B minimum on Fridays."
            />
          </div>

          <Button type="submit" size="sm" className="self-start">
            Save confirmation
          </Button>
        </form>

        {confirmations.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Confirmation history</h3>
              <ul className="flex flex-col gap-2">
                {confirmations.map((c) => (
                  <li key={c.id} className="rounded-md border p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.confirmed_by}</span>
                      <span className="text-muted-foreground">
                        {new Date(c.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </span>
                      {c.confirmed_max_capacity != null && <Badge variant="secondary">capacity {c.confirmed_max_capacity}</Badge>}
                      {c.confirmed_min_spend_usd != null && (
                        <Badge variant="secondary">${c.confirmed_min_spend_usd.toLocaleString()} min spend</Badge>
                      )}
                    </div>
                    {c.note && <p className="mt-1 text-muted-foreground">{c.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
