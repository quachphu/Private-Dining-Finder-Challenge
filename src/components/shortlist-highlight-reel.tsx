"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Download, Loader2, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { sendShortlistAttachmentAction } from "@/app/actions";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { buildHighlightReel, HIGHLIGHT_REEL_SUPPORTED, type HighlightReelSource } from "@/lib/highlight-reel";
import type { ShortlistMessageRow } from "@/lib/supabase/types";

type Stage =
  | { name: "loading" }
  | { name: "empty" }
  | { name: "ready"; sources: HighlightReelSource[] }
  | { name: "generating"; total: number; done: number }
  | { name: "uploading" }
  | { name: "error"; message: string };

/**
 * Compiles every photo and video posted in this shortlist item's discussion
 * (src/components/shortlist-chat.tsx) into one clip, generated entirely in
 * the browser (see src/lib/highlight-reel.ts) and then posted straight back
 * into that same thread as a flagged (is_highlight_reel) attachment.
 *
 * The result renders here as a persistent embedded player, not a personal
 * download — every workspace member who opens this shortlist item sees the
 * latest reel immediately (Realtime-pushed, same channel the chat uses), no
 * download or dialog required. Generating one is still available to anyone,
 * any time, as a "Regenerate" action once a reel already exists.
 */
export function ShortlistHighlightReel({
  shortlistItemId,
  venueName,
  initialReel,
}: {
  shortlistItemId: string;
  venueName: string;
  initialReel: ShortlistMessageRow | null;
}) {
  const [reel, setReel] = useState(initialReel);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ name: "loading" });

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`shortlist-highlight-${shortlistItemId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shortlist_messages", filter: `shortlist_item_id=eq.${shortlistItemId}` },
        (payload) => {
          const row = payload.new as ShortlistMessageRow;
          if (!row.is_highlight_reel) return;
          // Reels only ever get created going forward in time, so the latest
          // insert is always the latest reel — no need to compare timestamps.
          setReel(row);
          setOpen(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shortlistItemId]);

  async function loadSources() {
    setStage({ name: "loading" });
    const supabase = createBrowserSupabaseClient();
    const { data, error } = await supabase
      .from("shortlist_messages")
      .select("*")
      .eq("shortlist_item_id", shortlistItemId)
      .not("attachment_url", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      setStage({ name: "error", message: "Could not load this thread's photos and videos." });
      return;
    }

    const rows = (data ?? []) as ShortlistMessageRow[];
    const sources: HighlightReelSource[] = rows
      .filter((r): r is ShortlistMessageRow & { attachment_url: string; attachment_type: "image" | "video" } =>
        Boolean(r.attachment_url && r.attachment_type)
      )
      .map((r) => ({ url: r.attachment_url, type: r.attachment_type }));

    setStage(sources.length === 0 ? { name: "empty" } : { name: "ready", sources });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void loadSources();
  }

  async function handleGenerate(sources: HighlightReelSource[]) {
    setStage({ name: "generating", total: sources.length, done: 0 });
    try {
      const blob = await buildHighlightReel(sources, (done, total) => setStage({ name: "generating", total, done }));

      setStage({ name: "uploading" });
      const file = new File([blob], `${venueName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-highlights.webm`, {
        type: blob.type || "video/webm",
      });
      const formData = new FormData();
      formData.set("shortlistItemId", shortlistItemId);
      formData.set("file", file);
      formData.set("message", "🎬 Highlight reel from this thread's photos and videos");
      formData.set("isHighlightReel", "true");
      await sendShortlistAttachmentAction(formData);
      // The postgres_changes subscription above normally flips `reel` and
      // closes the dialog, but that push can lag slightly behind this
      // response — closing here too means the button doesn't hang on "done"
      // with no visible next step in that window.
      setOpen(false);
      toast.success("Highlight reel posted — everyone with this shortlist can see it now.");
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : "Could not generate the highlight reel." });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {reel?.attachment_url && (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <video src={reel.attachment_url} controls className="max-h-72 w-full bg-black" />
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clapperboard className="size-3.5" />
              Team highlight reel
            </span>
            <a href={reel.attachment_url} download className="inline-flex items-center gap-1 hover:text-foreground">
              <Download className="size-3.5" />
              Download
            </a>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger
          render={
            <Button variant={reel ? "outline" : "default"} size="sm" className="w-fit gap-1.5">
              {reel ? <RefreshCcw className="size-3.5" /> : <Clapperboard className="size-3.5" />}
              {reel ? "Regenerate highlight video" : "Create highlight video"}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Highlight reel · {venueName}</DialogTitle>
            <DialogDescription>
              Built from every photo and video posted in this venue&apos;s team discussion, and posted back to the chat for
              everyone to watch — no download needed.
            </DialogDescription>
          </DialogHeader>

          {!HIGHLIGHT_REEL_SUPPORTED ? (
            <p className="text-sm text-muted-foreground">
              This browser can&apos;t generate video here — try a recent Chrome, Firefox, or Edge.
            </p>
          ) : stage.name === "loading" ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Looking for photos and videos…
            </div>
          ) : stage.name === "empty" ? (
            <p className="text-sm text-muted-foreground">
              No photos or videos posted yet — attach some in the chat, then come back here.
            </p>
          ) : stage.name === "error" ? (
            <p className="text-sm text-destructive">{stage.message}</p>
          ) : stage.name === "ready" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Found {stage.sources.length} {stage.sources.length === 1 ? "item" : "items"}. This renders right in your
                browser, so keep this tab open while it works.
              </p>
              <Button onClick={() => handleGenerate(stage.sources)} className="w-fit gap-1.5">
                <Clapperboard className="size-4" />
                Generate &amp; post to chat
              </Button>
            </div>
          ) : stage.name === "generating" ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Rendering {stage.done} of {stage.total}…
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Posting to the team chat…
            </div>
          )}

          {stage.name === "error" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => void loadSources()}>
                Try again
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
