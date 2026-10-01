import type { Movement } from "../spot/history";
import { PRICE_SOURCE, type PriceBook } from "../spot/prices";
import { SOL_MINT, TOKENS, tokenSymbol } from "../spot/tokens";
import type { CostOverride, SoDisposalDto, SoReportDto, TransferInDto, ValuedMovementDto } from "./so-dto";
import { berlinDate, berlinYear } from "../core/time";

// § 23 Abs. 1 Nr. 2 EStG: disposing of a crypto asset within one year of acquisition is a private
// Veräußerungsgeschäft. Swapping token A for B disposes of A and acquires B. FIFO per token
// (BMF-Schreiben 06.03.2025). Total gains below 1.000 € per year are tax-free (Freigrenze, since 2024).

export const FREIGRENZE_EUR = 1000;

// Anlage SO 2025 checked against the official form (formulare-bfinv.de, 2026-09); later years still need checking.
export const SO_LINES: Record<
  number,
  { flag: number; name: number; period: number; proceeds: number; costs: number; fees: number; result: number; total: number; verified: boolean }
> = {
  2025: { flag: 45, name: 46, period: 47, proceeds: 48, costs: 49, fees: 50, result: 51, total: 58, verified: true },
  2026: { flag: 45, name: 46, period: 47, proceeds: 48, costs: 49, fees: 50, result: 51, total: 58, verified: false },
};

interface Lot {
  amount: number;
  costEur: number;
  acquiredAt: Date;
  /** False when the tokens arrived by transfer and their real purchase price is unknown. */
  basisKnown: boolean;
  fromUser: boolean;
  /** Transfer key when the lot came from a transfer-in. */
  origin?: string;
}

interface Chunk {
  amount: number;
  costEur: number;
  acquiredAt: Date | null;
  basisKnown: boolean;
  fromUser: boolean;
  origin?: string;
}

export interface SoDisposal extends SoDisposalDto {
  /** Transfer-ins whose tokens this disposal used. */
  origins: string[];
}

const EPS = 1e-12;
const round2 = (x: number) => Math.round(x * 100) / 100;
const eur = (x: number) => x.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** More than one year, by German calendar date: acquired 2025-03-01 → tax-free from 2026-03-02. */
export function heldOverOneYear(acquiredAt: Date, disposedAt: Date): boolean {
  const acquired = berlinDate(acquiredAt);
  const anniversary = `${Number(acquired.slice(0, 4)) + 1}${acquired.slice(4)}`;
  return berlinDate(disposedAt) > anniversary;
}

export const transferKey = (signature: string, mint: string) => `${signature}:${mint}`;
const isStable = (mint: string) => !!TOKENS[mint]?.stableUsd;

class Fifo {
  private lots = new Map<string, Lot[]>();

  add(mint: string, lot: Lot) {
    if (lot.amount <= EPS) return;
    const list = this.lots.get(mint) ?? [];
    list.push(lot);
    this.lots.set(mint, list);
  }

  /** Takes `amount` from the oldest lots; any shortfall comes back as a chunk with unknown basis. */
  take(mint: string, amount: number): Chunk[] {
    const list = this.lots.get(mint) ?? [];
    const out: Chunk[] = [];
    let left = amount;
    while (left > EPS && list.length) {
      const lot = list[0];
      const used = Math.min(lot.amount, left);
      const cost = lot.costEur * (used / lot.amount);
      out.push({ amount: used, costEur: cost, acquiredAt: lot.acquiredAt, basisKnown: lot.basisKnown, fromUser: lot.fromUser, origin: lot.origin });
      lot.amount -= used;
      lot.costEur -= cost;
      left -= used;
      if (lot.amount <= EPS) list.shift();
    }
    if (left > EPS) out.push({ amount: left, costEur: 0, acquiredAt: null, basisKnown: false, fromUser: false });
    return out;
  }
}

/** Values every leg once (server side), so FIFO can rerun anywhere without a price source. */
export function valueMovements(movements: Movement[], prices: PriceBook): ValuedMovementDto[] {
  return movements.map((m) => ({
    signature: m.signature,
    time: m.time.toISOString(),
    kind: m.kind,
    venue: m.venue,
    feeSol: m.feeSol,
    feeEur: m.feeSol > 0 ? (prices.valueEur(SOL_MINT, m.feeSol, m.time) ?? 0) : 0,
    legs: [...m.deltas].map(([mint, amount]) => ({ mint, amount, valueEur: prices.valueEur(mint, Math.abs(amount), m.time) })),
  }));
}

export interface SoComputation {
  disposals: SoDisposal[];
  warnings: string[];
}

/**
 * Runs FIFO over the full history (older years are needed for cost basis and holding periods).
 * `overrides` hold the user's purchase price and date for tokens that arrived by transfer.
 */
export function computeDisposals(movements: ValuedMovementDto[], overrides: Record<string, CostOverride> = {}): SoComputation {
  const fifo = new Fifo();
  const disposals: SoDisposal[] = [];
  const warnings: string[] = [];
  let unpricedSwaps = 0;
  let transfersInOpen = 0;
  let transfersInFilled = 0;
  let transfersOut = 0;

  for (const m of movements) {
    processMovement(m);
    // Network fees consume SOL lots after the movement itself, so later SOL sales use the right lots.
    // The fee's market value is deducted as Werbungskosten of the disposal; its own cost basis is not.
    if (m.feeSol > 0) fifo.take(SOL_MINT, m.feeSol);
  }

  function processMovement(m: ValuedMovementDto) {
    const time = new Date(m.time);
    const outs = m.legs.filter((l) => l.amount < 0).map((l) => ({ ...l, amount: -l.amount }));
    const ins = m.legs.filter((l) => l.amount > 0);

    if (m.kind === "in") {
      for (const i of ins) {
        const key = transferKey(m.signature, i.mint);
        const o = overrides[key];
        if (o && Number.isFinite(o.costEur)) {
          transfersInFilled++;
          // Noon UTC keeps the entered calendar date in Europe/Berlin.
          const acquiredAt = o.acquiredOn ? new Date(`${o.acquiredOn}T12:00:00Z`) : time;
          fifo.add(i.mint, { amount: i.amount, costEur: o.costEur, acquiredAt, basisKnown: true, fromUser: true, origin: key });
        } else if (isStable(i.mint)) {
          // Stablecoins arriving from elsewhere were almost certainly bought at ~1 USD.
          fifo.add(i.mint, { amount: i.amount, costEur: i.valueEur ?? 0, acquiredAt: time, basisKnown: true, fromUser: false, origin: key });
        } else {
          transfersInOpen++;
          fifo.add(i.mint, { amount: i.amount, costEur: 0, acquiredAt: time, basisKnown: false, fromUser: false, origin: key });
        }
      }
      return;
    }
    if (m.kind === "out") {
      // Leaves the wallet without a counter-value: a transfer, not a disposal.
      transfersOut++;
      for (const o of outs) fifo.take(o.mint, o.amount);
      return;
    }

    // Swap: value the exchange once, preferring the side that is fully priced (stablecoins first).
    const sideValue = (legs: { valueEur: number | null }[]) =>
      legs.every((l) => l.valueEur !== null) ? { total: legs.reduce((s, l) => s + (l.valueEur ?? 0), 0), each: legs.map((l) => l.valueEur ?? 0) } : null;
    const inV = sideValue(ins);
    const outV = sideValue(outs);
    const value = inV && (ins.some((l) => isStable(l.mint)) || !outV) ? inV.total : outV ? outV.total : inV ? inV.total : null;

    const chunksByOut = outs.map((o) => ({ ...o, chunks: fifo.take(o.mint, o.amount) }));
    const carriedCost = chunksByOut.reduce((s, o) => s + o.chunks.reduce((t, c) => t + c.costEur, 0), 0);
    if (value === null) unpricedSwaps++;

    // Proceeds per disposed token: by its own value if known, else by share of the swap.
    const outShares = outV ? outV.each.map((v) => (outV.total > 0 ? v / outV.total : 1 / outs.length)) : outs.map(() => 1 / outs.length);
    chunksByOut.forEach((o, i) => {
      const proceeds = value === null ? o.chunks.reduce((t, c) => t + c.costEur, 0) : value * outShares[i];
      const fee = i === 0 ? m.feeEur : 0;
      // Split into the part held ≤ 1 year (taxable) and > 1 year (tax-free).
      for (const taxFree of [false, true]) {
        const group = o.chunks.filter((c) => (c.acquiredAt ? heldOverOneYear(c.acquiredAt, time) : false) === taxFree);
        if (!group.length) continue;
        const amount = group.reduce((s, c) => s + c.amount, 0);
        const share = amount / o.amount;
        const costEur = group.reduce((s, c) => s + c.costEur, 0);
        const dates = group.map((c) => c.acquiredAt).filter((d): d is Date => !!d);
        const earliest = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
        disposals.push({
          time: m.time,
          token: tokenSymbol(o.mint),
          venue: m.venue,
          amount,
          acquiredAt: earliest?.toISOString() ?? null,
          holdingDays: earliest ? Math.floor((time.getTime() - earliest.getTime()) / 86_400_000) : 0,
          proceedsEur: proceeds * share,
          costEur,
          feeEur: fee * share,
          gainEur: proceeds * share - costEur - fee * share,
          taxFree,
          basisKnown: group.every((c) => c.basisKnown),
          basisFromUser: group.some((c) => c.fromUser),
          signature: m.signature,
          origins: [...new Set(group.map((c) => c.origin).filter((x): x is string => !!x))],
        });
      }
    });

    // Acquired tokens: cost = value of the exchange; without a price, the old cost basis carries over.
    const acquisitionValue = value ?? carriedCost;
    const inShares = inV ? inV.each.map((v) => (inV.total > 0 ? v / inV.total : 1 / ins.length)) : ins.map(() => 1 / ins.length);
    ins.forEach((i, k) => fifo.add(i.mint, { amount: i.amount, costEur: acquisitionValue * inShares[k], acquiredAt: time, basisKnown: true, fromUser: false }));
  }

  if (unpricedSwaps) {
    warnings.push(`${unpricedSwaps} Tausch(e) ohne Kurs: Erlös = bisherige Anschaffungskosten angesetzt (Gewinn 0), Anschaffungskosten übertragen.`);
  }
  if (transfersInOpen) {
    warnings.push(`${transfersInOpen} eingehende Übertragung(en) ohne Anschaffungskosten (mit 0 € angesetzt): Kaufpreis und -datum bitte ergänzen.`);
  }
  if (transfersInFilled) warnings.push(`${transfersInFilled} eingehende Übertragung(en) mit Anschaffungskosten laut Angabe des Steuerpflichtigen.`);
  if (transfersOut) warnings.push(`${transfersOut} ausgehende Übertragung(en) als Wallet-Transfer behandelt (keine Veräußerung).`);
  return { disposals, warnings };
}

export function buildSoReport(
  movements: ValuedMovementDto[],
  taxYear: number,
  fetchWarnings: string[] = [],
  overrides: Record<string, CostOverride> = {},
): SoReportDto {
  const { disposals, warnings } = computeDisposals(movements, overrides);
  const inYear = disposals.filter((d) => berlinYear(d.time) === taxYear);
  const taxable = inYear.filter((d) => !d.taxFree);

  const proceeds = round2(taxable.reduce((s, d) => s + d.proceedsEur, 0));
  const costs = round2(taxable.reduce((s, d) => s + d.costEur, 0));
  const fees = round2(taxable.reduce((s, d) => s + d.feeEur, 0));
  const gain = round2(proceeds - costs - fees);
  const taxFreeGain = round2(inYear.filter((d) => d.taxFree).reduce((s, d) => s + d.gainEur, 0));
  const belowFreigrenze = gain > 0 && gain < FREIGRENZE_EUR;

  const unknownBasis = taxable.filter((d) => !d.basisKnown);
  const allWarnings = [...fetchWarnings, ...warnings];
  if (unknownBasis.length) {
    allWarnings.push(`${unknownBasis.length} steuerpflichtige Veräußerung(en) mit unbekannten Anschaffungskosten (0 € angesetzt): Gewinn ist ggf. zu hoch.`);
  }
  if (belowFreigrenze) {
    allWarnings.push(
      `Gewinn unter der Freigrenze von ${eur(FREIGRENZE_EUR)}: steuerfrei, sofern alle privaten Veräußerungsgeschäfte ${taxYear} zusammen unter 1.000 € bleiben.`,
    );
  }

  // Non-stable transfer-ins, with how many of this year's taxable disposals used them.
  const usage = new Map<string, number>();
  for (const d of taxable) for (const o of d.origins) usage.set(o, (usage.get(o) ?? 0) + 1);
  const transfersIn: TransferInDto[] = movements
    .filter((m) => m.kind === "in")
    .flatMap((m) =>
      m.legs
        .filter((l) => l.amount > 0 && !isStable(l.mint))
        .map((l) => {
          const key = transferKey(m.signature, l.mint);
          return {
            key,
            signature: m.signature,
            time: m.time,
            mint: l.mint,
            token: tokenSymbol(l.mint),
            amount: l.amount,
            marketValueEur: l.valueEur,
            usedInTaxYear: usage.get(key) ?? 0,
          };
        }),
    );

  const l = SO_LINES[taxYear] ?? SO_LINES[2025];
  return {
    taxYear,
    proceedsEur: proceeds,
    costEur: costs,
    feesEur: fees,
    gainEur: gain,
    taxFreeGainEur: taxFreeGain,
    belowFreigrenze,
    linesVerified: l.verified,
    lines: taxable.length
      ? [
          { line: l.flag, label: "Private Veräußerungsgeschäfte mit Kryptowerten", value: "1" },
          { line: l.name, label: "Bezeichnung des Wirtschaftsguts", value: "Kryptowerte (Solana-Wallet), s. Anlage D" },
          { line: l.period, label: "Anschaffung / Veräußerung", value: `diverse ${taxYear}, s. Anlage D` },
          { line: l.proceeds, label: "Veräußerungspreis", value: eur(proceeds) },
          { line: l.costs, label: "Anschaffungskosten", value: eur(costs) },
          { line: l.fees, label: "Werbungskosten", value: eur(fees) },
          { line: l.result, label: "Gewinn / Verlust", value: eur(gain) },
          { line: l.total, label: "Summe (zu übertragen)", value: eur(gain) },
        ]
      : [],
    disposals: inYear.map((d) => ({
      time: d.time,
      token: d.token,
      venue: d.venue,
      amount: d.amount,
      acquiredAt: d.acquiredAt,
      holdingDays: d.holdingDays,
      proceedsEur: round2(d.proceedsEur),
      costEur: round2(d.costEur),
      feeEur: round2(d.feeEur),
      gainEur: round2(d.gainEur),
      taxFree: d.taxFree,
      basisKnown: d.basisKnown,
      basisFromUser: d.basisFromUser,
      signature: d.signature,
    })),
    warnings: allWarnings,
    method: [
      "Spot (Anlage SO): Jeder Tausch eines Tokens gegen einen anderen ist eine Veräußerung des abgegebenen und eine Anschaffung des erhaltenen Tokens. Erkannt anhand der Saldenänderungen der Wallet je Transaktion, unabhängig vom genutzten DEX.",
      "Verbrauchsfolge FIFO je Token über die gesamte gelesene Wallet-Historie. Haltedauer über ein Jahr: steuerfrei (§ 23 Abs. 1 Nr. 2 EStG). Netzwerkgebühren der Veräußerung als Werbungskosten.",
      `Bewertung: ${PRICE_SOURCE}.`,
      "Übertragungen zwischen eigenen Wallets sind keine Anschaffung: Für eingehende Token gelten Kaufdatum und Anschaffungskosten laut Angabe des Steuerpflichtigen (in Anlage D mit „A“ gekennzeichnet), andernfalls 0 € ab Eingang.",
      "Transaktionen mit Jupiter Perps oder Phoenix Perps sind Termingeschäfte (Anlage KAP) und hier nicht enthalten.",
    ],
    movements,
    transfersIn,
    fetchWarnings,
  };
}
