import { groupPositions } from "../core/positions";
import type { Fill, FundingPayment, Position, WalletHistory } from "../core/types";
import { FX_SOURCE, type FxTable } from "./fx";
import { combineKap } from "./kap";
import { berlinYear } from "../core/time";

// Cash-settled perps are Termingeschäfte under § 20 Abs. 2 S. 1 Nr. 3 EStG (Kapitalerträge).
// Since JStG 2024 the 20k€ loss cap is gone, so losses offset all capital income.
// Anlage KAP line numbers change between years: verify against the official form before filing.

export const KAP_LINES: Record<number, { foreignIncome: number; containedLosses: number; verified: boolean }> = {
  2025: { foreignIncome: 19, containedLosses: 22, verified: false },
  2026: { foreignIncome: 19, containedLosses: 22, verified: false },
};

/**
 * - "include": funding received counts as gain, funding paid as loss of the derivative result.
 * - "separate": funding is listed on its own and left out of the KAP lines (for the tax advisor to decide;
 *   deducting paid funding as expense may collide with § 20 Abs. 9 EStG).
 */
export type FundingMode = "include" | "separate";

/**
 * One reducing fill = one (partial) Glattstellung, taxed in the year it happens.
 * Opening fees are carried as acquisition costs and released pro rata to the size closed.
 */
export interface Realization {
  fill: Fill;
  pnlEur: number;
  /** This fill's own fee plus the share of opening fees released by it. */
  feeEur: number;
  resultEur: number;
}

/** A position with at least one realization or funding charge in the tax year. */
export interface PositionRow {
  position: Position;
  realizations: Realization[];
  pnlEur: number;
  feeEur: number;
  /** Borrow/funding charged on this position's fills during the year (positive = paid). */
  fundingOnFillsEur: number;
  /** Contribution to Anlage KAP under the chosen funding mode. */
  resultEur: number;
  /** Still open at the end of the tax year. */
  openAtYearEnd: boolean;
}

export interface FundingRow {
  payment: FundingPayment;
  eur: number;
}

export interface GermanyReport {
  taxYear: number;
  fundingMode: FundingMode;
  kap: {
    lineForeignIncome: number;
    lineContainedLosses: number;
    linesVerified: boolean;
    /** Amount for the foreign capital income line (net, may be negative). */
    foreignIncomeEur: number;
    /** Losses contained in that line, as a positive amount. */
    containedLossesEur: number;
    gainsEur: number;
    lossesEur: number;
  };
  /** Funding kept out of KAP when fundingMode = "separate" (both positive). */
  fundingSeparate: { receivedEur: number; paidEur: number };
  positions: PositionRow[];
  funding: FundingRow[];
  notes: string[];
  fxSource: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const yearOf = berlinYear;

/** Share of the pre-fill position that this reducing fill closes. */
function closedFraction(f: Fill): number {
  if (f.kind === "liquidation") return 1;
  if (f.baseDelta !== undefined && f.baseAfter !== undefined) {
    const before = f.baseAfter + f.baseDelta;
    return before > 0 ? f.baseDelta / before : 1;
  }
  const before = f.sizeUsdAfter + f.sizeUsdDelta;
  return before > 0 ? f.sizeUsdDelta / before : 1;
}

export function realize(position: Position, fx: FxTable): Realization[] {
  const out: Realization[] = [];
  let openingFeesEur = 0;
  for (const f of position.fills) {
    const ownFeeEur = fx.toEur(f.feeUsd, f.time);
    if (f.kind === "increase") {
      openingFeesEur += ownFeeEur;
      continue;
    }
    const released = openingFeesEur * Math.min(1, closedFraction(f));
    openingFeesEur -= released;
    const pnlEur = fx.toEur(f.realizedPnlUsd, f.time);
    const feeEur = ownFeeEur + released;
    out.push({ fill: f, pnlEur, feeEur, resultEur: pnlEur - feeEur });
  }
  return out;
}

export function buildGermanyReport(
  history: WalletHistory,
  fx: FxTable,
  taxYear: number,
  fundingMode: FundingMode = "separate",
): GermanyReport {
  const notes: string[] = [...history.warnings];
  const inYear = (d: Date) => yearOf(d) === taxYear;

  const rows: PositionRow[] = [];
  for (const position of groupPositions(history.fills)) {
    const realizations = realize(position, fx).filter((r) => inYear(r.fill.time));
    const fundingOnFillsEur = position.fills.filter((f) => inYear(f.time)).reduce((s, f) => s + fx.toEur(f.fundingUsd, f.time), 0);
    if (!realizations.length && !fundingOnFillsEur) continue;
    const pnlEur = realizations.reduce((s, r) => s + r.pnlEur, 0);
    const feeEur = realizations.reduce((s, r) => s + r.feeEur, 0);
    rows.push({
      position,
      realizations,
      pnlEur,
      feeEur,
      fundingOnFillsEur,
      resultEur: pnlEur - feeEur - (fundingMode === "include" ? fundingOnFillsEur : 0),
      openAtYearEnd: !position.closeTime || yearOf(position.closeTime) > taxYear,
    });
  }

  const funding: FundingRow[] = history.funding
    .filter((f) => inYear(f.time))
    .map((payment) => ({ payment, eur: fx.toEur(payment.amountUsd, payment.time) }));

  // Every Glattstellung is its own gain or loss, so gains and losses are summed per realization,
  // not netted per position first.
  let gains = 0;
  let losses = 0;
  for (const r of rows.flatMap((row) => row.realizations)) {
    if (r.resultEur >= 0) gains += r.resultEur;
    else losses -= r.resultEur;
  }

  let received = 0;
  let paid = rows.reduce((s, r) => s + r.fundingOnFillsEur, 0);
  for (const f of funding) {
    if (f.eur >= 0) received += f.eur;
    else paid -= f.eur;
  }
  if (fundingMode === "include") {
    gains += received;
    losses += paid;
  }

  const incomplete = rows.filter((r) => r.position.incomplete);
  if (incomplete.length) {
    notes.push(`${incomplete.length} Position(en) wurden vor Beginn der abgerufenen Historie eröffnet; Eröffnungsgebühren fehlen evtl.`);
  }
  const lines = KAP_LINES[taxYear] ?? { foreignIncome: 19, containedLosses: 22, verified: false };
  if (!lines.verified) notes.push(`Zeilennummern der Anlage KAP ${taxYear} bitte mit dem amtlichen Vordruck abgleichen.`);
  if (history.collateral.length) {
    notes.push("Ein- und Auszahlungen von Sicherheiten bei Perp-Protokollen gelten nicht als Veräußerung; Anlage SO erfasst nur Tauschgeschäfte der Wallet.");
  }

  return {
    taxYear,
    fundingMode,
    kap: {
      lineForeignIncome: lines.foreignIncome,
      lineContainedLosses: lines.containedLosses,
      linesVerified: lines.verified,
      ...combineKap({ gainsEur: gains, lossesEur: losses }, []),
    },
    fundingSeparate: fundingMode === "separate" ? { receivedEur: round2(received), paidEur: round2(paid) } : { receivedEur: 0, paidEur: 0 },
    positions: rows,
    funding,
    notes,
    fxSource: FX_SOURCE,
  };
}
