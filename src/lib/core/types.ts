// Protocol-neutral records. Every adapter maps its native data into these,
// and everything downstream (position grouping, tax, exports) only sees these.

export type Protocol = "phoenix" | "jupiter";
export type Side = "long" | "short";

/** One execution that changed a position. All USD amounts are plain numbers in USD. */
export interface Fill {
  protocol: Protocol;
  /** Stable key for the position slot this fill belongs to (market + side + account/collateral). */
  positionKey: string;
  market: string;
  side: Side;
  time: Date;
  /** Absolute notional change in USD (always >= 0). */
  sizeUsdDelta: number;
  /** Absolute position size in USD after this fill; 0 means the position is closed. */
  sizeUsdAfter: number;
  /** Absolute size change in base units, when the protocol reports it. */
  baseDelta?: number;
  /** Absolute position size in base units after this fill, when reported. */
  baseAfter?: number;
  price: number;
  kind: "increase" | "decrease" | "liquidation";
  /** Realized trading PnL before fees; 0 on increases. */
  realizedPnlUsd: number;
  /** Trading fees paid on this fill (positive = paid). */
  feeUsd: number;
  /** Funding / borrow charged at this fill (positive = paid). Jupiter settles borrow fees on fills. */
  fundingUsd: number;
  signature?: string;
  raw?: unknown;
}

/** Periodic funding not tied to a fill (Phoenix). Positive = received, negative = paid. */
export interface FundingPayment {
  protocol: Protocol;
  market: string;
  side: Side;
  time: Date;
  amountUsd: number;
  signature?: string;
}

/** Collateral moved into or out of the protocol (relevant for Anlage SO). */
export interface CollateralTransfer {
  protocol: Protocol;
  time: Date;
  asset: string;
  /** Positive = deposit, negative = withdrawal, in asset units. */
  amount: number;
  signature?: string;
}

export interface WalletHistory {
  wallet: string;
  fills: Fill[];
  funding: FundingPayment[];
  collateral: CollateralTransfer[];
  /** Human-readable caveats collected while fetching (truncation, unknown events, …). */
  warnings: string[];
}

/** A position from first open until its size returns to zero. */
export interface Position {
  protocol: Protocol;
  positionKey: string;
  market: string;
  side: Side;
  openTime: Date;
  /** Undefined while still open. */
  closeTime?: Date;
  maxSizeUsd: number;
  realizedPnlUsd: number;
  feeUsd: number;
  /** Funding/borrow charged on fills (positive = paid). */
  fundingOnFillsUsd: number;
  fills: Fill[];
  /** First fill seen was not an increase: the opening lies outside the fetched history. */
  incomplete: boolean;
}

export interface Adapter {
  protocol: Protocol;
  fetchHistory(wallet: string, opts?: { since?: Date; until?: Date }): Promise<WalletHistory>;
}
