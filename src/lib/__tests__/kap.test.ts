import { describe, expect, it } from "vitest";
import { combineKap } from "../tax/kap";

describe("combineKap", () => {
  it("adds other platforms' gains and losses to both KAP lines", () => {
    // Cross-exchange funding trade: our leg lost, the Hyperliquid leg won.
    const t = combineKap({ gainsEur: 100, lossesEur: 300 }, [{ label: "Hyperliquid", gainsEur: 450, lossesEur: 20 }]);
    expect(t).toEqual({ foreignIncomeEur: 230, containedLossesEur: 320, gainsEur: 550, lossesEur: 320 });
  });

  it("ignores negative or invalid entries instead of flipping signs", () => {
    const t = combineKap({ gainsEur: 10, lossesEur: 0 }, [{ label: "x", gainsEur: -5, lossesEur: Number.NaN }]);
    expect(t.foreignIncomeEur).toBe(10);
    expect(t.containedLossesEur).toBe(0);
  });
});

import { parseEur } from "../format";

describe("parseEur", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["1234,5", 1234.5],
    ["1,234.56", 1234.56],
    ["120.50", 120.5],
    ["1.234", 1234],
    ["40 €", 40],
    ["", 0],
    ["abc", 0],
  ])("%s → %d", (input, expected) => {
    expect(parseEur(input)).toBe(expected);
  });
});
