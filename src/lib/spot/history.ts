import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { isPublicRpc, limitedCall, mapLimited, rpcLimiter } from "../core/limiter";
import type { OnProgress } from "../core/progress";
import { cachedTransaction, getTransactionCached } from "../core/tx-cache";
import { SOL_MINT } from "./tokens";
import { detectVenue } from "./venues";

// Protocol-agnostic spot history: for every transaction of the wallet, the net change of each token
// the wallet owns. A transaction where some tokens go out and others come in is an exchange (Tausch),
// no matter which DEX or aggregator routed it.

/** Perp programs are handled in Anlage KAP; their collateral moves are not spot disposals. */
const PERP_PROGRAMS = new Set([
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu", // Jupiter Perps
  "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih", // Phoenix Perps
]);

/** Token accounts cost ~0.00204 SOL rent, refunded on close; net SOL moves below this are rent, not trades. */
const SOL_DUST = 0.0025;

export interface Movement {
  signature: string;
  time: Date;
  /** Net change per mint, in token units (negative = left the wallet). SOL and wSOL are merged. */
  deltas: Map<string, number>;
  /** Network fee paid by the wallet, in SOL. */
  feeSol: number;
  kind: "swap" | "in" | "out";
  /** Where the swap happened, e.g. "Jupiter" or "pump.fun (via bot)". Display only. */
  venue: string;
  /**
   * The wallet itself paid for and signed this transaction. Tokens arriving in a transaction the wallet
   * signed are almost always a purchase it paid for from somewhere we can't see (a trading bot's own
   * account, a second wallet), not an incoming transfer from someone else.
   */
  signedByWallet: boolean;
}

export interface SpotHistory {
  movements: Movement[];
  skippedPerp: number;
  warnings: string[];
}

export function movementFromTx(wallet: string, signature: string, tx: VersionedTransactionResponse): Movement | null | "perp" {
  const meta = tx.meta;
  if (!meta || meta.err || !tx.blockTime) return null;
  const keys = [
    ...tx.transaction.message.staticAccountKeys.map((k) => k.toBase58()),
    ...(meta.loadedAddresses?.writable ?? []).map((k) => k.toBase58()),
    ...(meta.loadedAddresses?.readonly ?? []).map((k) => k.toBase58()),
  ];
  if (keys.some((k) => PERP_PROGRAMS.has(k))) return "perp";

  const deltas = new Map<string, number>();
  const add = (mint: string, x: number) => deltas.set(mint, (deltas.get(mint) ?? 0) + x);

  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner === wallet) add(b.mint, -Number(b.uiTokenAmount.uiAmountString ?? 0));
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner === wallet) add(b.mint, Number(b.uiTokenAmount.uiAmountString ?? 0));
  }

  const idx = keys.indexOf(wallet);
  let feeSol = 0;
  if (idx >= 0) {
    let lamports = meta.postBalances[idx] - meta.preBalances[idx];
    if (idx === 0) {
      // The fee payer is always account 0; the fee is a cost, not a movement.
      feeSol = meta.fee / 1e9;
      lamports += meta.fee;
    }
    add(SOL_MINT, lamports / 1e9);
  }

  for (const [mint, d] of deltas) {
    const dust = mint === SOL_MINT ? SOL_DUST : 1e-9;
    if (Math.abs(d) < dust) deltas.delete(mint);
  }
  if (!deltas.size) return null;

  const values = [...deltas.values()];
  const kind = values.some((d) => d < 0) && values.some((d) => d > 0) ? "swap" : values.some((d) => d > 0) ? "in" : "out";
  const topLevel = tx.transaction.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]);
  const inner = (meta.innerInstructions ?? []).flatMap((g) => g.instructions.map((ix) => keys[ix.programIdIndex]));
  return { signature, time: new Date(tx.blockTime * 1000), deltas, feeSol, kind, venue: detectVenue(topLevel, inner), signedByWallet: idx === 0 };
}

export interface SpotFetchOptions {
  rpcUrl?: string;
  maxSignatures?: number;
  onProgress?: OnProgress;
  /**
   * Signatures already known to be perp fills (from the Phoenix API or Jupiter events). They are skipped
   * instead of being fetched just to find out they are perps. Awaited only after listing, so the perp
   * fetch and the signature listing run in parallel.
   */
  skipSignatures?: Set<string> | Promise<Set<string>>;
}

export async function fetchSpotHistory(wallet: string, opts: SpotFetchOptions = {}): Promise<SpotHistory> {
  const rpcUrl = opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const limiter = rpcLimiter(rpcUrl);
  const max = opts.maxSignatures ?? 3000;
  const report = opts.onProgress ?? (() => {});
  const warnings: string[] = [];

  const owner = new PublicKey(wallet);
  const sigs: string[] = [];
  let before: string | undefined;
  report({ source: "spot", message: "Listing wallet transactions" });
  while (true) {
    const limit = Math.min(1000, max - sigs.length);
    const page = await limitedCall(limiter, () => conn.getSignaturesForAddress(owner, { before, limit }));
    sigs.push(...page.filter((s) => !s.err).map((s) => s.signature));
    report({ source: "spot", message: `Found ${sigs.length} transactions` });
    if (page.length < limit) break;
    if (sigs.length >= max) {
      warnings.push(`Spot: nur die letzten ${max} Transaktionen gelesen; ältere Käufe fehlen für FIFO.`);
      break;
    }
    before = page.at(-1)!.signature;
  }

  const skip = await (opts.skipSignatures ?? new Set<string>());
  const toRead = sigs.filter((s) => !skip.has(s));
  // Transactions read by an earlier report come from the cache; only new ones go to the RPC.
  const missing = toRead.filter((s) => !cachedTransaction(s));
  const total = missing.length;
  const label = `Reading ${total} new of ${toRead.length} transactions${isPublicRpc(rpcUrl) && total ? " (public RPC: ~1 per second)" : ""}`;
  report({ source: "spot", message: label, done: 0, total, etaSeconds: Math.round(total / limiter.rate()) });
  await mapLimited(
    missing,
    limiter,
    (signature) => getTransactionCached(conn, signature),
    (done) => {
      // Every transaction would flood the stream; a few dozen updates are enough for a progress bar.
      if (done === total || done % Math.max(1, Math.floor(total / 40)) === 0)
        report({ source: "spot", message: label, done, total, etaSeconds: Math.round((total - done) / limiter.rate()) });
    },
  );
  const txs = await Promise.all(toRead.map((s) => getTransactionCached(conn, s)));

  const movements: Movement[] = [];
  let skippedPerp = sigs.length - toRead.length;
  txs.forEach((tx, i) => {
    if (!tx) return;
    const m = movementFromTx(wallet, toRead[i], tx);
    if (m === "perp") skippedPerp++;
    else if (m) movements.push(m);
  });
  movements.sort((a, b) => a.time.getTime() - b.time.getTime());
  report({ source: "spot", message: `${movements.length} token movements`, done: total, total, finished: true });
  return { movements, skippedPerp, warnings };
}
