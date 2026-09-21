import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { SOL_MINT } from "./tokens";

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
  return { signature, time: new Date(tx.blockTime * 1000), deltas, feeSol, kind };
}

export interface SpotFetchOptions {
  rpcUrl?: string;
  maxSignatures?: number;
  throttleMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchSpotHistory(wallet: string, opts: SpotFetchOptions = {}): Promise<SpotHistory> {
  const rpcUrl = opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const conn = new Connection(rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });
  const max = opts.maxSignatures ?? 3000;
  const throttle = opts.throttleMs ?? (rpcUrl.includes("api.mainnet-beta") ? 400 : 0);
  const warnings: string[] = [];

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fn();
        if (throttle) await sleep(throttle);
        return r;
      } catch (e) {
        if (attempt >= 6) throw e;
        await sleep(1000 * 2 ** Math.min(attempt, 4));
      }
    }
  }

  const owner = new PublicKey(wallet);
  const sigs: string[] = [];
  let before: string | undefined;
  while (true) {
    const limit = Math.min(1000, max - sigs.length);
    const page = await withRetry(() => conn.getSignaturesForAddress(owner, { before, limit }));
    sigs.push(...page.filter((s) => !s.err).map((s) => s.signature));
    if (page.length < limit) break;
    if (sigs.length >= max) {
      warnings.push(`Spot: nur die letzten ${max} Transaktionen gelesen; ältere Käufe fehlen für FIFO.`);
      break;
    }
    before = page.at(-1)!.signature;
  }

  const movements: Movement[] = [];
  let skippedPerp = 0;
  for (const signature of sigs) {
    const tx = await withRetry(() => conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 }));
    if (!tx) continue;
    const m = movementFromTx(wallet, signature, tx);
    if (m === "perp") skippedPerp++;
    else if (m) movements.push(m);
  }
  movements.sort((a, b) => a.time.getTime() - b.time.getTime());
  return { movements, skippedPerp, warnings };
}
