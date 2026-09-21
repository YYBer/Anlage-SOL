// Known Solana mints. Stablecoins are valued via the ECB USD rate; others via CoinGecko daily prices.
// Unknown mints are still tracked (FIFO) and valued through the other side of the swap when possible.

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface TokenInfo {
  symbol: string;
  /** Pegged to 1 USD. */
  stableUsd?: boolean;
  coingeckoId?: string;
}

export const TOKENS: Record<string, TokenInfo> = {
  [SOL_MINT]: { symbol: "SOL", coingeckoId: "solana" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", stableUsd: true },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", stableUsd: true },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: "JUP", coingeckoId: "jupiter-exchange-solana" },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: "BONK", coingeckoId: "bonk" },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: "WIF", coingeckoId: "dogwifcoin" },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: "JTO", coingeckoId: "jito-governance-token" },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: "PYTH", coingeckoId: "pyth-network" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", coingeckoId: "raydium" },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: "JitoSOL", coingeckoId: "jito-staked-sol" },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: "mSOL", coingeckoId: "msol" },
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: { symbol: "cbBTC", coingeckoId: "coinbase-wrapped-btc" },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": { symbol: "ETH (Wormhole)", coingeckoId: "ethereum" },
};

export const tokenSymbol = (mint: string) => TOKENS[mint]?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;
