// Where a swap happened, for display only: the tax math does not depend on it, which is why spot works
// on any DEX, aggregator or trading bot.

/** Aggregators and routers the user usually picked themselves; shown instead of the pools they route to. */
const AGGREGATORS: Record<string, string> = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
  DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH: "DFlow",
};

/** Pools and launchpads. */
const DEXES: Record<string, string> = {
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "pump.fun",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: "Raydium CPMM",
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj: "Raydium LaunchLab",
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: "Meteora DLMM",
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: "Meteora DAMM v2",
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: "Meteora DAMM",
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN: "Meteora DBC",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca",
};

/** Programs that appear in nearly every transaction and say nothing about the venue. */
const PLUMBING = new Set([
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

/**
 * @param topLevel program ids of the transaction's own instructions
 * @param inner program ids of inner (CPI) instructions
 */
export function detectVenue(topLevel: string[], inner: string[]): string {
  const aggregator = topLevel.map((p) => AGGREGATORS[p]).find(Boolean);
  if (aggregator) return aggregator;
  const dex = [...topLevel, ...inner].map((p) => DEXES[p] ?? AGGREGATORS[p]).find(Boolean);
  // An unknown program at the top that calls a known DEX is a trading bot or terminal router.
  const viaRouter = topLevel.some((p) => !PLUMBING.has(p) && !DEXES[p] && !AGGREGATORS[p]);
  if (dex) return viaRouter ? `${dex} (via bot)` : dex;
  return viaRouter ? "Other (bot / router)" : "Other";
}
