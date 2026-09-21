import type { Fill, Position } from "./types";

// Sizes below this count as flat; USD rounding in protocol events leaves dust like 1e-6.
const FLAT_USD = 0.01;

/**
 * Groups fills into positions: a position opens on the first fill of a flat slot
 * and closes when that slot's size returns to ~0. Fills must be chronological.
 */
export function groupPositions(fills: Fill[]): Position[] {
  const sorted = [...fills].sort((a, b) => a.time.getTime() - b.time.getTime());
  const open = new Map<string, Position>();
  const done: Position[] = [];

  for (const f of sorted) {
    let p = open.get(f.positionKey);
    if (!p) {
      p = {
        protocol: f.protocol,
        positionKey: f.positionKey,
        market: f.market,
        side: f.side,
        openTime: f.time,
        maxSizeUsd: 0,
        realizedPnlUsd: 0,
        feeUsd: 0,
        fundingOnFillsUsd: 0,
        fills: [],
        incomplete: f.kind !== "increase",
      };
      open.set(f.positionKey, p);
    }
    p.fills.push(f);
    p.realizedPnlUsd += f.realizedPnlUsd;
    p.feeUsd += f.feeUsd;
    p.fundingOnFillsUsd += f.fundingUsd;
    p.maxSizeUsd = Math.max(p.maxSizeUsd, f.sizeUsdAfter, f.sizeUsdDelta);

    const flat = f.baseAfter !== undefined ? f.baseAfter === 0 : f.sizeUsdAfter < FLAT_USD;
    if (flat && f.kind !== "increase") {
      p.closeTime = f.time;
      done.push(p);
      open.delete(f.positionKey);
    }
  }
  return [...done, ...open.values()].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
}

/** Net result of a closed position: trading PnL minus fees minus funding charged on fills. */
export const netPnlUsd = (p: Position) => p.realizedPnlUsd - p.feeUsd - p.fundingOnFillsUsd;
