import { describe, expect, it } from "vitest";
import { isEmptyParse, sanitizeParsedQuery } from "@/lib/nl-query";

/**
 * These cover the boundary between the model and the search form. The model's
 * own accuracy isn't unit-testable, but the rules about what we're willing to
 * accept from it are — and those rules are what keep an invented number from
 * reaching a planner looking indistinguishable from one they typed.
 */
describe("sanitizeParsedQuery", () => {
  it("passes through a fully specified query", () => {
    expect(
      sanitizeParsedQuery({
        addressQuery: "415 Mission St, San Francisco, CA",
        headcount: 30,
        maxCommuteMinutes: 15,
        commuteMode: "walk",
        style: "seated",
      })
    ).toEqual({
      addressQuery: "415 Mission St, San Francisco, CA",
      headcount: 30,
      maxCommuteMinutes: 15,
      commuteMode: "walk",
      style: "seated",
    });
  });

  it("keeps unstated fields null instead of substituting defaults", () => {
    const parsed = sanitizeParsedQuery({
      addressQuery: "Times Square, New York, NY",
      headcount: null,
      maxCommuteMinutes: null,
      commuteMode: null,
      style: null,
    });

    expect(parsed.addressQuery).toBe("Times Square, New York, NY");
    expect(parsed.headcount).toBeNull();
    expect(parsed.maxCommuteMinutes).toBeNull();
    expect(parsed.commuteMode).toBeNull();
    expect(parsed.style).toBeNull();
  });

  it("drops an implausible headcount rather than clamping it to the maximum", () => {
    // Clamping would turn an obvious misparse into a plausible-looking search.
    expect(sanitizeParsedQuery({ headcount: 250_000 }).headcount).toBeNull();
    expect(sanitizeParsedQuery({ headcount: 1 }).headcount).toBeNull();
  });

  it("drops an implausible commute time", () => {
    expect(sanitizeParsedQuery({ maxCommuteMinutes: 600 }).maxCommuteMinutes).toBeNull();
    expect(sanitizeParsedQuery({ maxCommuteMinutes: 0 }).maxCommuteMinutes).toBeNull();
  });

  it("accepts the required scenarios' exact figures", () => {
    expect(sanitizeParsedQuery({ headcount: 50, maxCommuteMinutes: 20 })).toMatchObject({
      headcount: 50,
      maxCommuteMinutes: 20,
    });
    expect(sanitizeParsedQuery({ headcount: 200, maxCommuteMinutes: 15 })).toMatchObject({
      headcount: 200,
      maxCommuteMinutes: 15,
    });
  });

  it("rounds a fractional headcount to a whole number of people", () => {
    expect(sanitizeParsedQuery({ headcount: 29.6 }).headcount).toBe(30);
  });

  it("rejects a commute mode or style outside the supported set", () => {
    expect(sanitizeParsedQuery({ commuteMode: "transit" }).commuteMode).toBeNull();
    expect(sanitizeParsedQuery({ style: "banquet" }).style).toBeNull();
  });

  it("treats a blank or whitespace-only address as no address", () => {
    expect(sanitizeParsedQuery({ addressQuery: "   " }).addressQuery).toBeNull();
    expect(sanitizeParsedQuery({ addressQuery: "" }).addressQuery).toBeNull();
  });

  it("survives a malformed response without throwing", () => {
    expect(isEmptyParse(sanitizeParsedQuery(null))).toBe(true);
    expect(isEmptyParse(sanitizeParsedQuery("not an object"))).toBe(true);
    expect(isEmptyParse(sanitizeParsedQuery({ headcount: "fifty" }))).toBe(true);
  });
});

describe("isEmptyParse", () => {
  it("is false as soon as one field was recovered", () => {
    expect(isEmptyParse(sanitizeParsedQuery({ headcount: 30 }))).toBe(false);
  });

  it("is true when nothing was recovered", () => {
    expect(
      isEmptyParse({ addressQuery: null, headcount: null, maxCommuteMinutes: null, commuteMode: null, style: null })
    ).toBe(true);
  });
});
