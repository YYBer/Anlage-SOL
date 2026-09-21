import type { Connection, VersionedTransactionResponse } from "@solana/web3.js";

// Confirmed transactions never change, so a fetched transaction can be reused by every later report
// in this server process: the second query for a wallet only fetches what is new.

const MAX_ENTRIES = 100_000;
const cache = new Map<string, VersionedTransactionResponse>();

export function cachedTransaction(signature: string): VersionedTransactionResponse | undefined {
  return cache.get(signature);
}

export async function getTransactionCached(conn: Connection, signature: string): Promise<VersionedTransactionResponse | null> {
  const hit = cache.get(signature);
  if (hit) return hit;
  const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (tx) {
    // Map keeps insertion order: drop the oldest entry when full.
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(signature, tx);
  }
  return tx;
}
