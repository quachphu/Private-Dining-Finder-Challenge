"use client";

import { useState } from "react";
import { EventChat } from "@/components/event-chat";
import { DietarySummaryPanel } from "@/components/dietary-summary-panel";
import type { DietarySummaryRow, ShortlistMessageRow } from "@/lib/supabase/types";

/**
 * Owns the one piece of state the chat and the roster panel both need to
 * agree on: how many replies actually exist right now.
 *
 * Without this wrapper, the host's roster panel was a server-rendered prop
 * frozen at whatever the reply count was when the page loaded — Realtime
 * delivers new messages straight into `EventChat`'s own state, and
 * `sendEventMessageAction` deliberately skips `revalidatePath` (everyone's
 * already subscribed, so re-rendering the page would just be a redundant
 * round-trip). The result: a host who opens the page before anyone has
 * replied sees "Build roster" disabled, and it stays disabled through an
 * entire live conversation because nothing ever tells the panel the count
 * changed — until a full reload re-runs the server component. `EventChat`
 * reports its live message list up here on every change, so the panel's
 * count updates the same instant the chat does.
 */
export function EventThread({
  code,
  shortlistItemId,
  initialMessages,
  defaultName,
  isHost,
  venueName,
  venueEmail,
  latestSummary,
}: {
  code: string;
  shortlistItemId: string;
  initialMessages: ShortlistMessageRow[];
  defaultName: string | null;
  isHost: boolean;
  venueName: string;
  venueEmail: string | null;
  latestSummary: DietarySummaryRow | null;
}) {
  const [replyCount, setReplyCount] = useState(
    () => initialMessages.filter((m) => m.message.trim()).length
  );

  return (
    <>
      <section className="flex flex-col gap-2">
        <div>
          <h2 className="font-medium">Anything you can&apos;t eat?</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Name any allergy or dietary restriction below and it&apos;ll be passed to the kitchen. Say if it&apos;s a
            real allergy rather than a preference — the kitchen treats those very differently.
          </p>
        </div>
        <EventChat
          code={code}
          shortlistItemId={shortlistItemId}
          initialMessages={initialMessages}
          defaultName={defaultName}
          isHost={isHost}
          onMessagesChange={(messages) => setReplyCount(messages.filter((m) => m.message.trim()).length)}
        />
      </section>

      {isHost ? (
        <DietarySummaryPanel
          code={code}
          venueName={venueName}
          venueEmail={venueEmail}
          latest={latestSummary}
          replyCount={replyCount}
        />
      ) : (
        <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          Your host will turn these replies into a roster for the venue — you don&apos;t need to do anything else here.
        </p>
      )}
    </>
  );
}
