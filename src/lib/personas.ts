/**
 * Who's doing the searching changes what a sensible starting point looks like.
 * An executive assistant booking a partner dinner and an event marketer
 * planning a launch reception want very different first guesses at headcount,
 * travel time, and room style. These are the segments Nowadays itself sells to.
 *
 * Scope is deliberately narrow: a persona only supplies *defaults for fields
 * the planner hasn't set*. It never filters results, never reweights ranking,
 * and never overrides a value already in the URL — so picking one can't quietly
 * change what a search means, only where the form starts.
 */
export const PERSONA_IDS = ["exec-assistant", "event-marketer", "agency", "people-team"] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export type Persona = {
  id: PersonaId;
  label: string;
  /** Shown next to the picker so the effect on the form is stated, not guessed at. */
  hint: string;
  defaults: {
    headcount: string;
    maxCommuteMinutes: string;
    commuteMode: "walk" | "drive";
    style: "either" | "seated" | "reception";
  };
};

export const PERSONAS: Record<PersonaId, Persona> = {
  "exec-assistant": {
    id: "exec-assistant",
    label: "Executive assistant",
    hint: "Small seated dinners close to the office, where a wrong booking is very visible.",
    defaults: { headcount: "12", maxCommuteMinutes: "10", commuteMode: "walk", style: "seated" },
  },
  "event-marketer": {
    id: "event-marketer",
    label: "Event marketer",
    hint: "Larger reception-style rooms, with a wider net since guests travel in.",
    defaults: { headcount: "80", maxCommuteMinutes: "25", commuteMode: "drive", style: "reception" },
  },
  agency: {
    id: "agency",
    label: "Agency planner",
    hint: "Mid-size client dinners; driving distance, since the group rarely starts at one office.",
    defaults: { headcount: "30", maxCommuteMinutes: "20", commuteMode: "drive", style: "seated" },
  },
  "people-team": {
    id: "people-team",
    label: "People team",
    hint: "Whole-team meals people can walk to from the office, seated or standing.",
    defaults: { headcount: "50", maxCommuteMinutes: "15", commuteMode: "walk", style: "either" },
  },
};

/** The form's own defaults, used when no persona is selected. */
export const NEUTRAL_DEFAULTS: Persona["defaults"] = {
  headcount: "30",
  maxCommuteMinutes: "20",
  commuteMode: "walk",
  style: "either",
};

export function parsePersona(value: string | undefined): PersonaId | null {
  return PERSONA_IDS.includes(value as PersonaId) ? (value as PersonaId) : null;
}

export function defaultsForPersona(persona: PersonaId | null): Persona["defaults"] {
  return persona ? PERSONAS[persona].defaults : NEUTRAL_DEFAULTS;
}

/**
 * Merges persona defaults under whatever the URL already specifies. Explicit
 * values always win; the persona only fills gaps.
 */
export function resolveFormDefaults(
  persona: PersonaId | null,
  fromUrl: { headcount?: string; maxCommuteMinutes?: string; commuteMode?: string; style?: string }
): Persona["defaults"] {
  const base = defaultsForPersona(persona);
  return {
    headcount: fromUrl.headcount ?? base.headcount,
    maxCommuteMinutes: fromUrl.maxCommuteMinutes ?? base.maxCommuteMinutes,
    commuteMode: fromUrl.commuteMode === "walk" || fromUrl.commuteMode === "drive" ? fromUrl.commuteMode : base.commuteMode,
    style:
      fromUrl.style === "seated" || fromUrl.style === "reception" || fromUrl.style === "either"
        ? fromUrl.style
        : base.style,
  };
}
