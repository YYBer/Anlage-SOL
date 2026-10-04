// JSON-safe Anlage SO result, shared by the API, the page and the receipt PDF.

export interface SoDisposalDto {
  time: string;
  token: string;
  /** Where the swap happened, e.g. "Jupiter" or "pump.fun (via bot)". */
  venue: string;
  amount: number;
  /** Earliest lot consumed; null when the cost basis is unknown. */
  acquiredAt: string | null;
  holdingDays: number;
  proceedsEur: number;
  costEur: number;
  feeEur: number;
  gainEur: number;
  /** Held for more than one year: not taxable under § 23 Abs. 1 Nr. 2 EStG. */
  taxFree: boolean;
  /** False when some of the disposed tokens arrived by transfer and their cost is set to 0 €. */
  basisKnown: boolean;
  /** Some of the cost basis or acquisition date comes from the user's own records. */
  basisFromUser: boolean;
  /** Some of the cost basis is the market value when the tokens arrived, not a known purchase price. */
  basisEstimated: boolean;
  signature: string | null;
}

/** A token leg of a movement, valued once on the server so the browser can rerun FIFO without prices. */
export interface ValuedLegDto {
  mint: string;
  /** Signed: negative = left the wallet. */
  amount: number;
  valueEur: number | null;
}

export interface ValuedMovementDto {
  signature: string;
  time: string;
  kind: "swap" | "in" | "out";
  venue: string;
  feeSol: number;
  feeEur: number;
  signedByWallet: boolean;
  legs: ValuedLegDto[];
}

/** Tokens that arrived by transfer: their purchase price and date live in the user's records, not on-chain. */
export interface TransferInDto {
  /** `${signature}:${mint}`, the key for a cost override. */
  key: string;
  signature: string;
  time: string;
  mint: string;
  token: string;
  amount: number;
  /** Market value on arrival; used as an estimate when the wallet paid for the transaction itself. */
  marketValueEur: number | null;
  /** The wallet signed this transaction, so it is most likely a purchase it paid for elsewhere. */
  signedByWallet: boolean;
  /** Cost currently in use: the user's entry, the estimate, or 0 €. */
  appliedCostEur: number;
  appliedSource: "user" | "estimate" | "none";
  /** Taxable disposals of the tax year that used these tokens: the transfers worth filling in first. */
  usedInTaxYear: number;
}

/** What the user knows about a transfer-in: when and for how much they originally bought the tokens. */
export interface CostOverride {
  costEur: number;
  /** Original purchase date "YYYY-MM-DD"; holding periods run from here (own-wallet transfers don't reset them). */
  acquiredOn?: string;
}

export interface SoLineDto {
  line: number;
  label: string;
  value: string;
}

export interface SoReportDto {
  taxYear: number;
  /** Taxable disposals only (held ≤ 1 year). */
  proceedsEur: number;
  costEur: number;
  feesEur: number;
  gainEur: number;
  /** Gains from disposals held > 1 year, for information. */
  taxFreeGainEur: number;
  /** Total § 23 gains are below the 1.000 € Freigrenze, so nothing is taxed. */
  belowFreigrenze: boolean;
  lines: SoLineDto[];
  linesVerified: boolean;
  disposals: SoDisposalDto[];
  warnings: string[];
  method: string[];
  /** Inputs for recomputing with cost overrides in the browser. */
  movements: ValuedMovementDto[];
  transfersIn: TransferInDto[];
  /** Warnings from fetching, which a recomputation has to carry over. */
  fetchWarnings: string[];
}
