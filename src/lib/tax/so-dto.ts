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
  signature: string | null;
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
}
