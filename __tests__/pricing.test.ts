import {
  resolvePricing,
  PRICING_CATALOG,
  GROUNDING_PRICE_PER_1000_QUERIES,
} from "../src/server/pricing";

describe("PRICING_CATALOG", () => {
  it("has an entry for every model", () => {
    expect(PRICING_CATALOG["gemini-3.1-flash-lite"]).toBeDefined();
    expect(PRICING_CATALOG["gemini-3.1-pro-preview"]).toBeDefined();
  });
});

describe("GROUNDING_PRICE_PER_1000_QUERIES", () => {
  it("is 14.00", () => {
    expect(GROUNDING_PRICE_PER_1000_QUERIES).toBe(14.0);
  });
});

describe("resolvePricing", () => {
  it("returns flat pricing for gemini-3.1-flash-lite regardless of prompt size", () => {
    expect(resolvePricing("gemini-3.1-flash-lite", 5)).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
    });
    expect(resolvePricing("gemini-3.1-flash-lite", 500_000)).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
    });
  });

  it("returns standard-tier pricing for gemini-3.1-pro-preview at or below 200k prompt tokens", () => {
    expect(resolvePricing("gemini-3.1-pro-preview", 200_000)).toEqual({
      inputPerMillion: 2.0,
      outputPerMillion: 12.0,
    });
  });

  it("returns the over-200k tier for gemini-3.1-pro-preview above 200k prompt tokens", () => {
    expect(resolvePricing("gemini-3.1-pro-preview", 200_001)).toEqual({
      inputPerMillion: 4.0,
      outputPerMillion: 18.0,
    });
  });
});
