import { describe, expect, it } from "vitest";
import type { Movement } from "../spot/history";
import type { PriceBook } from "../spot/prices";
import { SOL_MINT } from "../spot/tokens";
import { detectVenue } from "../spot/venues";
import { buildSoReport, computeDisposals, heldOverOneYear, transferKey, valueMovements } from "../tax/germany-so";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MEME = "MeMe1111111111111111111111111111111111111111";

// SOL is worth 100 € until 2026-01-01 and 150 € after; USDC is 0.8 €; MEME has no price.
const prices: PriceBook = {
  valueEur(mint, amount, at) {
    if (mint === USDC) return amount * 0.8;
    if (mint === SOL_MINT) return amount * (at < new Date("2026-01-01") ? 100 : 150);
    return null;
  },
};

let n = 0;
const mv = (time: string, deltas: Record<string, number>, kind: Movement["kind"], feeSol = 0): Movement => ({
  signature: `sig${n++}`,
  time: new Date(time),
  deltas: new Map(Object.entries(deltas)),
  feeSol,
  kind,
  venue: "Jupiter",
});

describe("heldOverOneYear", () => {
  it("needs strictly more than one year", () => {
    expect(heldOverOneYear(new Date("2025-03-01T10:00:00Z"), new Date("2026-03-01T10:00:00Z"))).toBe(false);
    expect(heldOverOneYear(new Date("2025-03-01T10:00:00Z"), new Date("2026-03-02T10:00:00Z"))).toBe(true);
  });
});

describe("FIFO disposals", () => {
  it("buys SOL with USDC, sells part within a year and part after, splitting taxable and tax-free", () => {
    const { disposals } = computeDisposals(
      valueMovements([
        mv("2025-01-01T00:00:00Z", { [USDC]: 2000 }, "in"),
        mv("2025-02-01T00:00:00Z", { [USDC]: -1000, [SOL_MINT]: 10 }, "swap"), // 10 SOL for 800 €
        mv("2025-06-01T00:00:00Z", { [USDC]: -500, [SOL_MINT]: 5 }, "swap"), // 5 SOL for 400 €
        mv("2026-03-01T00:00:00Z", { [SOL_MINT]: -12, [USDC]: 2250 }, "swap"), // sell 12 SOL for 1800 €
      ], prices),
    );
    const sell = disposals.filter((d) => d.token === "SOL");
    expect(sell).toHaveLength(2);
    const [taxable, free] = sell;
    // Lot 1 (Feb 2025) is > 1 year old in March 2026; 2 SOL from lot 2 (Jun 2025) are not.
    expect(free).toMatchObject({ taxFree: true, amount: 10 });
    expect(free.costEur).toBeCloseTo(800);
    expect(free.proceedsEur).toBeCloseTo(1500);
    expect(taxable).toMatchObject({ taxFree: false, amount: 2 });
    expect(taxable.costEur).toBeCloseTo(160);
    expect(taxable.proceedsEur).toBeCloseTo(300);
    expect(taxable.gainEur).toBeCloseTo(140);
  });

  it("flags disposals without known cost basis", () => {
    const { disposals } = computeDisposals(valueMovements([mv("2026-02-01T00:00:00Z", { [SOL_MINT]: -1, [USDC]: 150 }, "swap")], prices));
    expect(disposals[0]).toMatchObject({ basisKnown: false, costEur: 0, acquiredAt: null });
  });

  it("carries cost basis through a swap into an unpriced token", () => {
    const { disposals, warnings } = computeDisposals(
      valueMovements([
        mv("2026-01-10T00:00:00Z", { [USDC]: 1000 }, "in"),
        mv("2026-01-11T00:00:00Z", { [USDC]: -1000, [MEME]: 5_000_000 }, "swap"), // valued by USDC: 800 €
        mv("2026-02-11T00:00:00Z", { [MEME]: -5_000_000, [SOL_MINT]: 8 }, "swap"), // valued by SOL: 1200 €
      ], prices),
    );
    const meme = disposals.find((d) => d.token.startsWith("MeMe"))!;
    expect(meme.costEur).toBeCloseTo(800);
    expect(meme.proceedsEur).toBeCloseTo(1200);
    expect(warnings.some((w) => w.includes("Tausch(e) ohne Kurs"))).toBe(false);
  });

  it("treats outgoing transfers as moves, not disposals", () => {
    const { disposals } = computeDisposals(
      valueMovements([mv("2026-01-01T00:00:00Z", { [USDC]: 100 }, "in"), mv("2026-01-02T00:00:00Z", { [USDC]: -100 }, "out")], prices),
    );
    expect(disposals).toHaveLength(0);
  });
});

describe("detectVenue", () => {
  const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
  const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  const BOT = "6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB";
  const CB = "ComputeBudget111111111111111111111111111111";

  it("names the aggregator the user chose, not the pools it routed to", () => {
    expect(detectVenue([CB, JUP], [PUMP])).toBe("Jupiter");
  });

  it("marks trades a bot routed into pump.fun (real case: wallet 3gg6Bx…)", () => {
    expect(detectVenue([CB, BOT], [PUMP])).toBe("pump.fun (via bot)");
    expect(detectVenue([CB, PUMP], [])).toBe("pump.fun");
  });
});

describe("cost overrides for transfers", () => {
  // 10 SOL bought on an exchange in 2024 for 500 €, moved to the wallet in 2026, sold a month later for 1500 €.
  const arrival = mv("2026-01-10T00:00:00Z", { [SOL_MINT]: 10 }, "in");
  const sale = mv("2026-02-10T00:00:00Z", { [SOL_MINT]: -10, [USDC]: 1875 }, "swap");
  const valued = () => valueMovements([arrival, sale], prices);
  const key = transferKey(arrival.signature, SOL_MINT);

  it("without an override, cost is 0 € and the holding period starts on arrival", () => {
    const [d] = computeDisposals(valued()).disposals;
    expect(d).toMatchObject({ basisKnown: false, basisFromUser: false, taxFree: false, costEur: 0 });
    expect(d.gainEur).toBeCloseTo(1500);
  });

  it("uses the user's purchase price and keeps the original purchase date (own-wallet transfers don't reset it)", () => {
    const [d] = computeDisposals(valued(), { [key]: { costEur: 500, acquiredOn: "2024-05-01" } }).disposals;
    expect(d).toMatchObject({ basisKnown: true, basisFromUser: true, taxFree: true, costEur: 500 });
  });

  it("with a recent purchase date the sale stays taxable, now with the real cost", () => {
    const report = buildSoReport(valued(), 2026, [], { [key]: { costEur: 1200, acquiredOn: "2025-12-01" } });
    expect(report.gainEur).toBeCloseTo(300);
    expect(report.disposals[0].basisFromUser).toBe(true);
  });

  it("lists non-stable transfers and marks the ones this year's taxable sales used", () => {
    const report = buildSoReport(valued(), 2026);
    expect(report.transfersIn).toEqual([expect.objectContaining({ key, token: "SOL", amount: 10, usedInTaxYear: 1 })]);
  });
});

describe("buildSoReport", () => {
  it("sums taxable disposals of the year and applies the Freigrenze note", () => {
    const report = buildSoReport(
      valueMovements([
        mv("2026-01-01T00:00:00Z", { [USDC]: 1000 }, "in"),
        mv("2026-01-02T00:00:00Z", { [USDC]: -1000, [SOL_MINT]: 5 }, "swap"), // 800 €
        mv("2026-05-01T00:00:00Z", { [SOL_MINT]: -5, [USDC]: 1100 }, "swap", 0.01), // 880 € proceeds (USDC side), fee 1.5 €
      ], prices),
      2026,
    );
    expect(report.proceedsEur).toBe(1680); // USDC→SOL (800) and SOL→USDC (880)
    expect(report.gainEur).toBeCloseTo(78.5);
    expect(report.belowFreigrenze).toBe(true);
    expect(report.lines.find((l) => l.label === "Gewinn / Verlust")?.value).toBe("78,50 €");
  });
});
