/**
 * Reads a dietary roster out of an event thread.
 *
 * Once a venue is chosen, the host's real problem is no longer search — it's
 * that thirty to two hundred people need to be asked what they can't eat, and
 * the answers arrive as prose ("I got allergy with peanut", "no pork for me
 * thanks") scattered through a chat. This turns that thread into a list a
 * kitchen can actually work from: who, what, how firm, and a paragraph the
 * host can forward.
 *
 * Two rules shape the prompt, both for the same reason that dietary
 * information is safety-critical:
 *
 *  - Nothing is inferred. Only foods an attendee actually named are reported,
 *    and severity is only 'allergy' if they said so. A guessed allergy is
 *    worse than a missing one, because the host cannot tell it apart from a
 *    reported one.
 *  - Every person carries their own wording verbatim, so the host can check
 *    the extraction against what was really said without leaving the page.
 *
 * Uses the same xAI structured-outputs call shape as src/lib/nl-query.ts
 * rather than adding a second integration.
 */

import type { DietaryNeed, DietaryNeedKind, DietaryPerson, DietarySummary } from "@/lib/supabase/types";

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL = "grok-4.5";
// Considerably longer than the free-text parser's 20s (src/lib/nl-query.ts):
// that reads one sentence on the critical path of a page load, whereas this
// reads an entire thread behind a button the host chose to press. 30s proved
// to be genuinely marginal on a real thread, and a spurious timeout here means
// the host re-presses and waits all over again.
const XAI_TIMEOUT_MS = 90_000;

// Bounds on what gets sent, so one very long thread can't blow the context
// window or the request timeout. Oldest messages are dropped first: a late
// correction ("actually it's a mild intolerance") matters more than the
// opening chatter.
const MAX_MESSAGES = 250;
const MAX_MESSAGE_CHARS = 500;

const MAX_PEOPLE = 250;
const MAX_NEEDS_PER_PERSON = 12;
const MAX_UNCLEAR = 25;

export type DietaryInputMessage = {
  author: string;
  message: string;
};

const NEED_KINDS: DietaryNeedKind[] = ["allergy", "intolerance", "preference", "unclear"];

/** Ordering used to resolve conflicting severities for the same food. */
const KIND_STRICTNESS: Record<DietaryNeedKind, number> = {
  allergy: 3,
  intolerance: 2,
  unclear: 1,
  preference: 0,
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["people", "aggregate", "unclear", "orderNote"],
  properties: {
    people: {
      type: "array",
      description:
        "One entry per attendee who stated something about what they can or cannot eat. Omit anyone whose messages say nothing about food.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "needs", "quote"],
        properties: {
          name: {
            type: "string",
            description: "The attendee's name exactly as given as the message author.",
          },
          needs: {
            type: "array",
            description:
              "One entry per distinct food or category the attendee cannot or prefers not to eat. Never add items they did not name.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["item", "kind"],
              properties: {
                item: {
                  type: "string",
                  description: "The food or category, in the attendee's own terms (e.g. 'peanuts', 'pork', 'dairy').",
                },
                kind: {
                  type: "string",
                  enum: ["allergy", "intolerance", "preference", "unclear"],
                  description:
                    "How this specific item was described. 'allergy' only if they called it an allergy or allergic reaction. 'intolerance' for intolerance or sensitivity. 'preference' for a diet or choice (vegetarian, vegan, halal, no pork, dislikes). 'unclear' if the wording does not establish which. Classify each item on its own — one message can state an allergy and a preference at the same time.",
                },
              },
            },
          },
          quote: {
            type: "string",
            description: "The attendee's own wording, verbatim, trimmed to the relevant sentence.",
          },
        },
      },
    },
    aggregate: {
      type: "array",
      description:
        "Each distinct requirement across all attendees with how many people stated it, so the host can order in bulk. Counts must match the people array.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "count"],
        properties: {
          requirement: { type: "string" },
          count: { type: "integer" },
        },
      },
    },
    unclear: {
      type: "array",
      description:
        "Messages that seem to be about food but cannot be confidently attributed or understood, quoted verbatim so a human can follow up.",
      items: { type: "string" },
    },
    orderNote: {
      type: "string",
      description:
        "Two to four sentences the host can forward to the venue, stating the counts and the strict allergies. State only what attendees reported. Do not promise the venue anything or invent numbers.",
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You read a group chat between people attending a dinner and extract only their stated dietary restrictions and allergies.",
  "Report exclusively what attendees actually wrote. Never infer an allergy, a severity, or a food that was not named.",
  "Mark kind as 'allergy' only when the attendee used the language of allergy; use 'preference' for dietary choices and 'unclear' when the wording does not settle it.",
  "Classify every food separately. One message often mixes them — 'no pork, and I'm allergic to peanuts' is a preference and an allergy, not two allergies.",
  "If one person sends several messages, merge them into a single entry under their name, and let a later correction override an earlier statement.",
  "Ignore logistics, greetings, and anything unrelated to food. If nobody stated a restriction, return empty arrays and an orderNote saying none were reported.",
].join(" ");

export function isDietarySummaryConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

function asTrimmedStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    // Deduplicated case-insensitively, keeping the first spelling seen:
    // "Peanuts" and "peanuts" from two messages are one requirement, not two.
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

function asNeeds(value: unknown): DietaryNeed[] {
  if (!Array.isArray(value)) return [];
  const byItem = new Map<string, DietaryNeed>();
  for (const entry of value) {
    const need = (entry ?? {}) as Record<string, unknown>;
    const item = typeof need.item === "string" ? need.item.trim() : "";
    if (!item) continue;
    const key = item.toLowerCase();
    const kind = NEED_KINDS.includes(need.kind as DietaryNeedKind) ? (need.kind as DietaryNeedKind) : "unclear";
    const existing = byItem.get(key);
    // If the same food arrives twice with different severities, keep the
    // stricter one. Under-stating an allergy is the failure that reaches the
    // kitchen; over-stating a preference only costs the venue some care.
    if (!existing || KIND_STRICTNESS[kind] > KIND_STRICTNESS[existing.kind]) byItem.set(key, { item, kind });
    if (byItem.size >= MAX_NEEDS_PER_PERSON) break;
  }
  return [...byItem.values()];
}

/**
 * Normalizes whatever the model returned into a roster the page can render.
 * Separated from the network call so the rules can be tested directly.
 */
export function sanitizeDietarySummary(raw: unknown): DietarySummary {
  const value = (raw ?? {}) as Record<string, unknown>;

  const people: DietaryPerson[] = (Array.isArray(value.people) ? value.people : [])
    .slice(0, MAX_PEOPLE)
    .flatMap((entry): DietaryPerson[] => {
      const person = (entry ?? {}) as Record<string, unknown>;
      const name = typeof person.name === "string" ? person.name.trim() : "";
      const needs = asNeeds(person.needs);
      // An entry with no name or no stated need carries no information a host
      // can act on, so it's dropped rather than rendered as a blank row.
      if (!name || needs.length === 0) return [];
      return [{ name, needs, quote: typeof person.quote === "string" ? person.quote.trim() : "" }];
    });

  const aggregate = (Array.isArray(value.aggregate) ? value.aggregate : [])
    .flatMap((entry): { requirement: string; count: number }[] => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const requirement = typeof row.requirement === "string" ? row.requirement.trim() : "";
      const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.round(row.count) : 0;
      if (!requirement || count <= 0) return [];
      return [{ requirement, count }];
    })
    .sort((a, b) => b.count - a.count);

  return {
    people,
    aggregate,
    unclear: asTrimmedStrings(value.unclear, MAX_UNCLEAR),
    orderNote: typeof value.orderNote === "string" ? value.orderNote.trim() : "",
  };
}

/** True when the extraction found nothing to report, so callers can say so plainly. */
export function isEmptyDietarySummary(summary: DietarySummary): boolean {
  return summary.people.length === 0 && summary.unclear.length === 0;
}

export async function summarizeDietaryNeeds(messages: DietaryInputMessage[]): Promise<DietarySummary | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;

  const usable = messages.filter((m) => m.message.trim()).slice(-MAX_MESSAGES);
  if (usable.length === 0) return null;

  const transcript = usable
    .map((m) => `${m.author}: ${m.message.trim().slice(0, MAX_MESSAGE_CHARS)}`)
    .join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XAI_TIMEOUT_MS);

  try {
    const res = await fetch(XAI_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: XAI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "dietary_summary", strict: true, schema: SUMMARY_SCHEMA },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`xAI dietary summary failed: ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    return sanitizeDietarySummary(JSON.parse(content));
  } catch (err) {
    console.error("xAI dietary summary threw:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
