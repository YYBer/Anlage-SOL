"use client";

import { useMemo, useRef, useState } from "react";
import type { Progress } from "@/lib/core/progress";
import type { ReportDto, ReportStreamLine } from "@/lib/dto";
import { parseEur } from "@/lib/format";
import { buildSoReport } from "@/lib/tax/germany-so";
import { combineKap } from "@/lib/tax/kap";
import { FundingCard, KapCard, SoCard } from "./_components/FormCards";
import { button, card, input } from "./_components/format";
import { loadOthers, OtherPlatforms, saveOthers, type OtherRow } from "./_components/OtherPlatforms";
import { ProgressPanel } from "./_components/ProgressBar";
import { HedgedMarkets, PositionsTable } from "./_components/Positions";
import { SpotDisposals } from "./_components/Spot";
import { loadOverrides, saveOverrides, toOverrides, TransfersIn, type OverrideInput } from "./_components/TransfersIn";
import { findHedgedMarkets } from "./_components/Positions";
import { berlinYear } from "@/lib/core/time";

// Found on mainnet, one per venue, so every example is one click away. `slow` warns before the wait.
const SAMPLES = [
  { label: "Phoenix perps", wallet: "HwqTFnTKL2JybxCPL6BCyFpoLtThZKHymFcyj3SAPKK2", hint: "311 perp fills and 107 funding payments" },
  { label: "Spot swaps", wallet: "4vy8sofeZxjkoFxSXCN4f2jw5sVeRLWXxRBMpmn1Vqwd", hint: "a small spot trader, ~50 transactions" },
  { label: "Jupiter Perps", wallet: "YzrEWGRqsgsQrENqjom3YaWA3xjZxDguAzYDfwWhLz7", hint: "very active; minutes on a public RPC", slow: true },
  { label: "Pacifica", wallet: "DxPKAPbkiTVdxx9wLvxPJf2Qgqa5Su24rBXYxgF4xhJb", hint: "181 fills and 2.002 funding payments; about 2 minutes", slow: true },
] as const;
const THIS_YEAR = berlinYear(new Date());
const YEARS = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Reads the NDJSON stream from /api/report: progress lines, an optional partial report (perps done,
 * spot still loading), then one result or error line.
 */
async function readReportStream(body: ReadableStream<Uint8Array>, onProgress: (p: Progress) => void, onPartial: (r: ReportDto) => void): Promise<ReportDto> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const line = JSON.parse(raw) as ReportStreamLine;
      if (line.type === "progress") onProgress(line.progress);
      else if (line.type === "partial") onPartial(line.report);
      else if (line.type === "error") throw new Error(line.error);
      else return line.report;
    }
  }
  throw new Error("The report stream ended without a result");
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
  const [wallet, setWallet] = useState("");
  const [year, setYear] = useState(THIS_YEAR);
  const [fundingMode, setFundingMode] = useState<"separate" | "include">("separate");
  const [loading, setLoading] = useState(false);
  /** The report on screen belongs to an earlier query; dim it until the new one arrives. */
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [others, setOthers] = useState<OtherRow[]>([]);
  const [overrideValues, setOverrideValues] = useState<Record<string, OverrideInput>>({});
  const [steps, setSteps] = useState<Progress[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function updateOthers(rows: OtherRow[]) {
    setOthers(rows);
    if (report) saveOthers(report.wallet, report.taxYear, rows);
  }

  function updateOverrides(values: Record<string, OverrideInput>) {
    setOverrideValues(values);
    if (report) saveOverrides(report.wallet, values);
  }

  // Anlage SO with the user's purchase prices for transferred tokens, recomputed in the browser.
  const so = useMemo(() => {
    const base = report?.so;
    if (!base) return base;
    const overrides = toOverrides(overrideValues);
    return Object.keys(overrides).length ? buildSoReport(base.movements, base.taxYear, base.fetchWarnings, overrides) : base;
  }, [report, overrideValues]);

  const otherSources = others.map((o) => ({ label: o.label, gainsEur: parseEur(o.gains), lossesEur: parseEur(o.losses) }));
  const totals = report ? combineKap(report.kap, otherSources) : null;
  const othersIncluded = otherSources.some((o) => o.gainsEur || o.lossesEur);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStale(true);
    setError(null);
    setSteps([]);
    // The previous report stays on screen (dimmed) so the page doesn't collapse and jump while loading.
    const started = Date.now();
    setElapsed(0);
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const show = (r: ReportDto) => {
      setReport(r);
      setStale(false);
      // Other-platform amounts belong to a wallet and tax year; restore what was entered last time.
      setOthers(loadOthers(r.wallet, r.taxYear));
      setOverrideValues(loadOverrides(r.wallet));
    };
    try {
      // Everything is read: all perp venues and spot. Nothing to choose, so nothing can be forgotten.
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, year, fundingMode }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = await readReportStream(res.body, (p) => setSteps((cur) => [...cur.filter((x) => x.source !== p.source), p]), show);
      setReport(result);
      setStale(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setLoading(false);
    }
  }

  const prefix = report ? `anlage-sol-${report.wallet.slice(0, 8)}-${report.taxYear}` : "";

  async function downloadReceipt() {
    if (!report || !totals) return;
    // jsPDF is only needed here, so it stays out of the initial bundle.
    const { buildReceipt } = await import("@/lib/export/pdf");
    buildReceipt({ report, totals, others: otherSources, so }).save(`${prefix}-nachweis.pdf`);
  }

  // What the wallet actually did decides what the page shows.
  const fillsBy = (protocol: string) => report?.fills.filter((f) => f.protocol === protocol).length ?? 0;
  const hasPerps = !!report && (report.positions.length > 0 || report.fundingPayments > 0);
  const hedged = report ? findHedgedMarkets(report) : [];
  const venues = so ? [...new Set(so.disposals.map((d) => d.venue.replace(" (via bot)", "")))] : [];

  return (
    <main className={`mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 ${loading ? "pb-48" : ""}`}>
      <header className="mb-8">
        <p className="text-sm font-medium text-muted">Anlage SOL</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your Solana trades, ready for ELSTER.</h1>
        <p className="mt-1 text-sm text-muted">Perps and spot swaps turned into German tax reports — no spreadsheets, no manual tagging.</p>
      </header>

      <form onSubmit={submit} className={`${card} grid gap-8`}>
        <Step n={1} title="Which wallet?">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="Solana wallet address"
              aria-label="Wallet address"
              spellCheck={false}
              className={`${input} min-w-0 flex-1 font-mono`}
            />
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tax year" className={input}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  Tax year {y}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Try a sample:</span>
            {SAMPLES.map((s) => (
              <button
                key={s.wallet}
                type="button"
                onClick={() => setWallet(s.wallet)}
                title={`${s.wallet} — ${s.hint}`}
                className={`${button} py-1 text-xs`}
              >
                {s.label}
                {"slow" in s && s.slow ? <span className="text-muted"> · slow</span> : null}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            We read everything the wallet did: perps on Phoenix, Jupiter Perps and Pacifica, and spot swaps on Jupiter, pump.fun or through a trading bot. Perps show up
            in seconds; spot needs the wallet&apos;s whole history and can take a few minutes on the first query.
          </p>
        </Step>

        <Step n={2} title="How should funding fees count?">
          <p className="text-xs text-muted">
            Realized PnL and trading fees always go into Anlage KAP. For funding fees there is no official guidance on German tax treatment yet, so the choice
            is yours.
          </p>
          <div className="grid gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input className="mt-1" type="radio" checked={fundingMode === "separate"} onChange={() => setFundingMode("separate")} />
              <span>
                List separately <span className="text-muted">(recommended)</span>
                <span className="block text-xs text-muted">Kept out of the KAP lines for you or your tax advisor to decide.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input className="mt-1" type="radio" checked={fundingMode === "include"} onChange={() => setFundingMode("include")} />
              <span>
                Include in result
                <span className="block text-xs text-muted">
                  Received funding counts as gain, paid funding and borrow fees as loss. For funding-rate arbitrage, funding is the main income.
                </span>
              </span>
            </label>
          </div>
        </Step>

        <div>
          <button disabled={loading || !wallet.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-xs hover:bg-accent/90 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50 disabled:opacity-50">
            {loading ? "Generating…" : "Generate report"}
          </button>
        </div>
      </form>

      {error && <p className="mt-6 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {report && totals && (
        <div className={`mt-10 grid gap-10 transition-opacity ${stale ? "pointer-events-none opacity-40" : ""}`} aria-busy={loading}>
          <section className="grid gap-4">
            <div>
              <h2 className="text-lg font-semibold">What to enter</h2>
              <p className="mt-1 text-xs text-muted">
                Found in {report.taxYear}: Phoenix {fillsBy("phoenix")} trades · Jupiter Perps {fillsBy("jupiter")} trades · Pacifica {fillsBy("pacifica")} trades · spot{" "}
                {report.soPending
                  ? "still reading…"
                  : report.so
                    ? `${report.so.disposals.length} disposals${venues.length ? ` (${venues.join(", ")})` : ""}`
                    : "—"}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <KapCard report={report} totals={totals} othersIncluded={othersIncluded} />
              <SoCard taxYear={report.taxYear} so={so} pending={report.soPending} error={report.soError} />
            </div>
            <OtherPlatforms rows={others} onChange={updateOthers} />
          </section>

          {hedged.length > 0 && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">Funding-rate arbitrage</h2>
              <p className="text-sm text-muted">
                This wallet held opposite positions on Phoenix and Jupiter at the same time. The tax office doesn&apos;t see a strategy, only its legs: each
                perp leg is its own Termingeschäft in Anlage KAP, and spot legs of a spot + perp trade go to Anlage SO.
              </p>
              <HedgedMarkets report={report} />
            </section>
          )}

          {hasPerps && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">Perpetual futures</h2>
              <FundingCard report={report} arbitrage={hedged.length > 0} />
              <PositionsTable report={report} />
            </section>
          )}

          {so && (so.disposals.length > 0 || so.transfersIn.length > 0) && (
            <section className="grid gap-4">
              <h2 className="text-lg font-semibold">Spot disposals</h2>
              {so.transfersIn.length > 0 && <TransfersIn transfers={so.transfersIn} taxYear={so.taxYear} values={overrideValues} onChange={updateOverrides} />}
              <SpotDisposals so={so} />
            </section>
          )}

          <section className="grid gap-3">
            <h2 className="text-lg font-semibold">Downloads</h2>
            <div className={`${card} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
              <div>
                <p className="text-sm font-medium">Receipt for the Finanzamt</p>
                <p className="mt-1 text-xs text-muted">
                  PDF in German with the numbers above, the method, and every trade linked to its Solana transaction. Keep it with your tax return and send it
                  if the Finanzamt asks for proof.
                </p>
              </div>
              <button
                onClick={downloadReceipt}
                disabled={report.soPending}
                className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-xs hover:bg-accent/90 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/50 disabled:opacity-50"
              >
                {report.soPending ? "Waiting for spot…" : "Download PDF"}
              </button>
            </div>
            <div className="grid gap-2">
              <p className="text-xs text-muted">Only if you need them:</p>
              {[
                [
                  "Positions CSV",
                  "One row per position. For checking the numbers yourself or with a tax advisor.",
                  `${prefix}-positions.csv`,
                  report.csv.positions,
                ],
                [
                  "Ledger CSV",
                  "Every trade with its transaction signature and ECB rate. The full detail, e.g. for Excel.",
                  `${prefix}-ledger.csv`,
                  report.csv.ledger,
                ],
                ["Koinly CSV", "Only if you use Koinly: import it there as a custom CSV.", `${prefix}-koinly.csv`, report.csv.koinly],
              ].map(([label, text, file, content]) => (
                <div key={file} className="flex items-center justify-between gap-3 border-t border-line pt-2">
                  <p className="text-sm">
                    {label}
                    <span className="block text-xs text-muted">{text}</span>
                  </p>
                  <button onClick={() => download(file, content)} className={`${button} shrink-0`}>
                    Download
                  </button>
                </div>
              ))}
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
      {loading && <ProgressPanel steps={steps} elapsed={elapsed} />}
    </main>
  );
}
