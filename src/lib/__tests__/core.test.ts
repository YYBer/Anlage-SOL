import { describe, expect, it } from "vitest";
import { tradeToFills } from "../adapters/phoenix";
import { eventToFill, type PositionSlot } from "../adapters/jupiter";
import { groupPositions } from "../core/positions";
import type { Fill } from "../core/types";
import { fxTableFromRates, parseEcbCsv } from "../tax/fx";
import { buildGermanyReport, realize } from "../tax/germany";
import { PublicKey } from "@solana/web3.js";

// Rate 1.25 USD/EUR everywhere keeps EUR math readable: EUR = USD * 0.8.
const flatFx = fxTableFromRates(new Map([["2025-01-01", 1.25]]));

const trade = (over: Partial<Parameters<typeof tradeToFills>[0]>) => ({
  traderPdaIndex: 0,
  subaccountIndex: 0,
  marketSymbol: "AMAT",
  signature: "sig",
  timestamp: "2026-09-21T18:55:28Z",
  slot: 1,
  slotIndex: 0,
  eventIndex: 0,
  instructionType: "PlaceMarketOrder",
  baseLotsBefore: "0",
  baseLotsAfter: "0",
  price: "100",
  realizedPnl: "0",
  fees: "0",
  tradeType: "market",
  ...over,
});

let t = 0;
const fill = (over: Partial<Fill>): Fill => ({
  protocol: "phoenix",
  positionKey: "k",
  market: "SOL",
  side: "long",
  time: new Date(Date.UTC(2026, 0, 1, 0, t++)),
  sizeUsdDelta: 0,
  sizeUsdAfter: 0,
  price: 100,
  kind: "increase",
  realizedPnlUsd: 0,
  feeUsd: 0,
  fundingUsd: 0,
  ...over,
});

describe("phoenix tradeToFills", () => {
  it("splits a fill that flips short to long (real mainnet case)", () => {
    const fills = tradeToFills(trade({ baseLotsBefore: "-0.002", baseLotsAfter: "0.005", price: "465.73", realizedPnl: "0.00048", fees: "0.7" }));
    expect(fills).toHaveLength(2);
    expect(fills[0]).toMatchObject({ side: "short", kind: "decrease", baseAfter: 0, realizedPnlUsd: 0.00048 });
    expect(fills[1]).toMatchObject({ side: "long", kind: "increase", baseAfter: 0.005, realizedPnlUsd: 0 });
    expect(fills[0].feeUsd).toBeCloseTo(0.2);
    expect(fills[1].feeUsd).toBeCloseTo(0.5);
  });

  it("marks liquidations", () => {
    const [f] = tradeToFills(trade({ baseLotsBefore: "2", baseLotsAfter: "0", tradeType: "liquidation", realizedPnl: "-5" }));
    expect(f.kind).toBe("liquidation");
  });
});

describe("jupiter eventToFill", () => {
  const slot: PositionSlot = { market: "ETH", side: "short", collateral: "USDC", pda: PublicKey.default };
  const usd = (x: number) => ({ toString: () => String(Math.round(x * 1e6)) });

  it("uses positionFeeUsd as fee and fundingFeeUsd as borrow (verified on mainnet tx 1CSfobbCBs…)", () => {
    const f = eventToFill(
      {
        name: "InstantDecreasePositionEvent",
        data: {
          sizeUsdDelta: usd(1188.811603),
          positionSizeUsd: usd(0),
          feeUsd: usd(0.832527),
          positionFeeUsd: usd(0.832169),
          fundingFeeUsd: usd(0.000358),
          priceImpactFeeUsd: usd(0.118882),
          pnlDelta: usd(5.016795),
          hasProfit: false,
          price: usd(2724.998812),
        },
      },
      slot,
      new Date(),
      "sig",
    )!;
    expect(f.kind).toBe("decrease");
    expect(f.realizedPnlUsd).toBeCloseTo(-5.016795);
    expect(f.feeUsd).toBeCloseTo(0.832169);
    expect(f.fundingUsd).toBeCloseTo(0.000358);
    expect(f.sizeUsdAfter).toBe(0);
  });
});

describe("groupPositions", () => {
  it("starts a new position after the slot goes flat", () => {
    const ps = groupPositions([
      fill({ kind: "increase", sizeUsdDelta: 100, sizeUsdAfter: 100 }),
      fill({ kind: "decrease", sizeUsdDelta: 100, sizeUsdAfter: 0, realizedPnlUsd: 10 }),
      fill({ kind: "increase", sizeUsdDelta: 50, sizeUsdAfter: 50 }),
    ]);
    expect(ps).toHaveLength(2);
    expect(ps[0].closeTime).toBeDefined();
    expect(ps[1].closeTime).toBeUndefined();
  });

  it("flags positions whose opening is outside the fetched history", () => {
    const [p] = groupPositions([fill({ kind: "decrease", sizeUsdDelta: 10, sizeUsdAfter: 0 })]);
    expect(p.incomplete).toBe(true);
  });
});

describe("germany", () => {
  it("releases opening fees pro rata on partial closes", () => {
    const [p] = groupPositions([
      fill({ kind: "increase", baseDelta: 4, baseAfter: 4, sizeUsdDelta: 400, sizeUsdAfter: 400, feeUsd: 4 }),
      fill({ kind: "decrease", baseDelta: 1, baseAfter: 3, sizeUsdDelta: 100, sizeUsdAfter: 300, feeUsd: 1, realizedPnlUsd: 10 }),
      fill({ kind: "decrease", baseDelta: 3, baseAfter: 0, sizeUsdDelta: 300, sizeUsdAfter: 0, feeUsd: 3, realizedPnlUsd: -20 }),
    ]);
    const [a, b] = realize(p, flatFx);
    expect(a.feeEur).toBeCloseTo((1 + 1) * 0.8);
    expect(b.feeEur).toBeCloseTo((3 + 3) * 0.8);
    expect(a.resultEur + b.resultEur).toBeCloseTo((10 - 20 - 8) * 0.8);
  });

  it("taxes partial closes of a still-open position in their own year and splits gains/losses", () => {
    const history = {
      wallet: "w",
      fills: [
        fill({ kind: "increase", baseDelta: 2, baseAfter: 2, sizeUsdDelta: 200, sizeUsdAfter: 200, time: new Date("2025-12-01") }),
        fill({ kind: "decrease", baseDelta: 1, baseAfter: 1, sizeUsdDelta: 100, sizeUsdAfter: 100, realizedPnlUsd: 50, time: new Date("2025-12-15") }),
        fill({ kind: "decrease", baseDelta: 1, baseAfter: 0, sizeUsdDelta: 100, sizeUsdAfter: 0, realizedPnlUsd: -25, time: new Date("2026-01-10") }),
      ],
      funding: [
        { protocol: "phoenix" as const, market: "SOL", side: "long" as const, time: new Date("2025-12-20"), amountUsd: -5 },
      ],
      collateral: [],
      warnings: [],
    };
    const r2025 = buildGermanyReport(history, flatFx, 2025, "separate");
    expect(r2025.kap.foreignIncomeEur).toBe(40);
    expect(r2025.kap.containedLossesEur).toBe(0);
    expect(r2025.fundingSeparate.paidEur).toBe(4);
    expect(r2025.positions[0].openAtYearEnd).toBe(true);

    const r2025incl = buildGermanyReport(history, flatFx, 2025, "include");
    expect(r2025incl.kap.foreignIncomeEur).toBe(36);
    expect(r2025incl.kap.containedLossesEur).toBe(4);

    const r2026 = buildGermanyReport(history, flatFx, 2026, "separate");
    expect(r2026.kap.foreignIncomeEur).toBe(-20);
    expect(r2026.kap.containedLossesEur).toBe(20);
  });
});

describe("fx", () => {
  it("uses the last published ECB rate on weekends", () => {
    const fx = fxTableFromRates(parseEcbCsv("KEY,TIME_PERIOD,OBS_VALUE\nx,2026-09-18,1.146\nx,2026-09-21,1.149\n"));
    expect(fx.rateAt(new Date("2026-09-20T12:00:00Z"))).toEqual({ rate: 1.146, date: "2026-09-18" });
    expect(fx.toEur(114.6, new Date("2026-09-19T00:00:00Z"))).toBeCloseTo(100);
  });
});
