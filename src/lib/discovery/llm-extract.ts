/**
 * Schema-constrained extraction tier.
 *
 * Runs only when a venue clearly hosts private events but publishes the
 * details in prose the regex pass can't match ("our upstairs room comfortably
 * hosts parties of thirty"). Results are labeled `ai_extracted` — a distinct
 * tier, never merged into `verified` or `unverified` — because the number was
 * inferred from the venue's own words rather than matched verbatim.
 *
 * Uses xAI's `response_format: json_schema` with `strict: true` (verified
 * against the current xAI structured-outputs docs) so the model cannot return
 * prose, extra keys, or a differently-shaped object. The API is
 * OpenAI-compatible, called over plain fetch to avoid adding an SDK for one
 * request shape.
 */

const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const XAI_MODEL = "grok-4.5";
const XAI_TIMEOUT_MS = 45_000;

// Only the leading slice of page text is sent: the private-dining details
// live near the top of a private-events page, and this bounds token spend.
const MAX_TEXT_CHARS = 12_000;

export type LlmExtractedRoom = {
  roomName: string;
  maxCapacity: number;
  minCapacity: number | null;
};

export type LlmExtraction = {
  rooms: LlmExtractedRoom[];
  minSpendUsd: number | null;
  dietaryNotes: string | null;
  hostsPrivateEvents: boolean;
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hostsPrivateEvents", "rooms", "minSpendUsd", "dietaryNotes"],
  properties: {
    hostsPrivateEvents: {
      type: "boolean",
      description: "True only if the page states this venue hosts private events or group dining.",
    },
    rooms: {
      type: "array",
      description:
        "One entry per named private room or event space with a stated or clearly implied guest capacity. Empty if the page states no capacity at all.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomName", "maxCapacity", "minCapacity"],
        properties: {
          roomName: { type: "string", description: "The room's name as written on the page." },
          maxCapacity: { type: "integer", description: "Maximum guests this room holds." },
          minCapacity: { type: ["integer", "null"], description: "Minimum guests, or null if not stated." },
        },
      },
    },
    minSpendUsd: {
      type: ["integer", "null"],
      description: "Minimum spend or food-and-beverage minimum in USD, or null if not stated.",
    },
    dietaryNotes: {
      type: ["string", "null"],
      description: "Short summary of dietary accommodations stated on the page, or null if none are mentioned.",
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "You extract private-dining facts from restaurant and venue web pages for an event planner.",
  "Report only what the page actually states. Never estimate, infer from venue size, or fill gaps with typical values.",
  "If the page does not state a capacity, return an empty rooms array rather than guessing a number.",
  "A number written for a different purpose (street address, price, year, seat count of the whole restaurant) is not a private room capacity.",
].join(" ");

export function isLlmExtractionConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

export async function extractPrivateDiningWithLlm(venueName: string, pageText: string): Promise<LlmExtraction | null> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey || !pageText.trim()) return null;

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
          {
            role: "user",
            content: `Venue: ${venueName}\n\nPage text:\n${pageText.slice(0, MAX_TEXT_CHARS)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "private_dining_extraction", strict: true, schema: EXTRACTION_SCHEMA },
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`xAI extraction failed for ${venueName}: ${res.status}`);
      return null;
    }

    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as LlmExtraction;

    // `strict` guarantees the shape, not the semantics — a hallucinated
    // 900-person "private room" for a 40-seat restaurant is still shaped
    // correctly, so implausible figures are dropped here.
    const rooms = (parsed.rooms ?? []).filter(
      (room) => Number.isInteger(room.maxCapacity) && room.maxCapacity > 0 && room.maxCapacity <= 5000 && room.roomName?.trim()
    );

    return {
      rooms,
      minSpendUsd: Number.isInteger(parsed.minSpendUsd) && (parsed.minSpendUsd ?? 0) > 0 ? parsed.minSpendUsd : null,
      dietaryNotes: parsed.dietaryNotes?.trim() || null,
      hostsPrivateEvents: Boolean(parsed.hostsPrivateEvents),
    };
  } catch (err) {
    console.error(`xAI extraction threw for ${venueName}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
