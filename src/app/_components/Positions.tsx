import { taxYearEnd } from "@/lib/core/time";
import type { PositionDto, ReportDto } from "@/lib/dto";
import { day, eur, usd } from "./format";

export function PositionsTable({ report }: { report: ReportDto }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-panel text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Market</th>
            <th className="px-3 py-2 font-medium">Opened</th>
            <th className="px-3 py-2 font-medium">Closed</th>
            <th className="px-3 py-2 text-right font-medium">Max size</th>
            <th className="px-3 py-2 text-right font-medium">Closes</th>
            <th className="px-3 py-2 text-right font-medium">PnL</th>
            <th className="px-3 py-2 text-right font-medium">Fees</th>
            <th className="px-3 py-2 text-right font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {report.positions.map((p, i) => (
            <tr key={i} className="border-t border-line">
              <td className="px-3 py-2">
                <span className="font-medium">{p.market}</span> <span className="text-muted">{p.side}</span>
                <span className="block text-xs text-muted">{p.protocol}</span>
              </td>
              <td className="px-3 py-2 tabular-nums">{day(p.openTime)}</td>
              <td className="px-3 py-2 tabular-nums">{p.openAtYearEnd ? <span className="text-muted">open</span> : day(p.closeTime)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{usd(p.maxSizeUsd)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.realizations}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(p.pnlEur)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(p.feeEur)}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${p.resultEur < 0 ? "text-bad" : "text-good"}`}>{eur(p.resultEur)}</td>
              <td className="px-3 py-2">
                {p.lastTx ? (
                  <a href={p.lastTx} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Solscan
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {!report.positions.length && (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-muted">
                No realized results in {report.taxYear}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface HedgedMarket {
  market: string;
  legs: PositionDto[];
  resultEur: number;
}

/**
 * Markets where the wallet held a long on one platform and a short on another at the same time, e.g. long SOL
 * on Jupiter and short SOL on Phoenix. Hedges within one platform are not paired (not supported yet).
 * Only for display: tax-wise every leg stays its own Termingeschäft.
 */
export function findHedgedMarkets(report: ReportDto): HedgedMarket[] {
  const yearEnd = taxYearEnd(report.taxYear).getTime();
  const span = (p: PositionDto) => [Date.parse(p.openTime), p.closeTime ? Date.parse(p.closeTime) : yearEnd] as const;
  const overlaps = (a: PositionDto, b: PositionDto) => {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    return a0 < b1 && b0 < a1;
  };

  const byMarket = new Map<string, PositionDto[]>();
  for (const p of report.positions) byMarket.set(p.market, [...(byMarket.get(p.market) ?? []), p]);

  const out: HedgedMarket[] = [];
  for (const [market, ps] of byMarket) {
    const legs = ps.filter((p) => ps.some((q) => q.protocol !== p.protocol && q.side !== p.side && overlaps(p, q)));
    if (legs.length) out.push({ market, legs, resultEur: legs.reduce((s, l) => s + l.resultEur, 0) });
  }
  return out;
}

export function HedgedMarkets({ report }: { report: ReportDto }) {
  const hedged = findHedgedMarkets(report);
  if (!hedged.length) {
    return <p className="text-sm text-muted">No overlapping long and short positions on Phoenix and Jupiter found for {report.taxYear}.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-panel text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Market</th>
            <th className="px-3 py-2 font-medium">Legs</th>
            <th className="px-3 py-2 text-right font-medium">Legs combined (excl. funding)</th>
          </tr>
        </thead>
        <tbody>
          {hedged.map((h) => (
            <tr key={h.market} className="border-t border-line align-top">
              <td className="px-3 py-2 font-medium">{h.market}</td>
              <td className="px-3 py-2">
                {h.legs.map((l, i) => (
                  <span key={i} className="block">
                    {l.side} on {l.protocol} <span className="font-mono text-muted">{eur(l.resultEur)}</span>
                  </span>
                ))}
              </td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${h.resultEur < 0 ? "text-bad" : "text-good"}`}>{eur(h.resultEur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
