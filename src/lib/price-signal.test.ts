import { describe, expect, it } from "vitest";
import { costPerPerson, priceSignal } from "@/lib/price-signal";

describe("priceSignal", () => {
  it("prefers a concrete minimum spend and carries that figure's own trust", () => {
    const signal = priceSignal({
      min_spend_usd: 2500,
      min_spend_trust: "verified",
      price_tier: "$$",
      price_tier_trust: "likely",
    });

    expect(signal.label).toBe("$2,500 min spend");
    expect(signal.trust).toBe("verified");
    expect(signal.known).toBe(true);
  });

  it("falls back to price tier with the tier's own trust label", () => {
    const signal = priceSignal({
      min_spend_usd: null,
      min_spend_trust: "unverified",
      price_tier: "$$$",
      price_tier_trust: "likely",
    });

    expect(signal.label).toBe("$$$");
    expect(signal.trust).toBe("likely");
    expect(signal.known).toBe(true);
  });

  it("shows an honest unknown rather than rendering blank", () => {
    const signal = priceSignal({
      min_spend_usd: null,
      min_spend_trust: "unverified",
      price_tier: null,
      price_tier_trust: "unverified",
    });

    expect(signal.label).toBe("Price unknown");
    expect(signal.trust).toBe("unverified");
    expect(signal.known).toBe(false);
  });

  it("never reports a price as more trustworthy than its own source", () => {
    // Guards the spec requirement that the price signal carries its own
    // label: an unverified min spend stays unverified even next to a
    // confidently-labeled price tier.
    const signal = priceSignal({
      min_spend_usd: 10000,
      min_spend_trust: "unverified",
      price_tier: "$$$$",
      price_tier_trust: "verified",
    });

    expect(signal.trust).toBe("unverified");
  });

  it("formats large minimum spends with thousands separators", () => {
    const signal = priceSignal({
      min_spend_usd: 125000,
      min_spend_trust: "verified",
      price_tier: null,
      price_tier_trust: "unverified",
    });

    expect(signal.label).toBe("$125,000 min spend");
  });
});

describe("costPerPerson", () => {
  const withMinSpend = (min_spend_usd: number | null, min_spend_trust: "verified" | "unverified" = "verified") => ({
    min_spend_usd,
    min_spend_trust,
    price_tier: "$$$",
    price_tier_trust: "likely" as const,
  });

  it("divides the minimum spend across the group", () => {
    expect(costPerPerson(withMinSpend(3000), 50)?.label).toBe("~$60/person min");
  });

  it("inherits the minimum spend's trust so an estimate can't outrank its source", () => {
    const estimate = costPerPerson(withMinSpend(3000, "unverified"), 50);

    expect(estimate?.trust).toBe("unverified");
  });

  it("returns null for a price tier alone rather than inventing a dollar figure", () => {
    expect(costPerPerson(withMinSpend(null), 50)).toBeNull();
  });

  it("returns null for a nonsensical headcount instead of dividing by zero", () => {
    expect(costPerPerson(withMinSpend(3000), 0)).toBeNull();
    expect(costPerPerson(withMinSpend(3000), -5)).toBeNull();
  });

  it("drops sub-dollar precision that the underlying confidence can't support", () => {
    expect(costPerPerson(withMinSpend(1000), 3)?.label).toBe("~$333/person min");
  });

  it("keeps one decimal only when the per-head figure is genuinely small", () => {
    expect(costPerPerson(withMinSpend(500), 200)?.label).toBe("~$2.5/person min");
  });
});
