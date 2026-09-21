import { createJupiterAdapter, type JupiterOptions } from "./adapters/jupiter";
import { phoenix } from "./adapters/phoenix";
import type { OnProgress } from "./core/progress";
import type { Adapter, Protocol, WalletHistory } from "./core/types";
import { fetchSpotHistory, type SpotFetchOptions } from "./spot/history";
import { loadPriceBook } from "./spot/prices";
import { loadEcbFx, type FxTable } from "./tax/fx";
import { buildSoReport } from "./tax/germany-so";
import type { SoReportDto } from "./tax/so-dto";
import { buildGermanyReport, type FundingMode, type GermanyReport } from "./tax/germany";
import { taxYearEnd, taxYearStart } from "./core/time";

export interface FetchOptions {
  jupiter?: JupiterOptions;
  spot?: SpotFetchOptions;
  onProgress?: OnProgress;
}

export function adapterFor(protocol: Protocol, opts: FetchOptions = {}): Adapter {
  return protocol === "phoenix" ? phoenix : createJupiterAdapter(opts.jupiter);
}

/** Fetches every protocol and merges into one history; one failing protocol becomes a warning. */
export async function fetchWallet(wallet: string, protocols: Protocol[], opts: FetchOptions = {}): Promise<WalletHistory> {
  const results = await Promise.allSettled(protocols.map((p) => adapterFor(p, opts).fetchHistory(wallet, { onProgress: opts.onProgress })));
  const merged: WalletHistory = { wallet, fills: [], funding: [], collateral: [], warnings: [] };
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      merged.warnings.push(`${protocols[i]}: Abruf fehlgeschlagen (${(r.reason as Error).message})`);
      return;
    }
    merged.fills.push(...r.value.fills);
    merged.funding.push(...r.value.funding);
    merged.collateral.push(...r.value.collateral);
    merged.warnings.push(...r.value.warnings);
  });
  merged.fills.sort((a, b) => a.time.getTime() - b.time.getTime());
  return merged;
}

export async function germanyReport(
  wallet: string,
  taxYear: number,
  protocols: Protocol[],
  fundingMode: FundingMode,
  opts: FetchOptions = {},
): Promise<{ history: WalletHistory; fx: FxTable; report: GermanyReport }> {
  const history = await fetchWallet(wallet, protocols, opts);
  const times = [...history.fills.map((f) => f.time), ...history.funding.map((f) => f.time)];
  const from = new Date(Math.min(taxYearStart(taxYear).getTime(), ...times.map((t) => t.getTime())));
  const to = new Date(Math.min(taxYearEnd(taxYear).getTime(), Date.now()));
  const fx = await loadEcbFx(from, to);
  return { history, fx, report: buildGermanyReport(history, fx, taxYear, fundingMode) };
}

/** Anlage SO: reads the wallet's full transaction history (FIFO needs purchases from earlier years). */
export async function germanySoReport(wallet: string, taxYear: number, opts: SpotFetchOptions = {}): Promise<SoReportDto> {
  const spot = await fetchSpotHistory(wallet, opts);
  const yearEnd = new Date(Math.min(taxYearEnd(taxYear).getTime(), Date.now()));
  const first = spot.movements[0]?.time ?? taxYearStart(taxYear);
  const warnings = [...spot.warnings];
  const fx = await loadEcbFx(first, yearEnd);
  const mints = spot.movements.flatMap((m) => [...m.deltas.keys()]);
  opts.onProgress?.({ source: "prices", message: "Loading token prices" });
  const prices = await loadPriceBook(mints, first, yearEnd, fx, warnings);
  opts.onProgress?.({ source: "prices", message: "Token prices loaded", finished: true });
  return buildSoReport(spot.movements, prices, taxYear, warnings);
}
