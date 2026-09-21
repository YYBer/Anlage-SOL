import type { Fill, FundingPayment } from "../core/types";
import type { FxTable } from "../tax/fx";
import type { GermanyReport } from "../tax/germany";
import { berlinYear } from "../core/time";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
const n = (x: number, digits = 2) => x.toFixed(digits);
const iso = (d?: Date) => (d ? d.toISOString() : "");

export const solscanTx = (sig?: string) => (sig ? `https://solscan.io/tx/${sig}` : "");

/** One row per position with realizations in the tax year, with EUR amounts as used for Anlage KAP. */
export function positionsCsv(report: GermanyReport): string {
  return toCsv(
    ["protocol", "market", "side", "open_time_utc", "close_time_utc", "status_year_end", "max_size_usd", "realizations", "pnl_eur", "fees_eur", "funding_on_fills_eur", "result_eur", "incomplete"],
    report.positions.map((r) => {
      const p = r.position;
      return [p.protocol, p.market, p.side, iso(p.openTime), iso(p.closeTime), r.openAtYearEnd ? "open" : "closed", n(p.maxSizeUsd), r.realizations.length, n(r.pnlEur), n(r.feeEur), n(r.fundingOnFillsEur), n(r.resultEur), p.incomplete];
    }),
  );
}

/**
 * Audit trail: every fill of the tax year and every funding payment, with on-chain signature and
 * the applied ECB rate. `result_eur` is set on reducing fills and includes released opening fees.
 */
export function ledgerCsv(report: GermanyReport, fx: FxTable): string {
  const rows: unknown[][] = [];
  for (const r of report.positions) {
    const byFill = new Map(r.realizations.map((z) => [z.fill, z]));
    for (const f of r.position.fills) {
      if (berlinYear(f.time) !== report.taxYear) continue;
      const { rate, date } = fx.rateAt(f.time);
      const z = byFill.get(f);
      rows.push([iso(f.time), f.protocol, f.market, f.side, f.kind, n(f.sizeUsdDelta), n(f.price, 6), n(f.realizedPnlUsd, 6), n(f.feeUsd, 6), n(f.fundingUsd, 6), rate, date, z ? n(z.pnlEur, 6) : "", z ? n(z.feeEur, 6) : "", z ? n(z.resultEur, 6) : "", f.signature ?? "", solscanTx(f.signature)]);
    }
  }
  for (const { payment: p, eur } of report.funding) {
    const { rate, date } = fx.rateAt(p.time);
    rows.push([iso(p.time), p.protocol, p.market, p.side, "funding", "", "", "", "", n(-p.amountUsd, 6), rate, date, "", "", n(eur, 6), p.signature ?? "", solscanTx(p.signature)]);
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return toCsv(
    ["time_utc", "protocol", "market", "side", "kind", "size_usd", "price", "pnl_usd", "fee_usd", "funding_paid_usd", "ecb_usd_per_eur", "ecb_rate_date", "pnl_eur", "fee_eur_incl_opening", "result_eur", "signature", "solscan"],
    rows,
  );
}

// Koinly "Universal" format. Realized PnL is a deposit (gain) or withdrawal (loss) tagged "realized gain";
// fees are withdrawals tagged "margin fee". Funding has no dedicated label in the simple format: received
// funding is booked as "realized gain", paid funding as "margin fee".
const koinlyDate = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function koinlyCsv(fills: Fill[], funding: FundingPayment[]): string {
  const rows: unknown[][] = [];
  const pnlRow = (time: Date, usd: number, label: string, desc: string, sig?: string) =>
    usd >= 0
      ? [koinlyDate(time), "", "", n(usd, 6), "USDC", "", "", "", "", label, desc, sig ?? ""]
      : [koinlyDate(time), n(-usd, 6), "USDC", "", "", "", "", "", "", label, desc, sig ?? ""];

  for (const f of fills) {
    const desc = `${f.protocol} ${f.market}-${f.side} ${f.kind}`;
    if (f.realizedPnlUsd !== 0) rows.push(pnlRow(f.time, f.realizedPnlUsd, "realized gain", desc, f.signature));
    if (f.feeUsd > 0) rows.push(pnlRow(f.time, -f.feeUsd, "margin fee", `${desc} fee`, f.signature));
    if (f.fundingUsd > 0) rows.push(pnlRow(f.time, -f.fundingUsd, "margin fee", `${desc} borrow/funding`, f.signature));
  }
  for (const p of funding) {
    if (p.amountUsd === 0) continue;
    rows.push(pnlRow(p.time, p.amountUsd, p.amountUsd > 0 ? "realized gain" : "margin fee", `${p.protocol} ${p.market}-${p.side} funding`, p.signature));
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return toCsv(
    ["Date", "Sent Amount", "Sent Currency", "Received Amount", "Received Currency", "Fee Amount", "Fee Currency", "Net Worth Amount", "Net Worth Currency", "Label", "Description", "TxHash"],
    rows,
  );
}
