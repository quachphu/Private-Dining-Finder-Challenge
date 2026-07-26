import { describe, expect, it } from "vitest";
import { countConfirmedCapacities, rankVenues, type SearchCriteria, type VenueWithRelations } from "@/lib/ranking";
import type { CommuteResult } from "@/lib/geo/commute";
import type { RoomStyle, TrustLevel, VenueRoomRow } from "@/lib/supabase/types";

type RoomSpec = {
  name?: string;
  max: number;
  min?: number;
  style?: RoomStyle;
  trust?: TrustLevel;
};

function room(venueId: string, spec: RoomSpec, index: number): VenueRoomRow {
  return {
    id: `${venueId}-room-${index}`,
    venue_id: venueId,
    room_name: spec.name ?? `Room ${index}`,
    min_capacity: spec.min ?? null,
    max_capacity: spec.max,
    style: spec.style ?? "either",
    capacity_trust: spec.trust ?? "verified",
    notes: null,
  };
}

function venue(
  id: string,
  rooms: RoomSpec[],
  overrides: Partial<VenueWithRelations> = {}
): VenueWithRelations {
  return {
    id,
    source: "curated_seed",
    place_source_id: null,
    name: `Venue ${id}`,
    formatted_address: `${id} Test St`,
    lat: 40.757,
    lng: -73.986,
    city_slug: "test",
    category: "restaurant",
    neighborhood: null,
    price_tier: "$$",
    price_tier_trust: "verified",
    min_spend_usd: null,
    min_spend_trust: "unverified",
    phone: null,
    email: null,
    website: null,
    description: null,
    dietary_notes: null,
    dietary_trust: "unverified",
    menu_url: null,
    menu_trust: "unverified",
    source_note: null,
    last_checked_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    rooms: rooms.map((spec, i) => room(id, spec, i)),
    photos: [],
    ...overrides,
  };
}

function commute(minutes: number, estimated = false): CommuteResult {
  return { distanceMeters: minutes * 80, durationSeconds: minutes * 60, estimated };
}

const baseCriteria: SearchCriteria = {
  headcount: 50,
  maxCommuteMinutes: 20,
  commuteMode: "walk",
};

describe("hard filters", () => {
  it("excludes venues past the max commute cutoff", () => {
    const inRange = venue("a", [{ max: 60 }]);
    const tooFar = venue("b", [{ max: 60 }]);

    const results = rankVenues(
      baseCriteria,
      [inRange, tooFar],
      new Map([
        ["a", commute(10)],
        ["b", commute(21)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["a"]);
  });

  it("excludes venues whose largest room cannot hold the group", () => {
    const tooSmall = venue("small", [{ max: 20 }, { max: 40 }]);
    const fits = venue("fits", [{ max: 50 }]);

    const results = rankVenues(
      baseCriteria,
      [tooSmall, fits],
      new Map([
        ["small", commute(5)],
        ["fits", commute(5)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["fits"]);
  });

  it("treats a room exactly at headcount as fitting", () => {
    const results = rankVenues(baseCriteria, [venue("exact", [{ max: 50 }])], new Map([["exact", commute(5)]]));

    expect(results).toHaveLength(1);
    expect(results[0].bestRoom.max_capacity).toBe(50);
  });

  it("skips venues with no commute data rather than assuming they are close", () => {
    const results = rankVenues(baseCriteria, [venue("a", [{ max: 60 }])], new Map());

    expect(results).toEqual([]);
  });
});

describe("best-room selection", () => {
  it("picks the smallest room that still fits, not the biggest", () => {
    const v = venue("multi", [
      { name: "Ballroom", max: 500 },
      { name: "Private Room", max: 60 },
      { name: "Nook", max: 20 },
    ]);

    const results = rankVenues(baseCriteria, [v], new Map([["multi", commute(5)]]));

    expect(results[0].bestRoom.room_name).toBe("Private Room");
  });

  it("ranks a tight capacity fit above an oversized room, all else equal", () => {
    const tight = venue("tight", [{ max: 55 }]);
    const oversized = venue("oversized", [{ max: 400 }]);

    const results = rankVenues(
      baseCriteria,
      [oversized, tight],
      new Map([
        ["tight", commute(10)],
        ["oversized", commute(10)],
      ])
    );

    expect(results[0].venue.id).toBe("tight");
  });
});

describe("scoring and ordering", () => {
  it("returns results sorted by descending score", () => {
    const results = rankVenues(
      baseCriteria,
      [venue("far", [{ max: 60 }]), venue("near", [{ max: 60 }]), venue("mid", [{ max: 60 }])],
      new Map([
        ["far", commute(18)],
        ["near", commute(2)],
        ["mid", commute(9)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["near", "mid", "far"]);
    const scores = results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("ranks better-trusted data higher when commute and capacity match", () => {
    const trusted = venue("trusted", [{ max: 60, trust: "verified" }]);
    const guessed = venue("guessed", [{ max: 60, trust: "unverified" }]);

    const results = rankVenues(
      baseCriteria,
      [guessed, trusted],
      new Map([
        ["trusted", commute(10)],
        ["guessed", commute(10)],
      ])
    );

    expect(results[0].venue.id).toBe("trusted");
  });

  it("ranks a planner-confirmed figure above a website-verified one", () => {
    // The whole point of the community-verification tier: a human who phoned
    // the venue is stronger evidence than a number printed on its website.
    const called = venue("called", [{ max: 60, trust: "confirmed_by_planner" }]);
    const scraped = venue("scraped", [{ max: 60, trust: "verified" }]);

    const results = rankVenues(
      baseCriteria,
      [scraped, called],
      new Map([
        ["called", commute(10)],
        ["scraped", commute(10)],
      ])
    );

    expect(results[0].venue.id).toBe("called");
  });

  it("orders all five trust tiers by strength of evidence", () => {
    const tiers: TrustLevel[] = ["confirmed_by_planner", "verified", "likely", "ai_extracted", "unverified"];
    const venues = tiers.map((trust) => venue(trust, [{ max: 60, trust }]));

    const results = rankVenues(
      baseCriteria,
      venues,
      new Map(tiers.map((t) => [t, commute(10)]))
    );

    expect(results.map((r) => r.venue.id)).toEqual(tiers);
  });

  it("penalizes a style mismatch without excluding the venue", () => {
    const seated = venue("seated", [{ max: 60, style: "seated" }]);
    const reception = venue("reception", [{ max: 60, style: "reception" }]);

    const results = rankVenues(
      { ...baseCriteria, style: "reception" },
      [seated, reception],
      new Map([
        ["seated", commute(10)],
        ["reception", commute(10)],
      ])
    );

    expect(results).toHaveLength(2);
    expect(results[0].venue.id).toBe("reception");
  });
});

describe("reasons surfaced to the planner", () => {
  it("labels estimated commutes as estimated", () => {
    const results = rankVenues(baseCriteria, [venue("a", [{ max: 60 }])], new Map([["a", commute(10, true)]]));

    expect(results[0].commuteEstimated).toBe(true);
    expect(results[0].reasons.join(" ")).toMatch(/estimated/i);
  });

  it("does not label real routed commutes as estimated", () => {
    const results = rankVenues(baseCriteria, [venue("a", [{ max: 60 }])], new Map([["a", commute(10, false)]]));

    expect(results[0].commuteEstimated).toBe(false);
    expect(results[0].reasons.join(" ")).not.toMatch(/estimated/i);
  });

  it("tells the planner to call when capacity is unverified", () => {
    const results = rankVenues(
      baseCriteria,
      [venue("a", [{ max: 60, trust: "unverified" }])],
      new Map([["a", commute(10)]])
    );

    expect(results[0].reasons.join(" ")).toMatch(/call the venue/i);
  });

  it("never tells a planner a confirmed capacity is unverified", () => {
    // Regression: the reason strings were an if/else chain ending in an
    // "unverified" fallback, so every tier added after `likely` was described
    // as unverified. Now driven by an exhaustive map.
    const results = rankVenues(
      baseCriteria,
      [venue("a", [{ max: 60, trust: "confirmed_by_planner" }])],
      new Map([["a", commute(10)]])
    );

    const reasons = results[0].reasons.join(" ");
    expect(reasons).not.toMatch(/unverified/i);
    expect(reasons).toMatch(/confirmed by a planner/i);
  });

  it("describes every trust tier with wording meant for a human", () => {
    const tiers: TrustLevel[] = ["confirmed_by_planner", "verified", "likely", "ai_extracted", "unverified"];

    for (const trust of tiers) {
      const results = rankVenues(
        baseCriteria,
        [venue(trust, [{ max: 60, trust }], { min_spend_usd: 2000, min_spend_trust: trust })],
        new Map([[trust, commute(10)]])
      );
      const reasons = results[0].reasons.join(" ");

      // Raw enum identifiers must never reach the planner.
      expect(reasons).not.toContain("confirmed_by_planner");
      expect(reasons).not.toContain("ai_extracted");
      expect(reasons).toMatch(/Capacity/);
    }
  });

  it("reports the mode the planner actually chose", () => {
    const results = rankVenues(
      { ...baseCriteria, commuteMode: "drive" },
      [venue("a", [{ max: 60 }])],
      new Map([["a", commute(10)]])
    );

    expect(results[0].reasons[0]).toMatch(/drive/);
    expect(results[0].reasons[0]).not.toMatch(/walk/);
  });
});

describe("the three required challenge scenarios", () => {
  it("scenario 1: 50 people, 20 minute commute", () => {
    const results = rankVenues(
      { headcount: 50, maxCommuteMinutes: 20, commuteMode: "walk" },
      [venue("fits", [{ max: 50 }]), venue("small", [{ max: 49 }]), venue("late", [{ max: 200 }])],
      new Map([
        ["fits", commute(12)],
        ["small", commute(3)],
        ["late", commute(25)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["fits"]);
  });

  it("scenario 2: 30 people, 15 minute commute", () => {
    const results = rankVenues(
      { headcount: 30, maxCommuteMinutes: 15, commuteMode: "walk" },
      [venue("a", [{ max: 30 }]), venue("b", [{ max: 29 }])],
      new Map([
        ["a", commute(14)],
        ["b", commute(1)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["a"]);
  });

  it("scenario 3: 200 people, reception style, 15 minute walk", () => {
    const bigReception = venue("big-reception", [{ max: 250, style: "reception" }]);
    const bigSeated = venue("big-seated", [{ max: 250, style: "seated" }]);
    const tooSmall = venue("too-small", [{ max: 199, style: "reception" }]);

    const results = rankVenues(
      { headcount: 200, maxCommuteMinutes: 15, commuteMode: "walk", style: "reception" },
      [bigSeated, tooSmall, bigReception],
      new Map([
        ["big-reception", commute(10)],
        ["big-seated", commute(10)],
        ["too-small", commute(2)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["big-reception", "big-seated"]);
    expect(results[0].bestRoom.max_capacity).toBeGreaterThanOrEqual(200);
  });
});

describe("capacity fit is discounted by how much the figure is believed", () => {
  it("keeps a verified roomy venue above an unverified perfectly-sized one", () => {
    // Regression test for a real defect found by scripts/loadtest-density.ts:
    // fast-food venues whose capacity was a category *estimate* outranked
    // Carmine's site-confirmed private party room, purely because the guessed
    // number happened to sit close to the headcount.
    const guessedTightFit = venue("guessed", [{ max: 60, trust: "unverified" }], {
      price_tier_trust: "likely",
    });
    const confirmedLargeRoom = venue("confirmed", [{ max: 200, trust: "verified" }], {
      price_tier_trust: "likely",
    });

    const results = rankVenues(
      baseCriteria,
      [guessedTightFit, confirmedLargeRoom],
      new Map([
        ["guessed", commute(2)],
        ["confirmed", commute(2)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["confirmed", "guessed"]);
  });

  it("still prefers the tighter fit when both figures are equally trusted", () => {
    const tight = venue("tight", [{ max: 55, trust: "verified" }]);
    const oversized = venue("oversized", [{ max: 400, trust: "verified" }]);

    const results = rankVenues(
      baseCriteria,
      [oversized, tight],
      new Map([
        ["tight", commute(5)],
        ["oversized", commute(5)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["tight", "oversized"]);
  });

  it("prefers a planner-confirmed fit over an identical AI-extracted one", () => {
    const confirmed = venue("confirmed", [{ max: 60, trust: "confirmed_by_planner" }]);
    const extracted = venue("extracted", [{ max: 60, trust: "ai_extracted" }]);

    const results = rankVenues(
      baseCriteria,
      [extracted, confirmed],
      new Map([
        ["confirmed", commute(5)],
        ["extracted", commute(5)],
      ])
    );

    expect(results.map((r) => r.venue.id)).toEqual(["confirmed", "extracted"]);
  });
});

describe("countConfirmedCapacities", () => {
  const rank = (trusts: TrustLevel[]) =>
    rankVenues(
      baseCriteria,
      trusts.map((trust, i) => venue(`v${i}`, [{ max: 60, trust }])),
      new Map(trusts.map((_, i) => [`v${i}`, commute(5)]))
    );

  it("counts figures printed on the venue's own site", () => {
    expect(countConfirmedCapacities(rank(["verified", "verified"]))).toBe(2);
  });

  it("counts planner-confirmed figures, the strongest evidence available", () => {
    expect(countConfirmedCapacities(rank(["confirmed_by_planner"]))).toBe(1);
  });

  it("does not count likely or ai_extracted as confirmation", () => {
    // The whole point of the readout is telling a planner how much of the list
    // they can trust without picking up the phone. Counting inferred figures
    // here would quietly overstate that.
    expect(countConfirmedCapacities(rank(["likely", "ai_extracted", "unverified"]))).toBe(0);
  });

  it("counts only the confirmed subset of a mixed list", () => {
    expect(countConfirmedCapacities(rank(["verified", "likely", "confirmed_by_planner", "unverified"]))).toBe(2);
  });

  it("returns zero for an empty result set rather than throwing", () => {
    expect(countConfirmedCapacities([])).toBe(0);
  });
});
