"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { Megaphone, MessageCircle, Pencil, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sendEventMessageAction } from "@/app/actions";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ShortlistMessageRow } from "@/lib/supabase/types";

// Remembered so a guest who reloads, or comes back to add something they
// forgot, doesn't retype their name — the only identity this page has.
const ATTENDEE_NAME_KEY = "pdf_attendee_name";

// A regular chat message and a host's broadcast look the same in the
// database — same table, same channel — so the prefix is what the UI keys
// off of to render the host's question as a pinned prompt instead of just
// another line in the scroll.
const HOST_PROMPT_PREFIX = "📋";
const ASK_ALLERGY_MESSAGE = `${HOST_PROMPT_PREFIX} Does anyone have any allergies or dietary restrictions? Reply below so it can be passed to the venue.`;

// Consecutive messages from the same person within this window collapse
// under one avatar/name header, the way Slack groups a flurry of short
// replies — repeating the header every line reads as far less "real chat app"
// than grouping does.
const GROUP_WINDOW_MS = 2 * 60 * 1000;

// A small fixed palette rather than a random colour: the same name always
// gets the same colour across a render, and every entry here is legible text
// on its own light background. Gradients rather than flat fills so the
// avatars read as "friendly consumer chat app" rather than "enterprise tool".
const AVATAR_PALETTE = [
  "bg-linear-to-br from-rose-400 to-rose-600",
  "bg-linear-to-br from-amber-400 to-orange-500",
  "bg-linear-to-br from-emerald-400 to-teal-600",
  "bg-linear-to-br from-sky-400 to-blue-600",
  "bg-linear-to-br from-violet-400 to-purple-600",
  "bg-linear-to-br from-pink-400 to-fuchsia-600",
  "bg-linear-to-br from-teal-400 to-cyan-600",
  "bg-linear-to-br from-orange-400 to-red-500",
];

function avatarStyle(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// Fixed UTC formatting: this renders once on the server and once in the
// browser, and a timezone-dependent format would differ between the two and
// trip a hydration mismatch.
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

/**
 * The thread everyone attending the dinner posts into, once the host has
 * picked the venue — the main event of /event/[code], not a widget bolted
 * onto it. Styled like the consumer messaging apps everyone already knows
 * (iMessage/WhatsApp) rather than a workplace tool: your own messages sit on
 * the right in a coloured bubble, everyone else's sit on the left with a
 * gradient avatar, and consecutive messages from the same sender collapse
 * under one header instead of repeating a name every line.
 *
 * A host's broadcast (the "Ask about allergies" prompt) deliberately breaks
 * that left/right pattern — it's rendered as a centered, pinned banner
 * regardless of who sent it, because it's addressed to the whole room, not a
 * reply in a left/right conversation.
 *
 * Name and message still don't sit behind a "join" step. Guests arrive from
 * a link with one thing to say and no interest in the tool, so every screen
 * between them and typing "allergic to shellfish" costs the host replies —
 * and a missing reply is the one failure mode that reaches the table.
 */
export function EventChat({
  code,
  shortlistItemId,
  initialMessages,
  defaultName,
  isHost,
  onMessagesChange,
}: {
  code: string;
  shortlistItemId: string;
  initialMessages: ShortlistMessageRow[];
  defaultName: string | null;
  isHost: boolean;
  // The roster panel needs a live reply count, but it's a sibling component
  // fed by the server, not a subscriber to Realtime itself — this is how it
  // hears about messages that arrive after the page rendered. Without it, the
  // panel's count freezes at whatever it was on page load, and "Build roster"
  // can sit disabled through an entire live conversation until someone
  // reloads the page (see src/components/event-thread.tsx).
  onMessagesChange?: (messages: ShortlistMessageRow[]) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [name, setName] = useState(defaultName ?? "");
  const [editingName, setEditingName] = useState(!defaultName);
  const [isPending, startTransition] = useTransition();
  const [isAsking, setIsAsking] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  // Only consulted when no cookie-based name was already passed down from
  // the server — that's the workspace case; localStorage covers everyone
  // else (the actual attendees this page is for). Deferred a tick rather
  // than read synchronously in the effect body: the value momentarily
  // rendered before this runs matches what the server sent, so there's
  // nothing for hydration to reconcile, and the update itself lands as its
  // own render instead of cascading into the effect's commit.
  useEffect(() => {
    if (defaultName) return;
    const timer = setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(ATTENDEE_NAME_KEY);
        if (stored) {
          setName(stored);
          setEditingName(false);
        }
      } catch {
        // Storage unavailable — the guest just types their name once.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [defaultName]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`event-messages-${shortlistItemId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shortlist_messages", filter: `shortlist_item_id=eq.${shortlistItemId}` },
        (payload) => {
          const row = payload.new as ShortlistMessageRow;
          // Realtime filters take a single condition, so planning messages
          // from the venue page are screened out here.
          if (row.channel !== "event") return;
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

  useEffect(() => {
    onMessagesChange?.(messages);
    // onMessagesChange intentionally excluded: the parent passes a fresh
    // closure every render, and re-running this for that reason alone would
    // defeat the point (reporting only when the message list itself changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const participantCount = useMemo(() => new Set(messages.map((m) => m.author.toLowerCase())).size, [messages]);

  const rows = useMemo(() => {
    return messages.map((message, i) => {
      const previous = i > 0 ? messages[i - 1] : null;
      const showHeader =
        !previous ||
        previous.author !== message.author ||
        new Date(message.created_at).getTime() - new Date(previous.created_at).getTime() > GROUP_WINDOW_MS;
      return { message, showHeader };
    });
  }, [messages]);

  function persistName(value: string) {
    try {
      window.localStorage.setItem(ATTENDEE_NAME_KEY, value);
    } catch {
      // Non-fatal: the name just won't be remembered next visit.
    }
  }

  function confirmName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    persistName(trimmed);
    setEditingName(false);
  }

  function handleNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmName();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedName = name.trim();
    const value = text.trim();
    if (!value) return;
    if (!trimmedName) {
      toast.error("Add your name so the host knows whose restriction this is.");
      setEditingName(true);
      return;
    }

    setText("");
    persistName(trimmedName);
    setEditingName(false);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("code", code);
        formData.set("name", trimmedName);
        formData.set("message", value);
        await sendEventMessageAction(formData);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send that message.");
        setText(value);
      }
    });
  }

  function handleAskAllergies() {
    const hostName = name.trim() || "The host";
    setIsAsking(true);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("code", code);
        formData.set("name", hostName);
        formData.set("message", ASK_ALLERGY_MESSAGE);
        await sendEventMessageAction(formData);
        toast.success("Question posted to the chat.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not post that question.");
      } finally {
        setIsAsking(false);
      }
    });
  }

  return (
    <div className="flex h-152 flex-col overflow-hidden rounded-3xl border border-rose-100 bg-card shadow-lg shadow-rose-950/5 sm:h-200">
      <div className="flex items-center justify-between gap-3 border-b border-rose-100 bg-linear-to-r from-rose-50/70 via-card to-violet-50/70 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-rose-400 to-violet-600 text-white shadow-sm">
            <MessageCircle className="size-5" />
          </span>
          <div>
            <p className="text-base font-semibold leading-none">Event chat</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="size-3" />
              {participantCount} {participantCount === 1 ? "person" : "people"} chatting
            </p>
          </div>
        </div>
        {isHost && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAskAllergies}
            disabled={isAsking}
            className="shrink-0 rounded-full border-rose-200 bg-white/70 hover:bg-rose-50"
          >
            <Megaphone className="size-3.5" />
            <span className="hidden sm:inline">Ask about allergies</span>
            <span className="sm:hidden">Ask allergies</span>
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-linear-to-br from-rose-100 to-violet-100">
              <MessageCircle className="size-6 text-violet-400" />
            </span>
            <p className="text-sm text-muted-foreground">
              No replies yet — be the first to say what you can and can&apos;t eat.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map(({ message: m, showHeader }) => {
              const isPrompt = m.message.startsWith(HOST_PROMPT_PREFIX);
              const isMe = Boolean(name.trim()) && m.author.toLowerCase() === name.trim().toLowerCase();
              const messageText = isPrompt ? m.message.slice(HOST_PROMPT_PREFIX.length).trim() : m.message;

              if (isPrompt) {
                return (
                  <div key={m.id} className="flex justify-center py-1">
                    <div className="w-full max-w-[90%] rounded-2xl border border-amber-200 bg-linear-to-br from-amber-50 to-orange-50 px-4 py-3 shadow-sm sm:max-w-[80%]">
                      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                        <Megaphone className="size-3.5" />
                        Host question
                      </span>
                      <p className="text-sm leading-relaxed font-medium text-amber-900 wrap-break-word">{messageText}</p>
                      <p className="mt-1.5 text-[11px] text-amber-700/70">
                        {m.author} · {formatTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className={cn("flex items-end gap-2.5", isMe && "flex-row-reverse")}>
                  {!isMe && (
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-2 ring-white",
                        showHeader ? avatarStyle(m.author) : "opacity-0"
                      )}
                    >
                      {initials(m.author)}
                    </span>
                  )}
                  <div className={cn("flex max-w-[75%] min-w-0 flex-col gap-1", isMe && "items-end")}>
                    {showHeader && (
                      <div className={cn("flex items-baseline gap-2 px-1", isMe && "flex-row-reverse")}>
                        <span className="text-xs font-medium text-muted-foreground">{isMe ? "You" : m.author}</span>
                        <span className="text-[11px] text-muted-foreground/70">{formatTime(m.created_at)}</span>
                      </div>
                    )}
                    <div
                      className={cn(
                        "rounded-3xl px-4 py-2.5 text-[14.5px] leading-relaxed wrap-break-word shadow-sm",
                        isMe
                          ? "rounded-br-md bg-linear-to-br from-rose-500 to-violet-600 text-white"
                          : "rounded-bl-md border border-border/60 bg-muted/60"
                      )}
                    >
                      {messageText}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={listEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-rose-100 bg-linear-to-r from-rose-50/40 via-card to-violet-50/40 p-4">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              placeholder="Your name"
              maxLength={60}
              autoComplete="name"
              autoFocus
              className="h-11 flex-1 rounded-full bg-background px-4 text-sm"
            />
            <Button type="button" size="sm" onClick={confirmName} disabled={!name.trim()} className="rounded-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex items-end gap-2.5">
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="mb-1.5 flex items-center gap-1 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Chatting as <span className="font-medium text-foreground">{name}</span>
                <Pencil className="size-3" />
              </button>
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. I'm allergic to peanuts, and no pork please"
                maxLength={600}
                className="h-12 rounded-full border-rose-100 bg-background px-4.5 text-[14.5px] shadow-sm focus-visible:ring-violet-400/40"
                disabled={isPending}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={isPending || !text.trim()}
              aria-label="Send"
              className={cn(
                "h-12 w-12 shrink-0 rounded-full shadow-sm transition-colors",
                text.trim()
                  ? "bg-linear-to-br from-rose-500 to-violet-600 hover:from-rose-500 hover:to-violet-700"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Send className="size-4.5" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
