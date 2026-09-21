import { describe, expect, it } from "vitest";
import { berlinDate, berlinDateTime, berlinYear, taxYearEnd, taxYearStart } from "../core/time";
import { fxTableFromRates } from "../tax/fx";
import { buildGermanyReport } from "../tax/germany";
import { heldOverOneYear } from "../tax/germany-so";
import type { Fill } from "../core/types";

describe("Europe/Berlin tax time", () => {
  it("puts a New Year's Eve trade after 23:00 UTC into the next tax year", () => {
    expect(berlinYear(new Date("2026-12-31T22:59:59Z"))).toBe(2026);
    expect(berlinYear(new Date("2026-12-31T23:00:00Z"))).toBe(2027);
  });

  it("handles summer time (UTC+2)", () => {
    expect(berlinDate(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(berlinDateTime("2026-06-30T22:30:00Z")).toBe("2026-07-01 00:30:00");
    expect(berlinDate(new Date("2026-01-15T22:30:00Z"))).toBe("2026-01-15");
  });

  it("has exact tax year bounds", () => {
    expect(taxYearStart(2026).toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(taxYearEnd(2026).toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("uses the ECB rate of the German calendar day", () => {
    const fx = fxTableFromRates(new Map([["2026-07-01", 1.2], ["2026-06-30", 1.1]]));
    expect(fx.rateAt(new Date("2026-06-30T22:30:00Z")).date).toBe("2026-07-01");
  });

  it("counts holding periods by German calendar date", () => {
    // Bought 2025-03-01 00:30 Berlin (23:30 UTC the day before): tax-free from 2026-03-02 Berlin.
    const bought = new Date("2025-02-28T23:30:00Z");
    expect(heldOverOneYear(bought, new Date("2026-03-01T12:00:00Z"))).toBe(false);
    expect(heldOverOneYear(bought, new Date("2026-03-02T00:30:00Z"))).toBe(true);
  });

  it("assigns a close on New Year's Eve 23:30 UTC to the next report", () => {
    const fill = (over: Partial<Fill>): Fill => ({
      protocol: "phoenix",
      positionKey: "k",
      market: "SOL",
      side: "long",
      time: new Date(),
      sizeUsdDelta: 100,
      sizeUsdAfter: 0,
      price: 100,
      kind: "increase",
      realizedPnlUsd: 0,
      feeUsd: 0,
      fundingUsd: 0,
      ...over,
    });
    const history = {
      wallet: "w",
      fills: [
        fill({ kind: "increase", sizeUsdAfter: 100, baseDelta: 1, baseAfter: 1, time: new Date("2026-12-01T10:00:00Z") }),
        fill({ kind: "decrease", sizeUsdAfter: 0, baseDelta: 1, baseAfter: 0, realizedPnlUsd: 50, time: new Date("2026-12-31T23:30:00Z") }),
      ],
      funding: [],
      collateral: [],
      warnings: [],
    };
    const fx = fxTableFromRates(new Map([["2026-01-01", 1.25]]));
    expect(buildGermanyReport(history, fx, 2026).kap.gainsEur).toBe(0);
    expect(buildGermanyReport(history, fx, 2027).kap.gainsEur).toBe(40);
  });
});
