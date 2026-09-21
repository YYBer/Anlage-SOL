import { koinlyCsv, ledgerCsv, positionsCsv, solscanTx } from "./export/csv";
import type { WalletHistory } from "./core/types";
import type { FxTable } from "./tax/fx";
import type { GermanyReport } from "./tax/germany";
import type { SoReportDto } from "./tax/so-dto";
import { berlinMonth, berlinYear } from "./core/time";

// JSON-safe view of a report for the browser.

export interface PositionDto {
  protocol: string;
  market: string;
  side: string;
  openTime: string;
  closeTime: string | null;
  openAtYearEnd: boolean;
  maxSizeUsd: number;
  realizations: number;
  pnlEur: number;
  feeEur: number;
  fundingOnFillsEur: number;
  resultEur: number;
  incomplete: boolean;
  lastTx: string | null;
}

/** One (partial) close, as taxed. */
export interface RealizationDto {
  time: string;
  protocol: string;
  market: string;
  side: string;
  kind: string;
  sizeUsd: number;
  price: number;
  pnlUsd: number;
  pnlEur: number;
  /** Own fee plus released opening fees. */
  feeEur: number;
  resultEur: number;
  ecbRate: number;
  ecbDate: string;
  signature: string | null;
}

export interface FillDto {
  time: string;
  protocol: string;
  market: string;
  side: string;
  kind: string;
  sizeUsd: number;
  price: number;
  feeUsd: number;
  fundingUsd: number;
  signature: string | null;
}

/** Funding is paid hourly; the receipt aggregates it per month and market (full detail is in the ledger CSV). */
export interface FundingMonthDto {
  month: string;
  protocol: string;
  market: string;
  payments: number;
  receivedEur: number;
  paidEur: number;
}

export interface ReportDto {
  wallet: string;
  taxYear: number;
  fundingMode: GermanyReport["fundingMode"];
  kap: GermanyReport["kap"];
  fundingSeparate: GermanyReport["fundingSeparate"];
  fundingPayments: number;
  positions: PositionDto[];
  notes: string[];
  fxSource: string;
  counts: { fills: number; realizations: number };
  realizations: RealizationDto[];
  fills: FillDto[];
  fundingMonthly: FundingMonthDto[];
  protocols: string[];
  csv: { positions: string; ledger: string; koinly: string };
  /** Present when the request asked for spot (Anlage SO). */
  so?: SoReportDto | null;
  soError?: string;
}

function fundingByMonth(report: GermanyReport): FundingMonthDto[] {
  const rows = new Map<string, FundingMonthDto>();
  for (const { payment: p, eur } of report.funding) {
    const month = berlinMonth(p.time);
    const key = `${month}|${p.protocol}|${p.market}`;
    const row = rows.get(key) ?? { month, protocol: p.protocol, market: p.market, payments: 0, receivedEur: 0, paidEur: 0 };
    row.payments++;
    if (eur >= 0) row.receivedEur += eur;
    else row.paidEur -= eur;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.market.localeCompare(b.market));
}

export function toDto(history: WalletHistory, fx: FxTable, report: GermanyReport): ReportDto {
  const inYear = (d: Date) => berlinYear(d) === report.taxYear;
  return {
    wallet: history.wallet,
    taxYear: report.taxYear,
    fundingMode: report.fundingMode,
    kap: report.kap,
    fundingSeparate: report.fundingSeparate,
    fundingPayments: report.funding.length,
    positions: report.positions.map((r) => {
      const last = r.realizations.at(-1)?.fill ?? r.position.fills.at(-1);
      return {
        protocol: r.position.protocol,
        market: r.position.market,
        side: r.position.side,
        openTime: r.position.openTime.toISOString(),
        closeTime: r.position.closeTime?.toISOString() ?? null,
        openAtYearEnd: r.openAtYearEnd,
        maxSizeUsd: r.position.maxSizeUsd,
        realizations: r.realizations.length,
        pnlEur: r.pnlEur,
        feeEur: r.feeEur,
        fundingOnFillsEur: r.fundingOnFillsEur,
        resultEur: r.resultEur,
        incomplete: r.position.incomplete,
        lastTx: last?.signature ? solscanTx(last.signature) : null,
      };
    }),
    notes: report.notes,
    fxSource: report.fxSource,
    realizations: report.positions
      .flatMap((r) => r.realizations)
      .sort((a, b) => a.fill.time.getTime() - b.fill.time.getTime())
      .map((z) => {
        const f = z.fill;
        const { rate, date } = fx.rateAt(f.time);
        return {
          time: f.time.toISOString(),
          protocol: f.protocol,
          market: f.market,
          side: f.side,
          kind: f.kind,
          sizeUsd: f.sizeUsdDelta,
          price: f.price,
          pnlUsd: f.realizedPnlUsd,
          pnlEur: z.pnlEur,
          feeEur: z.feeEur,
          resultEur: z.resultEur,
          ecbRate: rate,
          ecbDate: date,
          signature: f.signature ?? null,
        };
      }),
    fills: history.fills
      .filter((f) => inYear(f.time))
      .map((f) => ({
        time: f.time.toISOString(),
        protocol: f.protocol,
        market: f.market,
        side: f.side,
        kind: f.kind,
        sizeUsd: f.sizeUsdDelta,
        price: f.price,
        feeUsd: f.feeUsd,
        fundingUsd: f.fundingUsd,
        signature: f.signature ?? null,
      })),
    fundingMonthly: fundingByMonth(report),
    protocols: [...new Set(history.fills.map((f) => f.protocol))],
    counts: {
      fills: history.fills.filter((f) => inYear(f.time)).length,
      realizations: report.positions.reduce((s, r) => s + r.realizations.length, 0),
    },
    csv: {
      positions: positionsCsv(report),
      ledger: ledgerCsv(report, fx),
      koinly: koinlyCsv(history.fills.filter((f) => inYear(f.time)), report.funding.map((f) => f.payment)),
    },
  };
}
