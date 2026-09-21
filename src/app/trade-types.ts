// What the user says they traded, and what that means for the forms.
// Strategies are how users think; forms are how the tax office thinks. This maps one to the other.

export type TradeType = "spot" | "perps" | "arbitrage";
export type ArbKind = "cashAndCarry" | "crossExchange";

export interface TradeSelection {
  types: TradeType[];
  arbKinds: ArbKind[];
}

export const TRADE_TYPES: { id: TradeType; title: string; body: string; forms: string }[] = [
  {
    id: "spot",
    title: "Spot trading",
    body: "Buying, selling or swapping tokens, e.g. on Jupiter swap.",
    forms: "Anlage SO",
  },
  {
    id: "perps",
    title: "Perpetual futures",
    body: "Long or short perps on Phoenix or Jupiter Perps.",
    forms: "Anlage KAP",
  },
  {
    id: "arbitrage",
    title: "Funding-rate arbitrage",
    body: "Hedged positions that earn funding: spot against perp, or perp against perp.",
    forms: "KAP + SO",
  },
];

export const ARB_KINDS: { id: ArbKind; title: string; body: string }[] = [
  {
    id: "cashAndCarry",
    title: "Spot + perp",
    body: "Hold the token, short the perp. The spot leg goes to Anlage SO, the perp leg to Anlage KAP; they can't offset each other.",
  },
  {
    id: "crossExchange",
    title: "Perp vs perp across platforms",
    body: "Long on one platform, short on another. Both legs are Termingeschäfte and net in the same KAP line.",
  },
];

/** The report needs on-chain perp data (both perps and every kind of arbitrage have a perp leg). */
export const needsPerps = (s: TradeSelection) => s.types.includes("perps") || s.types.includes("arbitrage");

/** Anything with a spot leg needs Anlage SO, which is not built yet. */
export const needsSpot = (s: TradeSelection) =>
  s.types.includes("spot") || (s.types.includes("arbitrage") && s.arbKinds.includes("cashAndCarry"));

export const hasArbitrage = (s: TradeSelection) => s.types.includes("arbitrage");

/** A cross-exchange trade usually has one leg outside Phoenix/Jupiter that the user must enter. */
export const expectsOtherPlatforms = (s: TradeSelection) => hasArbitrage(s) && s.arbKinds.includes("crossExchange");

/** Why Anlage SO is needed, for the "coming soon" card. */
export function spotReasons(s: TradeSelection): string[] {
  const reasons: string[] = [];
  if (s.types.includes("spot")) reasons.push("spot trades");
  if (hasArbitrage(s) && s.arbKinds.includes("cashAndCarry")) reasons.push("the spot leg of your spot + perp trades");
  return reasons;
}
