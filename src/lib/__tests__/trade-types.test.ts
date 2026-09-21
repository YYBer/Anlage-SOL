import { describe, expect, it } from "vitest";
import { findHedgedMarkets } from "../../app/_components/Positions";
import { expectsOtherPlatforms, needsPerps, needsSpot, spotReasons } from "../../app/trade-types";
import type { PositionDto, ReportDto } from "../dto";

describe("trade types → forms", () => {
  it("spot alone needs only Anlage SO", () => {
    const s = { types: ["spot" as const], arbKinds: [] };
    expect(needsPerps(s)).toBe(false);
    expect(needsSpot(s)).toBe(true);
  });

  it("cash-and-carry needs both forms; cross-exchange needs only KAP plus other platforms", () => {
    const cc = { types: ["arbitrage" as const], arbKinds: ["cashAndCarry" as const] };
    expect(needsPerps(cc)).toBe(true);
    expect(needsSpot(cc)).toBe(true);
    expect(spotReasons(cc)).toEqual(["the spot leg of your spot + perp trades"]);

    const x = { types: ["arbitrage" as const], arbKinds: ["crossExchange" as const] };
    expect(needsSpot(x)).toBe(false);
    expect(expectsOtherPlatforms(x)).toBe(true);
  });
});

const pos = (over: Partial<PositionDto>): PositionDto => ({
  protocol: "phoenix",
  market: "SOL",
  side: "long",
  openTime: "2026-03-01T00:00:00Z",
  closeTime: "2026-03-10T00:00:00Z",
  openAtYearEnd: false,
  maxSizeUsd: 1000,
  realizations: 1,
  pnlEur: 0,
  feeEur: 0,
  fundingOnFillsEur: 0,
  resultEur: 0,
  incomplete: false,
  lastTx: null,
  ...over,
});

describe("findHedgedMarkets", () => {
  it("pairs overlapping long and short legs of the same market across protocols", () => {
    const report = {
      taxYear: 2026,
      positions: [
        pos({ protocol: "jupiter", side: "long", resultEur: 120 }),
        pos({ protocol: "phoenix", side: "short", resultEur: -100, openTime: "2026-03-05T00:00:00Z", closeTime: null, openAtYearEnd: true }),
        // Same market but no overlap: not a hedge.
        pos({ side: "short", openTime: "2026-06-01T00:00:00Z", closeTime: "2026-06-02T00:00:00Z", resultEur: 5 }),
        pos({ market: "ETH", side: "long" }),
      ],
    } as ReportDto;
    const [sol, ...rest] = findHedgedMarkets(report);
    expect(rest).toHaveLength(0);
    expect(sol.market).toBe("SOL");
    expect(sol.legs).toHaveLength(2);
    expect(sol.resultEur).toBe(20);
  });
});
