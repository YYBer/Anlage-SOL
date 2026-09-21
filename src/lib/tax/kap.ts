// Combines our on-chain KAP result with amounts the user enters for other platforms
// (another DEX, Hyperliquid, a foreign CEX). Pure so the browser can recompute on every keystroke.

/** A platform we do not read ourselves. Both amounts are positive EUR, as stated in that platform's report. */
export interface OtherSource {
  label: string;
  gainsEur: number;
  lossesEur: number;
}

export interface KapTotals {
  /** Net result for the foreign capital income line (may be negative). */
  foreignIncomeEur: number;
  /** Losses contained in that line, as a positive amount. */
  containedLossesEur: number;
  gainsEur: number;
  lossesEur: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const clean = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

export function combineKap(own: { gainsEur: number; lossesEur: number }, others: OtherSource[]): KapTotals {
  let gains = own.gainsEur;
  let losses = own.lossesEur;
  for (const o of others) {
    gains += clean(o.gainsEur);
    losses += clean(o.lossesEur);
  }
  // Round the parts first so the filed net always equals the gains and losses shown next to it.
  const g = round2(gains);
  const l = round2(losses);
  return { foreignIncomeEur: round2(g - l), containedLossesEur: l, gainsEur: g, lossesEur: l };
}
