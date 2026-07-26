import { describe, expect, it } from "vitest";
import { buildVenueDraft } from "@/lib/discovery/trust";
import type { CandidateVenue } from "@/lib/discovery/places";
import type { ScrapedSignals } from "@/lib/discovery/scraper";

function candidate(overrides: Partial<CandidateVenue> = {}): CandidateVenue {
  return {
    placeSourceId: "osm-1",
    name: "Test Restaurant",
    formattedAddress: "1 Test St, New York, NY",
    lat: 40.757,
    lng: -73.986,
    category: "restaurant",
    website: "https://example.com",
    ...overrides,
  };
}

function signals(overrides: Partial<ScrapedSignals> = {}): ScrapedSignals {
  return {
    privateDiningPageFound: false,
    scrapedUrls: ["https://example.com"],
    capacityNumbers: [],
    minSpendUsd: [],
    email: null,
    phone: null,
    descriptionExcerpt: null,
    menuUrl: null,
    dietaryNotes: null,
    renderedWithJs: false,
    combinedText: "",
    ...overrides,
  };
}

describe("capacity trust derivation", () => {
  it("marks capacity verified when a private-dining page publishes explicit numbers", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, capacityNumbers: [20, 60] }));

    expect(draft.rooms).toHaveLength(1);
    expect(draft.rooms[0].capacityTrust).toBe("verified");
    expect(draft.rooms[0].maxCapacity).toBe(60);
    expect(draft.rooms[0].minCapacity).toBe(20);
  });

  it("marks capacity likely when a private-dining page exists but publishes no number", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, capacityNumbers: [] }));

    expect(draft.rooms[0].capacityTrust).toBe("likely");
    expect(draft.rooms[0].roomName).toMatch(/capacity unpublished/i);
    expect(draft.rooms[0].notes).toMatch(/call to confirm/i);
  });

  it("marks capacity unverified when no private-dining page was found at all", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: false, capacityNumbers: [] }));

    expect(draft.rooms[0].capacityTrust).toBe("unverified");
    expect(draft.rooms[0].roomName).toMatch(/unconfirmed/i);
  });

  it("never claims verified capacity from numbers found without a private-dining page", () => {
    // Numbers can appear incidentally (street addresses, prices, years), so a
    // number alone must not be enough to earn a verified label.
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: false, capacityNumbers: [80] }));

    expect(draft.rooms[0].capacityTrust).toBe("unverified");
  });

  it("omits minCapacity when only one capacity figure was found", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, capacityNumbers: [45] }));

    expect(draft.rooms[0].maxCapacity).toBe(45);
    expect(draft.rooms[0].minCapacity).toBeUndefined();
  });

  it("falls back to a category estimate that is always labeled unverified", () => {
    const draft = buildVenueDraft(candidate({ category: "banquet_hall" }), null);

    expect(draft.rooms[0].capacityTrust).toBe("unverified");
    expect(draft.rooms[0].maxCapacity).toBeGreaterThan(0);
    expect(draft.rooms[0].notes).toMatch(/estimated/i);
  });
});

describe("price trust derivation is independent of capacity trust", () => {
  it("keeps price unverified even when capacity is verified", () => {
    const draft = buildVenueDraft(
      candidate({ priceLevelGoogle: undefined }),
      signals({ privateDiningPageFound: true, capacityNumbers: [50], minSpendUsd: [] })
    );

    expect(draft.rooms[0].capacityTrust).toBe("verified");
    expect(draft.minSpendUsd).toBeNull();
    expect(draft.minSpendTrust).toBe("unverified");
    expect(draft.priceTierTrust).toBe("unverified");
  });

  it("marks min spend verified only when an actual figure was scraped", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, minSpendUsd: [5000, 2500] }));

    // The lowest figure is the entry point a planner can actually budget to.
    expect(draft.minSpendUsd).toBe(2500);
    expect(draft.minSpendTrust).toBe("verified");
  });

  it("treats a Google price level as likely, not verified", () => {
    const draft = buildVenueDraft(candidate({ priceLevelGoogle: 3 }), signals());

    expect(draft.priceTier).toBe("$$$");
    expect(draft.priceTierTrust).toBe("likely");
  });

  it("reports unverified price tier when no price level exists", () => {
    const draft = buildVenueDraft(candidate({ priceLevelGoogle: undefined }), signals());

    expect(draft.priceTier).toBeNull();
    expect(draft.priceTierTrust).toBe("unverified");
  });
});

describe("fails-safe behavior with no scrape at all", () => {
  it("degrades honestly and tells the planner to call", () => {
    const draft = buildVenueDraft(candidate({ website: undefined, phone: "212-555-1212" }), null);

    expect(draft.website).toBeNull();
    expect(draft.rooms[0].capacityTrust).toBe("unverified");
    expect(draft.minSpendTrust).toBe("unverified");
    expect(draft.sourceNote).toMatch(/call the venue/i);
    expect(draft.phone).toBe("212-555-1212");
  });

  it("records how many pages were actually cross-checked in the source note", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [30], scrapedUrls: ["a", "b"] })
    );

    expect(draft.sourceNote).toContain("2 page(s)");
    expect(draft.sourceNote).toMatch(/explicit capacity figure/i);
  });
});

describe("AI-extracted tier", () => {
  const llm = (rooms: Array<{ roomName: string; maxCapacity: number; minCapacity: number | null }>, extra = {}) => ({
    rooms,
    minSpendUsd: null,
    dietaryNotes: null,
    hostsPrivateEvents: true,
    ...extra,
  });

  it("uses AI-read rooms when the page states capacity in prose", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [] }),
      llm([{ roomName: "The Cellar", maxCapacity: 34, minCapacity: 12 }])
    );

    expect(draft.rooms).toHaveLength(1);
    expect(draft.rooms[0].roomName).toBe("The Cellar");
    expect(draft.rooms[0].maxCapacity).toBe(34);
    expect(draft.rooms[0].minCapacity).toBe(12);
    // Must be its own tier, not folded into likely or unverified.
    expect(draft.rooms[0].capacityTrust).toBe("ai_extracted");
  });

  it("keeps every AI-read room rather than collapsing them into one", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [] }),
      llm([
        { roomName: "Library", maxCapacity: 20, minCapacity: null },
        { roomName: "Terrace", maxCapacity: 80, minCapacity: null },
      ])
    );

    expect(draft.rooms.map((r) => r.roomName)).toEqual(["Library", "Terrace"]);
    expect(draft.rooms.every((r) => r.capacityTrust === "ai_extracted")).toBe(true);
  });

  it("labels an AI-read minimum spend as AI-extracted, not verified", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, minSpendUsd: [] }),
      llm([], { minSpendUsd: 3000 })
    );

    expect(draft.minSpendUsd).toBe(3000);
    expect(draft.minSpendTrust).toBe("ai_extracted");
  });

  it("prefers a verbatim minimum spend over the AI's read", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, minSpendUsd: [1500] }),
      llm([], { minSpendUsd: 9999 })
    );

    expect(draft.minSpendUsd).toBe(1500);
    expect(draft.minSpendTrust).toBe("verified");
  });
});

describe("cross-referencing two independent reads", () => {
  const withLlmMax = (max: number) => ({
    rooms: [{ roomName: "Room", maxCapacity: max, minCapacity: null }],
    minSpendUsd: null,
    dietaryNotes: null,
    hostsPrivateEvents: true,
  });

  it("upgrades to verified when both reads agree within tolerance", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [60] }),
      withLlmMax(55)
    );

    expect(draft.rooms[0].capacityTrust).toBe("verified");
    expect(draft.rooms[0].notes).toMatch(/agree/i);
  });

  it("surfaces both figures instead of silently picking one when they disagree", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [60] }),
      withLlmMax(200)
    );

    expect(draft.rooms[0].notes).toMatch(/sources disagree/i);
    expect(draft.rooms[0].notes).toContain("60");
    expect(draft.rooms[0].notes).toContain("200");
  });

  it("downgrades a disagreeing figure from verified to likely", () => {
    const agreeing = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [60] }),
      withLlmMax(58)
    );
    const conflicting = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [60] }),
      withLlmMax(300)
    );

    expect(agreeing.rooms[0].capacityTrust).toBe("verified");
    expect(conflicting.rooms[0].capacityTrust).toBe("likely");
  });

  it("leaves the verbatim figure as the displayed capacity even when reads conflict", () => {
    // The regex figure is the one actually printed on the page, so it stays
    // the number shown; the conflict is communicated through the label+note.
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [60] }),
      withLlmMax(200)
    );

    expect(draft.rooms[0].maxCapacity).toBe(60);
  });

  it("does not cross-reference when only one read produced a figure", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, capacityNumbers: [60] }), {
      rooms: [],
      minSpendUsd: null,
      dietaryNotes: null,
      hostsPrivateEvents: true,
    });

    expect(draft.rooms[0].capacityTrust).toBe("verified");
    expect(draft.rooms[0].notes).not.toMatch(/agree|disagree/i);
  });
});

describe("menu and dietary labels", () => {
  it("treats a menu found alongside a confirmed private-dining page as verified", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, menuUrl: "https://example.com/menus/private.pdf" })
    );

    expect(draft.menuUrl).toBe("https://example.com/menus/private.pdf");
    expect(draft.menuTrust).toBe("verified");
  });

  it("downgrades a menu found without a private-dining page to likely", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: false, menuUrl: "https://example.com/menu" }));

    expect(draft.menuTrust).toBe("likely");
  });

  it("reports unverified when no menu was found", () => {
    const draft = buildVenueDraft(candidate(), signals({ menuUrl: null }));

    expect(draft.menuUrl).toBeNull();
    expect(draft.menuTrust).toBe("unverified");
  });

  it("labels scraped dietary phrases likely and AI summaries ai_extracted", () => {
    const scraped = buildVenueDraft(candidate(), signals({ dietaryNotes: "vegan, gluten free" }));
    const inferred = buildVenueDraft(candidate(), signals({ dietaryNotes: null }), {
      rooms: [],
      minSpendUsd: null,
      dietaryNotes: "Accommodates most dietary needs with notice.",
      hostsPrivateEvents: true,
    });

    expect(scraped.dietaryTrust).toBe("likely");
    expect(inferred.dietaryTrust).toBe("ai_extracted");
  });

  it("leaves dietary info empty rather than fabricating it", () => {
    const draft = buildVenueDraft(candidate(), signals({ dietaryNotes: null }));

    expect(draft.dietaryNotes).toBeNull();
    expect(draft.dietaryTrust).toBe("unverified");
  });
});

describe("JS-rendering fallback disclosure", () => {
  it("tells the planner when a rendering pass was needed to read the site", () => {
    const draft = buildVenueDraft(
      candidate(),
      signals({ privateDiningPageFound: true, capacityNumbers: [40], renderedWithJs: true })
    );

    expect(draft.sourceNote).toMatch(/renders its content with JavaScript/i);
  });

  it("stays silent about rendering when the static pass sufficed", () => {
    const draft = buildVenueDraft(candidate(), signals({ privateDiningPageFound: true, capacityNumbers: [40] }));

    expect(draft.sourceNote).not.toMatch(/JavaScript/i);
  });
});

describe("contact and style inference", () => {
  it("prefers scraped contact details over the discovery provider's", () => {
    const draft = buildVenueDraft(
      candidate({ phone: "111-111-1111" }),
      signals({ phone: "222-222-2222", email: "events@example.com" })
    );

    expect(draft.phone).toBe("222-222-2222");
    expect(draft.email).toBe("events@example.com");
  });

  it("infers reception style for bars and nightclubs", () => {
    expect(buildVenueDraft(candidate({ category: "bar" }), signals()).rooms[0].style).toBe("reception");
    expect(buildVenueDraft(candidate({ category: "night_club" }), signals()).rooms[0].style).toBe("reception");
  });

  it("leaves restaurants flexible rather than guessing a layout", () => {
    expect(buildVenueDraft(candidate({ category: "restaurant" }), signals()).rooms[0].style).toBe("either");
  });
});
