import type { Adapter, Fill, FundingPayment, Side, WalletHistory } from "../core/types";

// Pacifica matches off-chain, so its fills have no transaction signature: rows from here are backed by
// the platform's API instead of an on-chain receipt, and the report says so.
// Verified against two mainnet accounts on 2026-10-04:
// - `pnl` is net of `fee` ((price − entry_price) × amount − fee to the cent), so the gross PnL our
//   Fill model wants is `pnl + fee`. On opens, `pnl` is just −`fee`.
// - funding `payout` is signed: positive = received, negative = paid; `side` is ask (short) / bid (long).
// - `limit` above 50 answers 429, and `start_time` / `end_time` span at most 30 days. Plain cursor
//   paging has no such limit, so history is read newest → oldest by cursor.
// - history reaches back to the account's first trade (seen: 2025-09-24), not a rolling window.

const API = "https://api.pacifica.fi/api/v1";
const PAGE = 50;
const MAX_PAGES = 400;
const PAGE_DELAY_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TradeItem {
  history_id: number;
  symbol: string;
  amount: string;
  price: string;
  entry_price: string;
  fee: string;
  pnl: string;
  /** open_long | close_long | open_short | close_short */
  side: string;
  event_type: string;
  cause: string;
  created_at: number;
}

interface FundingItem {
  history_id: number;
  symbol: string;
  /** ask = short, bid = long. */
  side: string;
  amount: string;
  payout: string;
  rate: string;
  created_at: number;
}

interface Page<T> {
  success: boolean;
  data: T[] | null;
  has_more?: boolean;
  next_cursor?: string | null;
  error?: string;
}

async function getPage<T>(path: string, account: string, cursor?: string): Promise<Page<T>> {
  const url = `${API}/${path}?account=${account}&limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return (await res.json()) as Page<T>;
    // The rate limit is tight (429 already at limit=100); back off and keep the history complete.
    if (res.status === 429 || res.status >= 500) {
      await sleep(Math.min(1000 * 2 ** attempt, 20_000));
      continue;
    }
    throw new Error(`Pacifica API ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error(`Pacifica API kept rate limiting ${path}`);
}

/** Follows `next_cursor` from newest to oldest until the account's history is exhausted. */
async function paginate<T>(path: string, account: string, warnings: string[], onPage?: (count: number) => void): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await getPage<T>(path, account, cursor);
    if (body.error) throw new Error(`Pacifica API: ${body.error}`);
    out.push(...(body.data ?? []));
    onPage?.(out.length);
    if (!body.has_more || !body.next_cursor) return out;
    cursor = body.next_cursor;
    await sleep(PAGE_DELAY_MS);
  }
  warnings.push(`Pacifica: stopped after ${MAX_PAGES} pages of ${path}; history may be incomplete.`);
  return out;
}

const sideOf = (s: string): Side => (s.endsWith("short") ? "short" : "long");

/** Pacifica's smallest lot is 0.0001 (ETH) and amounts carry at most 6 decimals. */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Trades come newest first and carry no position size, so the running size per market and side is
 * rebuilt from the oldest trade onwards.
 */
export function tradesToFills(trades: TradeItem[], warnings: string[] = []): Fill[] {
  const oldestFirst = [...trades].sort((a, b) => a.created_at - b.created_at || a.history_id - b.history_id);
  const open = new Map<string, number>();
  const unknownCauses = new Set<string>();

  const fills = oldestFirst.map((t) => {
    const side = sideOf(t.side);
    const closing = t.side.startsWith("close");
    const amount = Math.abs(Number(t.amount));
    const price = Number(t.price);
    const fee = Number(t.fee);
    const positionKey = `pacifica:${t.symbol}:${side}`;

    const before = open.get(positionKey) ?? 0;
    // A close larger than what we have means the opening lies before the fetched history.
    // Rounding below the smallest lot size keeps thousands of additions from leaving float dust,
    // which would otherwise read as a position that never closes.
    const after = round6(closing ? Math.max(before - amount, 0) : before + amount);
    open.set(positionKey, after);

    const liquidation = /liquidat|adl/i.test(t.cause);
    if (closing && t.cause !== "normal" && !liquidation) unknownCauses.add(t.cause);

    return {
      protocol: "pacifica",
      positionKey,
      market: t.symbol,
      side,
      time: new Date(t.created_at),
      sizeUsdDelta: amount * price,
      sizeUsdAfter: after * price,
      baseDelta: amount,
      baseAfter: after,
      price,
      kind: closing ? (liquidation ? "liquidation" : "decrease") : "increase",
      // `pnl` is already net of the fee; the tax model wants the gross result and the fee separately.
      realizedPnlUsd: closing ? Number(t.pnl) + fee : 0,
      feeUsd: fee,
      fundingUsd: 0,
      raw: t,
    } satisfies Fill;
  });

  if (unknownCauses.size) {
    warnings.push(`Pacifica: unbekannte Ursache bei Glattstellungen (${[...unknownCauses].join(", ")}); als normale Schließung behandelt.`);
  }
  return fills;
}

export function fundingToPayments(funding: FundingItem[]): FundingPayment[] {
  return funding.map((f) => ({
    protocol: "pacifica" as const,
    market: f.symbol,
    side: (f.side === "ask" ? "short" : "long") as Side,
    time: new Date(f.created_at),
    // Positive payout = received, negative = paid, which is this field's convention too.
    amountUsd: Number(f.payout),
  }));
}

export const pacifica: Adapter = {
  protocol: "pacifica",
  async fetchHistory(wallet, opts = {}): Promise<WalletHistory> {
    const warnings: string[] = [];
    const report = opts.onProgress ?? (() => {});

    // Sequential: the two endpoints share one tight rate limit.
    const trades = await paginate<TradeItem>("trades/history", wallet, warnings, (n) => report({ source: "pacifica", message: `${n} trades` }));
    const funding = await paginate<FundingItem>("funding/history", wallet, warnings, (n) =>
      report({ source: "pacifica", message: `${trades.length} trades · ${n} funding payments` }),
    );
    report({ source: "pacifica", message: `${trades.length} trades · ${funding.length} funding payments`, finished: true });

    if (trades.length || funding.length) {
      warnings.push("Pacifica rechnet außerhalb der Blockchain ab: Die Ausführungen tragen keine Transaktionssignatur und sind über die Pacifica-API belegt, nicht on-chain.");
    }

    return { wallet, fills: tradesToFills(trades, warnings), funding: fundingToPayments(funding), collateral: [], warnings };
  },
};
