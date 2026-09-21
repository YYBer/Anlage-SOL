import { TOKENS } from "./tokens";
import type { FxTable } from "../tax/fx";

// Daily EUR prices. CoinGecko's public API serves the last 365 days without a key;
// COINGECKO_API_KEY (demo or pro) extends that. Stablecoins use the ECB rate instead.

export const PRICE_SOURCE =
  "Stablecoins (USDC, USDT) = 1 USD zum EZB-Referenzkurs; übrige Token: CoinGecko-Tagesschlusskurs in EUR; ohne Kurs: Wert der Gegenseite des Tauschs";

export interface PriceBook {
  /** EUR value of `amount` of `mint` at `at`, or null when no price is known. */
  valueEur(mint: string, amount: number, at: Date): number | null;
}

const DAY = 86_400_000;

async function fetchCoinGecko(id: string, from: Date, to: Date): Promise<Map<string, number>> {
  const key = process.env.COINGECKO_API_KEY;
  const pro = process.env.COINGECKO_API_PRO === "1";
  const host = pro ? "https://pro-api.coingecko.com" : "https://api.coingecko.com";
  const url = `${host}/api/v3/coins/${id}/market_chart/range?vs_currency=eur&from=${Math.floor(from.getTime() / 1000)}&to=${Math.floor(to.getTime() / 1000)}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (key) headers[pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`CoinGecko ${res.status} for ${id}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { prices: [number, number][] };
    return new Map(body.prices.map(([t, p]) => [new Date(t).toISOString().slice(0, 10), p]));
  }
  throw new Error(`CoinGecko kept rate limiting for ${id}`);
}

/** Loads prices for every known mint that appears, clamped to what the API tier allows. */
export async function loadPriceBook(mints: string[], from: Date, to: Date, fx: FxTable, warnings: string[]): Promise<PriceBook> {
  const limitFrom = process.env.COINGECKO_API_KEY ? from : new Date(Math.max(from.getTime(), Date.now() - 364 * DAY));
  if (limitFrom > from) {
    warnings.push(`CoinGecko ohne API-Key liefert nur 365 Tage; Kurse vor ${limitFrom.toISOString().slice(0, 10)} fehlen (COINGECKO_API_KEY setzen).`);
  }
  const series = new Map<string, Map<string, number>>();
  for (const mint of new Set(mints)) {
    const id = TOKENS[mint]?.coingeckoId;
    if (!id || series.has(id)) continue;
    try {
      series.set(id, await fetchCoinGecko(id, new Date(limitFrom.getTime() - DAY), to));
    } catch (e) {
      warnings.push(`Kurs für ${TOKENS[mint].symbol} nicht verfügbar: ${(e as Error).message}`);
    }
  }

  return {
    valueEur(mint, amount, at) {
      const info = TOKENS[mint];
      if (info?.stableUsd) return fx.toEur(amount, at);
      const s = info?.coingeckoId ? series.get(info.coingeckoId) : undefined;
      if (!s) return null;
      // CoinGecko daily points are stamped 00:00 UTC; use that day, else the day before.
      const d = at.toISOString().slice(0, 10);
      const price = s.get(d) ?? s.get(new Date(at.getTime() - DAY).toISOString().slice(0, 10));
      return price === undefined ? null : amount * price;
    },
  };
}
