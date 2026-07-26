"use client";

import { useEffect, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { Loader2, MessageCircle, Paperclip, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendShortlistAttachmentAction, sendShortlistMessageAction } from "@/app/actions";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ShortlistMessageRow } from "@/lib/supabase/types";

// Fixed UTC formatting rather than toLocaleTimeString(): this renders once on
// the server (Next SSRs Client Components for the initial HTML too) and once
// on the browser, and a locale/timezone-dependent format would differ between
// the two, causing a hydration mismatch — same reasoning as
// src/lib/landing-preview.ts's formatGeneratedAt.
function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso)
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Mirrors MAX_ATTACHMENT_BYTES in src/app/actions.ts — this check just lets
// the client fail fast with a specific message before spending an upload
// round-trip; the server action re-enforces the real limit regardless.
const MAX_CLIENT_BYTES: Record<"image" | "video", number> = {
  image: 8 * 1024 * 1024,
  video: 20 * 1024 * 1024,
};

/**
 * Live discussion thread for one shortlisted venue. Everyone in the workspace
 * viewing this venue's thread sees new messages — text, photos, or video —
 * the moment they're posted, via a Supabase Realtime subscription on
 * shortlist_messages (see src/components/shortlist-highlight-reel.tsx for
 * what reads this same thread's attachments back out as a highlight video).
 */
export function ShortlistChat({
  shortlistItemId,
  initialMessages,
}: {
  shortlistItemId: string;
  initialMessages: ShortlistMessageRow[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`shortlist-messages-${shortlistItemId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shortlist_messages", filter: `shortlist_item_id=eq.${shortlistItemId}` },
        (payload) => {
          const row = payload.new as ShortlistMessageRow;
          // The sender's own insert arrives back over this same channel, so
          // dedupe by id rather than also appending optimistically on submit.
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [shortlistItemId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("shortlistItemId", shortlistItemId);
        formData.set("message", value);
        await sendShortlistMessageAction(formData);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send that message.");
        setText(value);
      }
    });
  }

  async function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of files) {
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
        if (!kind) {
          toast.error(`${file.name} isn't a photo or video.`);
          continue;
        }
        if (file.size > MAX_CLIENT_BYTES[kind]) {
          toast.error(`${file.name} is too large (max ${Math.round(MAX_CLIENT_BYTES[kind] / (1024 * 1024))}MB).`);
          continue;
        }
        const formData = new FormData();
        formData.set("shortlistItemId", shortlistItemId);
        formData.set("file", file);
        try {
          await sendShortlistAttachmentAction(formData);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Could not upload ${file.name}.`);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }

  const busy = isPending || isUploading;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1 text-sm">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-3 text-center">
            <MessageCircle className="size-4 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No messages yet — leave a note for the team.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-medium text-foreground">
                {initials(m.author)}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground">
                  {m.author} <span className="font-normal text-muted-foreground">· {formatTime(m.created_at)}</span>
                </span>
                {m.attachment_url && m.attachment_type === "image" && (
                  <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" className="mt-1 block w-fit">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage URL, no next/image domain config for it */}
                    <img
                      src={m.attachment_url}
                      alt={m.message || "Shared photo"}
                      className="max-h-48 rounded-lg border object-cover shadow-sm transition-opacity hover:opacity-90"
                    />
                  </a>
                )}
                {m.attachment_url && m.attachment_type === "video" && (
                  <video
                    src={m.attachment_url}
                    controls
                    className="mt-1 max-h-48 rounded-lg border shadow-sm"
                  />
                )}
                {m.message && <p className="text-sm leading-snug break-words">{m.message}</p>}
              </div>
            </div>
          ))
        )}
        <div ref={listEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t pt-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={handleFilesSelected}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          disabled={busy}
          aria-label="Attach photos or videos"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0"
        >
          {isUploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
        </Button>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the team about this venue…"
          className="h-8 bg-background text-sm"
          disabled={busy}
        />
        <Button
          type="submit"
          size="icon-sm"
          variant={text.trim() ? "default" : "outline"}
          disabled={busy || !text.trim()}
          aria-label="Send message"
          className={cn("shrink-0 transition-colors", isPending && "opacity-70")}
        >
          <Send className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}
