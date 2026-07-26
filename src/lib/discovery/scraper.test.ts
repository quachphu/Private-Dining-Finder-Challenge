import { describe, expect, it } from "vitest";
import { extractDietaryNotes, pickMenuUrl } from "@/lib/discovery/scraper";

describe("extractDietaryNotes", () => {
  it("catches common accommodations mentioned on the page", () => {
    const notes = extractDietaryNotes("Our private dining menus offer vegetarian, vegan and gluten-free options.");

    expect(notes).toContain("vegetarian");
    expect(notes).toContain("vegan");
    expect(notes).toContain("gluten free");
  });

  it("catches a general accommodation statement as that statement", () => {
    const notes = extractDietaryNotes("We happily accommodate dietary restrictions with advance notice.");

    expect(notes).toBe("dietary-restrictions");
  });

  it("de-duplicates repeated mentions", () => {
    const notes = extractDietaryNotes("vegan starters, vegan mains, and vegan desserts");

    expect(notes).toBe("vegan");
  });

  it("returns null rather than fabricating an empty state", () => {
    expect(extractDietaryNotes("Join us for dinner in the heart of the theater district.")).toBeNull();
  });

  it("caps the list so a full allergen table stays readable", () => {
    const notes = extractDietaryNotes(
      "vegan vegetarian gluten-free dairy-free nut-free shellfish-free halal kosher pescatarian plant-based"
    );

    expect(notes!.split(", ")).toHaveLength(6);
  });
});

describe("pickMenuUrl", () => {
  const base = "https://example.com/private-events";

  it("prefers a PDF menu over an HTML menu page", () => {
    const url = pickMenuUrl(
      [
        { href: "/menu", text: "Menu" },
        { href: "/files/group-menu.pdf", text: "Group Menu" },
      ],
      base
    );

    expect(url).toBe("https://example.com/files/group-menu.pdf");
  });

  it("resolves relative links against the venue's own URL", () => {
    expect(pickMenuUrl([{ href: "/menus/dinner", text: "Dinner Menu" }], base)).toBe("https://example.com/menus/dinner");
  });

  it("matches on link text even when the href gives nothing away", () => {
    expect(pickMenuUrl([{ href: "/p/1234", text: "View our menus" }], base)).toBe("https://example.com/p/1234");
  });

  it("rejects off-host links so a delivery aggregator isn't passed off as the venue's menu", () => {
    expect(pickMenuUrl([{ href: "https://www.doordash.com/store/menu", text: "Menu" }], base)).toBeNull();
  });

  it("ignores non-menu links", () => {
    expect(pickMenuUrl([{ href: "/careers", text: "Careers" }], base)).toBeNull();
  });

  it("survives malformed hrefs without throwing", () => {
    expect(pickMenuUrl([{ href: "javascript:void(0)", text: "Menu" }], base)).toBeNull();
  });
});
