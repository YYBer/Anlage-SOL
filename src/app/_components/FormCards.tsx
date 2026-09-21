import type { ReportDto } from "@/lib/dto";
import type { KapTotals } from "@/lib/tax/kap";
import type { SoReportDto } from "@/lib/tax/so-dto";
import { card, eur } from "./format";

export function KapCard({ report, totals, othersIncluded }: { report: ReportDto; totals: KapTotals; othersIncluded: boolean }) {
  return (
    <div className={card}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Anlage KAP {report.taxYear}</h2>
        <span className="text-xs text-muted">Perps · perp legs · § 20 EStG</span>
      </div>
      <dl className="mt-4 grid gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm">
            Zeile {report.kap.lineForeignIncome}
            <span className="block text-xs text-muted">Ausländische Kapitalerträge</span>
          </dt>
          <dd className="font-mono text-xl tabular-nums">{eur(totals.foreignIncomeEur)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-sm">
            Zeile {report.kap.lineContainedLosses}
            <span className="block text-xs text-muted">Darin enthaltene Verluste</span>
          </dt>
          <dd className="font-mono text-xl tabular-nums">{eur(totals.containedLossesEur)}</dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-1 text-xs text-muted">
        <p>
          On-chain: gains {eur(report.kap.gainsEur)} · losses {eur(report.kap.lossesEur)} · {report.counts.realizations} closes
        </p>
        {othersIncluded && (
          <p>
            Other platforms: gains {eur(totals.gainsEur - report.kap.gainsEur)} · losses {eur(totals.lossesEur - report.kap.lossesEur)}
          </p>
        )}
        <p>Add any other foreign capital income you have to the same lines.</p>
        {!report.kap.linesVerified && <p className="text-warn">Line numbers not yet checked against the official {report.taxYear} form.</p>}
      </div>
    </div>
  );
}

export function SoCard({ taxYear, reasons, so, error }: { taxYear: number; reasons: string[]; so?: SoReportDto | null; error?: string }) {
  return (
    <div className={`${card} ${reasons.length ? "" : "opacity-70"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Anlage SO {taxYear}</h2>
        <span className="text-xs text-muted">Spot · spot legs · § 23 EStG</span>
      </div>
      {!reasons.length ? (
        <p className="mt-4 text-sm text-muted">Not needed for what you selected.</p>
      ) : error ? (
        <p className="mt-4 text-sm text-bad">Spot history could not be read: {error}</p>
      ) : !so ? (
        <p className="mt-4 text-sm text-muted">Generate the report again to include spot trades.</p>
      ) : !so.lines.length ? (
        <p className="mt-4 text-sm">No taxable disposals in {taxYear}.</p>
      ) : (
        <>
          <dl className="mt-4 grid gap-2">
            {so.lines
              .filter((l) => /€$/.test(l.value))
              .map((l) => (
                <div key={l.line} className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm">
                    Zeile {l.line}
                    <span className="block text-xs text-muted">{l.label}</span>
                  </dt>
                  <dd className={`font-mono tabular-nums ${l.label === "Gewinn / Verlust" ? "text-xl" : "text-sm"}`}>{l.value}</dd>
                </div>
              ))}
          </dl>
          <div className="mt-4 grid gap-1 text-xs text-muted">
            <p>
              Zeile {so.lines[0].line}: enter 1 · Zeile {so.lines[1].line}: &ldquo;{so.lines[1].value}&rdquo;
            </p>
            {so.taxFreeGainEur !== 0 && <p>Tax-free after one year of holding: {eur(so.taxFreeGainEur)} (not in the lines above)</p>}
            {so.belowFreigrenze && <p className="text-good">Below the 1.000 € Freigrenze: tax-free if all your private disposals stay below it.</p>}
            {reasons.length > 0 && <p>Needed for {reasons.join(" and ")}. Spot losses only offset spot gains.</p>}
            {!so.linesVerified && <p className="text-warn">Line numbers not yet checked against the official {taxYear} form.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function FundingCard({ report, arbitrage }: { report: ReportDto; arbitrage: boolean }) {
  const separate = report.fundingMode === "separate";
  const net = report.fundingSeparate.receivedEur - report.fundingSeparate.paidEur;
  return (
    <div className={`${card} ${arbitrage && separate ? "border-warn/60" : ""}`}>
      <h2 className="text-sm font-medium">Funding fees</h2>
      {separate ? (
        <>
          <p className="mt-3 text-sm">
            Received <span className="font-mono">{eur(report.fundingSeparate.receivedEur)}</span> · paid{" "}
            <span className="font-mono">{eur(report.fundingSeparate.paidEur)}</span> · net <span className="font-mono">{eur(net)}</span>
          </p>
          <p className="mt-1 text-xs text-muted">Listed separately, not in the KAP lines. There is no official guidance yet: ask your tax advisor.</p>
          {arbitrage && (
            <p className="mt-2 text-xs text-warn">
              Funding is the income of a funding-rate trade. With &ldquo;List separately&rdquo; it is not in the KAP numbers above.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm">
          Included in the KAP result ({report.fundingPayments} periodic payments plus borrow fees charged on fills).
        </p>
      )}
    </div>
  );
}
