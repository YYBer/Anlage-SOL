import type { SoReportDto } from "@/lib/tax/so-dto";
import { day, eur } from "./format";

const amount = (x: number) => x.toLocaleString("de-DE", { maximumFractionDigits: x < 1 ? 6 : 2 });

export function SpotDisposals({ so }: { so: SoReportDto }) {
  const unknown = so.disposals.filter((d) => !d.basisKnown).length;
  return (
    <div className="grid gap-3">
      {so.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-warn">
          {so.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-panel text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Sold</th>
              <th className="px-3 py-2 font-medium">Token</th>
              <th className="px-3 py-2 font-medium">Venue</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Acquired</th>
              <th className="px-3 py-2 text-right font-medium">Proceeds</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Gain</th>
              <th className="px-3 py-2 font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {so.disposals.map((d, i) => (
              <tr key={i} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums">{day(d.time)}</td>
                <td className="px-3 py-2 font-medium">{d.token}</td>
                <td className="px-3 py-2 text-muted">{d.venue}</td>
                <td className="px-3 py-2 text-right tabular-nums">{amount(d.amount)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {d.acquiredAt ? day(d.acquiredAt) : "unknown"}
                  {d.taxFree && <span className="ml-1 text-xs text-good">&gt; 1 yr</span>}
                  {!d.basisKnown && <span className="ml-1 text-xs text-warn">cost unknown</span>}
                  {d.basisFromUser && <span className="ml-1 text-xs text-muted">your records</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.proceedsEur)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{eur(d.costEur)}</td>
                <td className={`px-3 py-2 text-right font-mono tabular-nums ${d.gainEur < 0 ? "text-bad" : "text-good"}`}>{eur(d.gainEur)}</td>
                <td className="px-3 py-2">
                  {d.signature ? (
                    <a href={`https://solscan.io/tx/${d.signature}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      Solscan
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {!so.disposals.length && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  No spot disposals in {so.taxYear}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {unknown > 0 && (
        <p className="text-xs text-muted">{unknown} disposals use tokens that arrived by transfer without a purchase price; fill them in above.</p>
      )}
    </div>
  );
}
