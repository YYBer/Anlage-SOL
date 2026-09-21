"use client";

import { useState } from "react";
import type { ReportDto } from "@/lib/dto";
import { parseEur } from "@/lib/format";
import { combineKap } from "@/lib/tax/kap";
import { FundingCard, KapCard, SoCard } from "./_components/FormCards";
import { button, card, input } from "./_components/format";
import { loadOthers, OtherPlatforms, saveOthers, type OtherRow } from "./_components/OtherPlatforms";
import { HedgedMarkets, PositionsTable } from "./_components/Positions";
import { SpotDisposals } from "./_components/Spot";
import { TradeTypePicker } from "./_components/TradeTypePicker";
import { expectsOtherPlatforms, hasArbitrage, needsPerps, needsSpot, spotReasons, type TradeSelection } from "./trade-types";
import { berlinYear } from "@/lib/core/time";

// Found on mainnet: a Phoenix perp trader and a Jupiter swap (memecoin) trader.
const SAMPLE_WALLET = "wTfZZqcs9YLcfNN6wtLyWnKpDDWJGyz5G9A6tZpfgMw";
const SAMPLE_SPOT_WALLET = "3gg6BxZxR8G2jrQvJAU9b7YpZ1fNYE6o8fbufcnxQB1D";
const THIS_YEAR = berlinYear(new Date());
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];
const PROTOCOLS = [
  ["phoenix", "Phoenix"],
  ["jupiter", "Jupiter Perps"],
] as const;

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] text-accent-fg">{n}</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function Home() {
  const [selection, setSelection] = useState<TradeSelection>({ types: ["perps"], arbKinds: [] });
  const [wallet, setWallet] = useState("");
  const [year, setYear] = useState(THIS_YEAR);
  const [protocols, setProtocols] = useState<string[]>(["phoenix"]);
  const [fundingMode, setFundingMode] = useState<"separate" | "include">("separate");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [others, setOthers] = useState<OtherRow[]>([]);

  const perps = needsPerps(selection);
  const spot = needsSpot(selection);
  const arbitrage = hasArbitrage(selection);
  const crossExchange = expectsOtherPlatforms(selection);

  function updateOthers(rows: OtherRow[]) {
    setOthers(rows);
    if (report) saveOthers(report.wallet, report.taxYear, rows);
  }

  const otherSources = others.map((o) => ({ label: o.label, gainsEur: parseEur(o.gains), lossesEur: parseEur(o.losses) }));
  const totals = report ? combineKap(report.kap, otherSources) : null;
  const othersIncluded = otherSources.some((o) => o.gainsEur || o.lossesEur);

  const toggleProtocol = (p: string) => setProtocols((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, year, protocols: perps ? protocols : [], fundingMode, spot }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setReport(body);
      // Other-platform amounts belong to a wallet and tax year; restore what was entered last time,
      // or offer an empty row when the user told us a leg lives elsewhere.
      const saved = loadOthers(body.wallet, body.taxYear);
      setOthers(saved.length || !crossExchange ? saved : [{ label: "", gains: "", losses: "" }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = (perps || spot) && wallet.trim() && (!perps || protocols.length) && (!arbitrage || selection.arbKinds.length);
  const prefix = report ? `perpelster-${report.wallet.slice(0, 8)}-${report.taxYear}` : "";

  async function downloadReceipt() {
    if (!report || !totals) return;
    // jsPDF is only needed here, so it stays out of the initial bundle.
    const { buildReceipt } = await import("@/lib/export/pdf");
    buildReceipt({ report, totals, others: otherSources, so: report.so }).save(`${prefix}-nachweis.pdf`);
  }
  const soReasons = spotReasons(selection);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Perpelster</h1>
        <p className="mt-1 text-sm text-muted">
          Tell us how you trade on Solana; we tell you which lines to fill in ELSTER, with an on-chain receipt for every fill.
        </p>
      </header>

      <form onSubmit={submit} className={`${card} grid gap-8`}>
        <Step n={1} title="What did you trade?">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Tax year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={`${input} py-1.5`}>
              {YEARS.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
          <TradeTypePicker value={selection} onChange={setSelection} />
          {arbitrage && !selection.arbKinds.length && <p className="text-sm text-warn">Pick at least one kind of arbitrage.</p>}
        </Step>

        {(perps || spot) && (
          <Step n={2} title={perps ? "Which wallet and platforms?" : "Which wallet?"}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Solana wallet address"
                aria-label="Wallet address"
                spellCheck={false}
                className={`${input} min-w-0 flex-1 font-mono`}
              />
              <button type="button" onClick={() => setWallet(perps ? SAMPLE_WALLET : SAMPLE_SPOT_WALLET)} className={button}>
                Use sample wallet
              </button>
            </div>
            {perps && (
              <div className="flex flex-wrap gap-4 text-sm">
                {PROTOCOLS.map(([id, label]) => (
                  <label key={id} className="flex items-center gap-2">
                    <input type="checkbox" checked={protocols.includes(id)} onChange={() => toggleProtocol(id)} />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {spot && (
              <p className="text-xs text-muted">
                Spot reads the wallet&apos;s whole history, since FIFO needs purchases from earlier years. This can take several minutes without a dedicated
                RPC.
              </p>
            )}
            {crossExchange && (
              <p className="text-xs text-muted">
                Both legs on Phoenix and Jupiter? Tick both. A leg on another platform can be entered after the report is ready.
              </p>
            )}
            {perps && protocols.includes("jupiter") && (
              <p className="text-xs text-muted">Jupiter history is decoded from on-chain events and can take several minutes without a dedicated RPC.</p>
            )}
          </Step>
        )}

        {perps && (
          <Step n={3} title="How should funding fees count?">
            <div className="grid gap-2 text-sm">
              <label className="flex items-start gap-2">
                <input className="mt-1" type="radio" checked={fundingMode === "separate"} onChange={() => setFundingMode("separate")} />
                <span>
                  List separately
                  <span className="block text-xs text-muted">Kept out of the KAP lines for you or your tax advisor to decide.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input className="mt-1" type="radio" checked={fundingMode === "include"} onChange={() => setFundingMode("include")} />
                <span>
                  Include in result
                  <span className="block text-xs text-muted">Received funding counts as gain, paid funding and borrow fees as loss.</span>
                </span>
              </label>
            </div>
            {arbitrage && (
              <p className="text-xs text-warn">
                For funding-rate trades, funding is the main income. There is no official guidance on how to treat it; &ldquo;List separately&rdquo; leaves it
                out of the KAP numbers.
              </p>
            )}
          </Step>
        )}

        {(perps || spot) && (
          <div>
            <button disabled={loading || !canSubmit} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50">
              {loading ? "Reading trade history…" : "Generate report"}
            </button>
          </div>
        )}
      </form>

      {error && <p className="mt-6 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {report && totals && (
        <div className="mt-10 grid gap-10">
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">What to enter</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <KapCard report={report} totals={totals} othersIncluded={othersIncluded} />
              <SoCard taxYear={report.taxYear} reasons={soReasons} so={report.so} error={report.soError} />
            </div>
            {perps && <OtherPlatforms rows={others} onChange={updateOthers} crossExchange={crossExchange} />}
          </section>

          {arbitrage && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">Funding-rate arbitrage</h2>
              <p className="text-sm text-muted">
                The tax office doesn&apos;t see a strategy, only its legs. Each perp leg is its own Termingeschäft in Anlage KAP
                {selection.arbKinds.includes("cashAndCarry") ? "; each spot leg is a private disposal in Anlage SO, and the two can't offset each other" : ""}.
              </p>
              <FundingCard report={report} arbitrage />
              {selection.arbKinds.includes("crossExchange") && (
                <div className="grid gap-2">
                  <h3 className="text-sm font-medium text-muted">Hedged markets found on-chain</h3>
                  <HedgedMarkets report={report} />
                </div>
              )}
              {selection.arbKinds.includes("cashAndCarry") && (
                <p className="text-sm text-muted">Spot + perp: the perp legs are in Anlage KAP, the spot legs in Anlage SO (see spot disposals below).</p>
              )}
            </section>
          )}

          {perps && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">{arbitrage && !selection.types.includes("perps") ? "Perp legs" : "Perpetual futures"}</h2>
              {!arbitrage && <FundingCard report={report} arbitrage={false} />}
              <PositionsTable report={report} />
            </section>
          )}

          {spot && report.so && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">{selection.types.includes("spot") ? "Spot disposals" : "Spot legs"}</h2>
              <SpotDisposals so={report.so} />
            </section>
          )}

          <section className="grid gap-3">
            <h2 className="text-lg font-semibold">Downloads</h2>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadReceipt} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg">
                Receipt PDF (for the Finanzamt)
              </button>
              <button onClick={() => download(`${prefix}-positions.csv`, report.csv.positions)} className={button}>
                Positions CSV
              </button>
              <button onClick={() => download(`${prefix}-ledger.csv`, report.csv.ledger)} className={button}>
                Ledger with signatures CSV
              </button>
              <button onClick={() => download(`${prefix}-koinly.csv`, report.csv.koinly)} className={button}>
                Koinly CSV
              </button>
            </div>
          </section>

          <section className="grid gap-2 text-xs text-muted">
            {report.notes.map((n) => (
              <p key={n}>⚠ {n}</p>
            ))}
            <p>FX: {report.fxSource}</p>
            <p>This is a calculation aid, not tax advice.</p>
          </section>
        </div>
      )}
    </main>
  );
}
