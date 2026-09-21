import { describe, expect, it } from "vitest";
import { findHedgedMarkets } from "../../app/_components/Positions";
import type { PositionDto, ReportDto } from "../dto";

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
  it("does not pair a long and a short on the same platform", () => {
    const report = {
      taxYear: 2026,
      positions: [pos({ protocol: "jupiter", side: "long" }), pos({ protocol: "jupiter", side: "short" })],
    } as ReportDto;
    expect(findHedgedMarkets(report)).toHaveLength(0);
  });

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
