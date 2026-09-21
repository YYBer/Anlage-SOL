import type { Adapter, CollateralTransfer, Fill, FundingPayment, Side, WalletHistory } from "../core/types";

const API = "https://perp-api.phoenix.trade";
const PAGE = 500;
const MAX_PAGES = 200;
const PAGE_DELAY_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TradeItem {
  traderPdaIndex: number;
  subaccountIndex: number;
  marketSymbol: string;
  signature?: string | null;
  timestamp: string;
  slot: number;
  slotIndex: number;
  eventIndex: number;
  instructionType: string;
  baseLotsBefore: string;
  baseLotsAfter: string;
  price: string;
  realizedPnl: string;
  fees: string;
  tradeType: string;
}

interface FundingItem {
  timestamp: string;
  symbol: string;
  fundingPayment: string;
  positionSide: string;
}

interface CollateralItem {
  slot: number;
  eventType: string;
  amount: number;
  timestamp: string;
  traderSubaccountIndex: number;
}

async function getJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    // Unknown wallets come back as 404 "User not found": treat as empty history.
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 20_000));
      continue;
    }
    throw new Error(`Phoenix API ${res.status} for ${url}: ${await res.text()}`);
  }
  throw new Error(`Phoenix API kept failing for ${url}`);
}

/** Follows `nextCursor` (older items) until exhausted or older than `since`. */
async function paginate<T>(
  base: string,
  pick: (body: Record<string, unknown>) => T[],
  timeOf: (item: T) => Date,
  since: Date | undefined,
  warnings: string[],
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = base.includes("?") ? "&" : "?";
    const url = `${base}${sep}limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const body = await getJson<Record<string, unknown>>(url);
    if (!body) return out;
    const items = pick(body);
    out.push(...items);
    const oldest = items.at(-1);
    if (since && oldest && timeOf(oldest) < since) return out;
    if (!body.hasMore || !body.nextCursor) return out;
    cursor = body.nextCursor as string;
    await sleep(PAGE_DELAY_MS);
  }
  warnings.push(`Phoenix: stopped after ${MAX_PAGES} pages of ${base}; history may be incomplete.`);
  return out;
}

const sideOf = (base: number): Side => (base >= 0 ? "long" : "short");

/**
 * Converts one Phoenix trade into 1–2 fills. A trade that crosses zero
 * (e.g. -0.002 → +0.005) closes the short and opens a long in one go.
 */
export function tradeToFills(t: TradeItem): Fill[] {
  const before = Number(t.baseLotsBefore);
  const after = Number(t.baseLotsAfter);
  const price = Number(t.price);
  const fees = Number(t.fees);
  const pnl = Number(t.realizedPnl);
  const time = new Date(t.timestamp);
  const account = `${t.traderPdaIndex}.${t.subaccountIndex}`;
  const liquidation = t.tradeType === "liquidation" || t.tradeType === "adl";

  const legs: { side: Side; from: number; to: number }[] = [];
  const crosses = before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after);
  if (crosses) {
    legs.push({ side: sideOf(before), from: Math.abs(before), to: 0 });
    legs.push({ side: sideOf(after), from: 0, to: Math.abs(after) });
  } else {
    const side = sideOf(before !== 0 ? before : after);
    legs.push({ side, from: Math.abs(before), to: Math.abs(after) });
  }
  const totalMoved = legs.reduce((s, l) => s + Math.abs(l.to - l.from), 0) || 1;

  return legs.map((leg) => {
    const moved = Math.abs(leg.to - leg.from);
    const decreasing = leg.to < leg.from;
    return {
      protocol: "phoenix",
      positionKey: `phoenix:${account}:${t.marketSymbol}:${leg.side}`,
      market: t.marketSymbol,
      side: leg.side,
      time,
      sizeUsdDelta: moved * price,
      sizeUsdAfter: leg.to * price,
      baseDelta: moved,
      baseAfter: leg.to,
      price,
      kind: decreasing ? (liquidation ? "liquidation" : "decrease") : "increase",
      // Phoenix only realizes PnL on the reducing leg.
      realizedPnlUsd: decreasing ? pnl : 0,
      feeUsd: fees * (moved / totalMoved),
      fundingUsd: 0,
      signature: t.signature ?? undefined,
      raw: t,
    } satisfies Fill;
  });
}

export const phoenix: Adapter = {
  protocol: "phoenix",
  async fetchHistory(wallet, opts = {}): Promise<WalletHistory> {
    const warnings: string[] = [];
    const base = `${API}/v1/trader/${wallet}`;
    const inRange = (d: Date) => (!opts.since || d >= opts.since) && (!opts.until || d < opts.until);

    // Sequential on purpose: parallel pagination of the three endpoints trips Phoenix's rate limit.
    const trades = await paginate<TradeItem>(`${base}/trades-history`, (b) => b.data as TradeItem[], (t) => new Date(t.timestamp), opts.since, warnings);
    const funding = await paginate<FundingItem>(`${base}/funding-history`, (b) => b.events as FundingItem[], (f) => new Date(f.timestamp), opts.since, warnings);
    const collateral = await paginate<CollateralItem>(`${base}/collateral-history`, (b) => b.data as CollateralItem[], (c) => new Date(c.timestamp), opts.since, warnings);

    // Position grouping needs full history even before `since`, so fills are not range-filtered here.
    const fills = trades
      .sort((a, b) => a.slot - b.slot || a.slotIndex - b.slotIndex || a.eventIndex - b.eventIndex)
      .flatMap(tradeToFills);

    const fundingPayments: FundingPayment[] = funding
      .map((f) => ({
        protocol: "phoenix" as const,
        market: f.symbol,
        side: (f.positionSide.toLowerCase() === "short" ? "short" : "long") as Side,
        time: new Date(f.timestamp),
        amountUsd: Number(f.fundingPayment),
      }))
      .filter((f) => inRange(f.time));

    // "transfer" events move collateral between subaccounts and are not taxable disposals.
    const transfers: CollateralTransfer[] = collateral
      .filter((c) => c.eventType !== "transfer")
      .map((c) => ({
        protocol: "phoenix" as const,
        time: new Date(c.timestamp),
        asset: "USDC",
        amount: c.amount / 1e6,
      }))
      .filter((c) => inRange(c.time));

    const otherTypes = new Set(collateral.map((c) => c.eventType).filter((t) => !["deposit", "withdraw", "withdrawal", "transfer"].includes(t)));
    if (otherTypes.size) warnings.push(`Phoenix: unhandled collateral event types: ${[...otherTypes].join(", ")}`);

    return { wallet, fills, funding: fundingPayments, collateral: transfers, warnings };
  },
};
