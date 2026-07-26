import { describe, expect, it } from "vitest";
import { NEUTRAL_DEFAULTS, PERSONA_IDS, PERSONAS, parsePersona, resolveFormDefaults } from "@/lib/personas";

describe("parsePersona", () => {
  it("accepts every declared persona", () => {
    for (const id of PERSONA_IDS) expect(parsePersona(id)).toBe(id);
  });

  it("rejects anything else, including a crafted URL value", () => {
    expect(parsePersona("ceo")).toBeNull();
    expect(parsePersona("")).toBeNull();
    expect(parsePersona(undefined)).toBeNull();
    expect(parsePersona("__proto__")).toBeNull();
  });
});

describe("resolveFormDefaults", () => {
  it("falls back to the neutral defaults with no persona selected", () => {
    expect(resolveFormDefaults(null, {})).toEqual(NEUTRAL_DEFAULTS);
  });

  it("uses the persona's starting values when the URL specifies nothing", () => {
    expect(resolveFormDefaults("event-marketer", {})).toEqual(PERSONAS["event-marketer"].defaults);
  });

  it("never overrides a value the planner already chose", () => {
    // This is the whole safety property: a persona adjusts where the form
    // starts, never what an already-specified search means.
    const resolved = resolveFormDefaults("exec-assistant", {
      headcount: "200",
      maxCommuteMinutes: "45",
      commuteMode: "drive",
      style: "reception",
    });

    expect(resolved).toEqual({
      headcount: "200",
      maxCommuteMinutes: "45",
      commuteMode: "drive",
      style: "reception",
    });
  });

  it("fills only the fields that are missing", () => {
    const resolved = resolveFormDefaults("people-team", { headcount: "18" });

    expect(resolved.headcount).toBe("18");
    expect(resolved.maxCommuteMinutes).toBe(PERSONAS["people-team"].defaults.maxCommuteMinutes);
    expect(resolved.commuteMode).toBe(PERSONAS["people-team"].defaults.commuteMode);
  });

  it("ignores an unsupported commute mode or style from the URL", () => {
    const resolved = resolveFormDefaults("agency", { commuteMode: "teleport", style: "banquet" });

    expect(resolved.commuteMode).toBe(PERSONAS.agency.defaults.commuteMode);
    expect(resolved.style).toBe(PERSONAS.agency.defaults.style);
  });

  it("every persona's defaults are values the form can actually render", () => {
    for (const id of PERSONA_IDS) {
      const { headcount, maxCommuteMinutes, commuteMode, style } = PERSONAS[id].defaults;
      expect(Number.parseInt(headcount, 10)).toBeGreaterThan(0);
      expect(Number.parseInt(maxCommuteMinutes, 10)).toBeGreaterThan(0);
      expect(["walk", "drive"]).toContain(commuteMode);
      expect(["either", "seated", "reception"]).toContain(style);
    }
  });
});
