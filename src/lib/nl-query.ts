/**
 * Natural-language front door for the structured search form.
 *
 * "40 people for a reception near our SoMa office, nothing more than a 10
 * minute walk" is how a planner actually describes an event. This turns that
 * into the same four parameters the form already takes, then *fills the form
 * in* rather than searching directly — the planner sees exactly what was
 * understood and can correct it before anything runs.
 *
 * The model is only allowed to report fields the sentence actually specifies.
 * Anything unstated comes back null and keeps the form's existing default,
 * because a confidently-invented headcount is worse than an empty box: the
 * planner would have no way to tell it apart from one they typed.
 *
 * Uses the same xAI structured-outputs call shape as the extraction tier (see
 * src/lib/discovery/llm-extract.ts) rather than adding a second integration.
 */

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL = "grok-4.5";
const XAI_TIMEOUT_MS = 20_000;

const MAX_QUERY_CHARS = 500;

/** Guardrails on what the model is allowed to hand back. */
export const HEADCOUNT_RANGE = { min: 2, max: 5000 } as const;
export const COMMUTE_RANGE = { min: 1, max: 90 } as const;

export type ParsedQuery = {
  addressQuery: string | null;
  headcount: number | null;
  maxCommuteMinutes: number | null;
  commuteMode: "walk" | "drive" | null;
  style: "seated" | "reception" | null;
};

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["addressQuery", "headcount", "maxCommuteMinutes", "commuteMode", "style"],
  properties: {
    addressQuery: {
      type: ["string", "null"],
      description:
        "The location to search around, as a geocodable string (include city and state/region if the text implies one). Null if the text names no location.",
    },
    headcount: {
      type: ["integer", "null"],
      description: "Number of guests, only if the text states a number. Null otherwise.",
    },
    maxCommuteMinutes: {
      type: ["integer", "null"],
      description: "Maximum travel time in minutes, only if the text states one. Null otherwise.",
    },
    commuteMode: {
      type: ["string", "null"],
      enum: ["walk", "drive", null],
      description: "'walk' or 'drive' only if the text says how people will travel. Null otherwise.",
    },
    style: {
      type: ["string", "null"],
      enum: ["seated", "reception", null],
      description:
        "'seated' for a sit-down dinner/lunch, 'reception' for standing drinks/happy hour/cocktail style. Null if the text doesn't indicate a format.",
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You convert an event planner's free-text request into structured search parameters for a private-dining search tool.",
  "Report only what the text states or unambiguously implies. Return null for anything it does not specify.",
  "Never invent a headcount, a travel time, or a location. Do not substitute typical or default values.",
  "For addressQuery, return a string a geocoder can resolve; keep any landmark or building name the planner used rather than replacing it with coordinates.",
].join(" ");

export function isNaturalLanguageSearchConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

function clamp(value: unknown, range: { min: number; max: number }): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  // Out-of-range values are dropped rather than clamped to the nearest bound:
  // a "10000 guests" read is far more likely a misparse than a real request,
  // and silently turning it into 5000 would hide that.
  return rounded >= range.min && rounded <= range.max ? rounded : null;
}

/**
 * Normalizes whatever the model returned into values the search form accepts.
 * Separated from the network call so the rules can be tested directly.
 */
export function sanitizeParsedQuery(raw: unknown): ParsedQuery {
  const value = (raw ?? {}) as Record<string, unknown>;
  const address = typeof value.addressQuery === "string" ? value.addressQuery.trim() : "";
  const mode = value.commuteMode;
  const style = value.style;

  return {
    addressQuery: address || null,
    headcount: clamp(value.headcount, HEADCOUNT_RANGE),
    maxCommuteMinutes: clamp(value.maxCommuteMinutes, COMMUTE_RANGE),
    commuteMode: mode === "walk" || mode === "drive" ? mode : null,
    style: style === "seated" || style === "reception" ? style : null,
  };
}

/** True when the parse produced nothing usable, so the caller can say so plainly. */
export function isEmptyParse(parsed: ParsedQuery): boolean {
  return Object.values(parsed).every((v) => v === null);
}

export async function parseNaturalLanguageQuery(text: string): Promise<ParsedQuery | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || !text.trim()) return null;

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
          { role: "user", content: text.slice(0, MAX_QUERY_CHARS) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "search_query", strict: true, schema: QUERY_SCHEMA },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`xAI query parse failed: ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    return sanitizeParsedQuery(JSON.parse(content));
  } catch (err) {
    console.error("xAI query parse threw:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
