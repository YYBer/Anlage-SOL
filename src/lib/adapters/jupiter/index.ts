import { BorshEventCoder, utils, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { isPublicRpc, limitedCall, mapLimited, rpcLimiter } from "../../core/limiter";
import { cachedTransaction, getTransactionCached } from "../../core/tx-cache";
import type { Adapter, Fill, Side, WalletHistory } from "../../core/types";
import idl from "./idl.json";

// Jupiter Perps has no history API, so we read the program's Anchor CPI events.
// Opens (increasePosition4) and liquidations do not list the owner wallet in their
// accounts, so we query by Position PDA instead, which every execution touches.

export const PROGRAM_ID = new PublicKey("PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu");
const POOL = new PublicKey("5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq");
const CUSTODY = {
  SOL: "7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz",
  ETH: "AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn",
  BTC: "5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm",
  USDC: "G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa",
  USDT: "4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk",
} as const;

const coder = new BorshEventCoder(idl as Idl);
const USD = 1e6;
const num = (x: unknown) => (x == null ? 0 : Number((x as { toString(): string }).toString()) / USD);

export interface PositionSlot {
  market: "SOL" | "ETH" | "BTC";
  side: Side;
  collateral: string;
  pda: PublicKey;
}

/** Longs are collateralized in the asset itself, shorts in USDC or USDT: 9 slots per wallet. */
export function positionSlots(wallet: string): PositionSlot[] {
  const owner = new PublicKey(wallet);
  const slots: Omit<PositionSlot, "pda">[] = [];
  for (const market of ["SOL", "ETH", "BTC"] as const) {
    slots.push({ market, side: "long", collateral: market });
    for (const stable of ["USDC", "USDT"] as const) slots.push({ market, side: "short", collateral: stable });
  }
  return slots.map((s) => ({
    ...s,
    pda: PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        owner.toBuffer(),
        POOL.toBuffer(),
        new PublicKey(CUSTODY[s.market]).toBuffer(),
        new PublicKey(CUSTODY[s.collateral as keyof typeof CUSTODY]).toBuffer(),
        Buffer.from([s.side === "long" ? 1 : 2]),
      ],
      PROGRAM_ID,
    )[0],
  }));
}

export interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Decodes Anchor `emit_cpi!` events: inner instructions from the program to itself. */
export function decodeEvents(tx: VersionedTransactionResponse): DecodedEvent[] {
  const meta = tx.meta;
  if (!meta?.innerInstructions) return [];
  const keys = [...tx.transaction.message.staticAccountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])].map((k) =>
    k.toBase58(),
  );
  const out: DecodedEvent[] = [];
  for (const group of meta.innerInstructions) {
    for (const ix of group.instructions) {
      if (keys[ix.programIdIndex] !== PROGRAM_ID.toBase58()) continue;
      const data = utils.bytes.bs58.decode(ix.data);
      if (data.length < 16) continue;
      try {
        // First 8 bytes are the emit_cpi instruction tag; the event discriminator follows.
        const ev = coder.decode(utils.bytes.base64.encode(Buffer.from(data.subarray(8))));
        if (ev) out.push(ev as DecodedEvent);
      } catch {
        // Not an event, or an event from a newer IDL version.
      }
    }
  }
  return out;
}

/**
 * Maps a position event to a Fill.
 * Verified against mainnet: feeUsd = positionFeeUsd + fundingFeeUsd, pnlDelta is gross
 * of fees, and priceImpactFeeUsd is already in the execution price (not charged again).
 */
export function eventToFill(ev: DecodedEvent, slot: PositionSlot, time: Date, signature: string): Fill | null {
  const d = ev.data;
  const increase = /IncreasePositionEvent$/.test(ev.name);
  const decrease = /DecreasePositionEvent$/.test(ev.name);
  const liquidation = ev.name === "LiquidateFullPositionEvent";
  if (!increase && !decrease && !liquidation) return null;

  const pnl = increase ? 0 : (d.hasProfit ? 1 : -1) * num(d.pnlDelta);
  return {
    protocol: "jupiter",
    positionKey: `jupiter:${slot.pda.toBase58()}`,
    market: slot.market,
    side: slot.side,
    time,
    // Liquidations close the whole position and carry no sizeUsdDelta.
    sizeUsdDelta: liquidation ? num(d.positionSizeUsd) : num(d.sizeUsdDelta),
    sizeUsdAfter: liquidation ? 0 : num(d.positionSizeUsd),
    price: num(d.price),
    kind: increase ? "increase" : liquidation ? "liquidation" : "decrease",
    realizedPnlUsd: pnl,
    feeUsd: num(d.positionFeeUsd) + (liquidation ? num(d.liquidationFeeUsd) : 0),
    fundingUsd: num(d.fundingFeeUsd),
    signature,
    raw: { event: ev.name, collateral: slot.collateral },
  };
}

export interface JupiterOptions {
  rpcUrl?: string;
  /** Upper bound on signatures fetched per position slot. */
  maxSignaturesPerSlot?: number;
}

export function createJupiterAdapter(opts: JupiterOptions = {}): Adapter {
  const rpcUrl = opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const maxSigs = opts.maxSignaturesPerSlot ?? 5000;
  const limiter = rpcLimiter(rpcUrl);

  return {
    protocol: "jupiter",
    async fetchHistory(wallet, fetchOpts = {}): Promise<WalletHistory> {
      const report = fetchOpts.onProgress ?? (() => {});
      const warnings: string[] = [];
      const failures: string[] = [];
      const fills: Fill[] = [];

      // 1. Signatures of all 9 position slots, then 2. every transaction in one paced batch.
      const work: { slot: PositionSlot; signature: string }[] = [];
      report({ source: "jupiter", message: "Listing position transactions" });
      for (const slot of positionSlots(wallet)) {
        const sigs: string[] = [];
        let before: string | undefined;
        let capped = false;
        while (true) {
          const limit = Math.min(1000, maxSigs - sigs.length);
          const page = await limitedCall(limiter, () => conn.getSignaturesForAddress(slot.pda, { before, limit }));
          sigs.push(...page.filter((s) => !s.err).map((s) => s.signature));
          if (page.length < limit) break;
          if (sigs.length >= maxSigs) {
            capped = true;
            break;
          }
          before = page.at(-1)!.signature;
        }
        if (capped) {
          warnings.push(`Jupiter ${slot.market}-${slot.side} (${slot.collateral}): capped at ${maxSigs} signatures; older history skipped.`);
        }

        work.push(...sigs.map((signature) => ({ slot, signature })));
      }

      const missing = work.filter((w) => !cachedTransaction(w.signature));
      const total = missing.length;
      const label = `Reading ${total} new of ${work.length} transactions${isPublicRpc(rpcUrl) && total ? " (public RPC: ~1 per second)" : ""}`;
      report({ source: "jupiter", message: label, done: 0, total, etaSeconds: Math.round(total / limiter.rate()) });
      await mapLimited(
        missing,
        limiter,
        ({ signature }) => getTransactionCached(conn, signature),
        (done) => {
          if (done === total || done % Math.max(1, Math.floor(total / 40)) === 0)
            report({ source: "jupiter", message: label, done, total, etaSeconds: Math.round((total - done) / limiter.rate()) });
        },
        (_work, message) => failures.push(message),
      );
      const txs = work.map((w) => cachedTransaction(w.signature) ?? null);
      const unreadable = txs.filter((tx) => !tx).length;
      if (unreadable) {
        warnings.push(
          `Jupiter: ${unreadable} Transaktion(en) konnten nicht gelesen werden und fehlen in der Berechnung (z. B. "${failures[0] ?? "unbekannt"}").`,
        );
      }
      txs.forEach((tx, i) => {
        if (!tx?.blockTime) return;
        const { slot, signature } = work[i];
        for (const ev of decodeEvents(tx)) {
          const key = ev.data.positionKey as PublicKey | undefined;
          if (!key?.equals?.(slot.pda)) continue;
          const fill = eventToFill(ev, slot, new Date(tx.blockTime * 1000), signature);
          if (fill) fills.push(fill);
        }
      });
      report({ source: "jupiter", message: `${fills.length} fills`, done: total, total, finished: true });

      fills.sort((a, b) => a.time.getTime() - b.time.getTime());
      // Collateral for longs is SOL/ETH/BTC and swaps happen inside Jupiter; tracked separately later.
      return { wallet, fills, funding: [], collateral: [], warnings };
    },
  };
}
