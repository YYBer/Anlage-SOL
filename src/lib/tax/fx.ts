import { berlinDate } from "../core/time";

// USD → EUR via the ECB euro reference rate (USD per 1 EUR, published on TARGET business days).
// USDC/USDT settlement is treated as USD at par; the report states this assumption.

export const FX_SOURCE =
  "Euro-Referenzkurs der Europäischen Zentralbank (EXR D.USD.EUR.SP00.A), Kurs des Handelstags nach deutscher Ortszeit bzw. letzter veröffentlichter Kurs davor; USDC/USDT = USD";

export interface FxTable {
  /** EUR value of a USD amount at the given time. */
  toEur(usd: number, at: Date): number;
  /** The ECB rate (USD per EUR) applied at that time, and the date it was published for. */
  rateAt(at: Date): { rate: number; date: string };
}

// The trading day is the German calendar day; the ECB table itself is keyed by date only.
const day = berlinDate;

export function fxTableFromRates(rates: Map<string, number>): FxTable {
  const dates = [...rates.keys()].sort();
  if (!dates.length) throw new Error("No FX rates available");

  function rateAt(at: Date) {
    const target = day(at);
    // Binary search for the last published date <= target (weekends/holidays use the prior rate).
    let lo = 0;
    let hi = dates.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= target) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    // Before the first rate in the table: fall back to the earliest one.
    const date = dates[Math.max(found, 0)];
    return { rate: rates.get(date)!, date };
  }

  return { rateAt, toEur: (usd, at) => usd / rateAt(at).rate };
}

export function parseEcbCsv(csv: string): Map<string, number> {
  const lines = csv.trim().split("\n");
  const header = lines[0].split(",");
  const iDate = header.indexOf("TIME_PERIOD");
  const iValue = header.indexOf("OBS_VALUE");
  const rates = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const v = Number(cols[iValue]);
    if (cols[iDate] && Number.isFinite(v) && v > 0) rates.set(cols[iDate], v);
  }
  return rates;
}

const cache = new Map<string, Promise<FxTable>>();

/** Loads ECB rates covering [from, to], starting 10 days earlier so a Monday-after-holiday still finds a rate. */
export function loadEcbFx(from: Date, to: Date): Promise<FxTable> {
  const start = day(new Date(from.getTime() - 10 * 86400_000));
  const end = day(to);
  const key = `${start}:${end}`;
  if (!cache.has(key)) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${start}&endPeriod=${end}&format=csvdata`;
    const p = fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`ECB API ${res.status}`);
        return fxTableFromRates(parseEcbCsv(await res.text()));
      })
      .catch((e) => {
        cache.delete(key);
        throw e;
      });
    cache.set(key, p);
  }
  return cache.get(key)!;
}
