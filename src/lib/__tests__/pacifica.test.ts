import { describe, expect, it } from "vitest";
import { fundingToPayments, tradesToFills } from "../adapters/pacifica";

// Rows as api.pacifica.fi returned them on 2026-10-04 for two mainnet accounts.
const ethClose = {
  history_id: 291668382,
  symbol: "ETH",
  amount: "0.1786",
  price: "2692.2",
  entry_price: "2749.791637",
  fee: "0.182714",
  pnl: "10.103152",
  side: "close_short",
  event_type: "fulfill_taker",
  cause: "normal",
  created_at: 1791073205955,
};
const zecOpen = {
  history_id: 290609727,
  symbol: "ZEC",
  amount: "0.76",
  price: "1400",
  entry_price: "1400",
  fee: "0.1596",
  pnl: "-0.1596",
  side: "open_short",
  event_type: "fulfill_maker",
  cause: "normal",
  created_at: 1790948134555,
};

describe("pacifica trades", () => {
  it("reports PnL before fees, because the API nets the fee out of `pnl`", () => {
    const [fill] = tradesToFills([{ ...ethClose, amount: "1", entry_price: "110", price: "100", fee: "0.5", pnl: "9.5" }]);
    expect(fill.realizedPnlUsd).toBe(10);
    expect(fill.feeUsd).toBe(0.5);
  });

  it("matches the gross PnL of a real close to the cent", () => {
    const [fill] = tradesToFills([ethClose]);
    const gross = (Number(ethClose.entry_price) - Number(ethClose.price)) * Number(ethClose.amount);
    expect(fill.realizedPnlUsd).toBeCloseTo(gross, 6);
    expect(fill.side).toBe("short");
    expect(fill.kind).toBe("decrease");
    expect(fill.signature).toBeUndefined();
  });

  it("counts an open as an increase with no realized PnL", () => {
    const [fill] = tradesToFills([zecOpen]);
    expect(fill.kind).toBe("increase");
    expect(fill.realizedPnlUsd).toBe(0);
    expect(fill.feeUsd).toBeCloseTo(0.1596, 6);
    expect(fill.sizeUsdDelta).toBeCloseTo(1064, 6);
  });

  it("rebuilds the running position size from oldest to newest", () => {
    const open = (amount: string, at: number) => ({ ...zecOpen, history_id: at, amount, created_at: at, price: "100" });
    const close = (amount: string, at: number) => ({ ...open(amount, at), side: "close_short", pnl: "0", fee: "0" });
    // Given newest first, as the API returns them.
    const fills = tradesToFills([close("1", 3), open("2", 2), open("1", 1)]);
    expect(fills.map((f) => f.baseAfter)).toEqual([1, 3, 2]);
    expect(fills.at(-1)?.sizeUsdAfter).toBe(200);
  });

  it("keeps long and short of one market apart", () => {
    const fills = tradesToFills([
      { ...zecOpen, history_id: 1, created_at: 1, side: "open_long", amount: "5" },
      { ...zecOpen, history_id: 2, created_at: 2, side: "open_short", amount: "3" },
    ]);
    expect(fills.map((f) => f.positionKey)).toEqual(["pacifica:ZEC:long", "pacifica:ZEC:short"]);
    expect(fills.map((f) => f.baseAfter)).toEqual([5, 3]);
  });

  it("treats a close bigger than the known position as closing it, not as a negative size", () => {
    const fills = tradesToFills([{ ...zecOpen, side: "close_short", amount: "5", pnl: "0", fee: "0" }]);
    expect(fills[0].baseAfter).toBe(0);
  });

  it("closes a position that float arithmetic would leave a dust remainder on", () => {
    // 0.1 + 0.2 - 0.3 is not 0 in binary floating point, and a busy account has thousands of these.
    const t = (side: string, amount: string, at: number) => ({ ...zecOpen, history_id: at, created_at: at, side, amount, pnl: "0", fee: "0" });
    const fills = tradesToFills([t("open_long", "0.1", 1), t("open_long", "0.2", 2), t("close_long", "0.3", 3)]);
    expect(fills.at(-1)?.baseAfter).toBe(0);
    expect(fills.at(-1)?.sizeUsdAfter).toBe(0);
  });

  it("flags an unknown close cause instead of silently guessing", () => {
    const warnings: string[] = [];
    const fills = tradesToFills([{ ...zecOpen, side: "close_short", cause: "something_new", pnl: "0", fee: "0" }], warnings);
    expect(fills[0].kind).toBe("decrease");
    expect(warnings.join()).toContain("something_new");
  });

  it("marks a liquidation", () => {
    const [fill] = tradesToFills([{ ...zecOpen, side: "close_long", cause: "liquidation", pnl: "0", fee: "0" }]);
    expect(fill.kind).toBe("liquidation");
  });
});

describe("pacifica funding", () => {
  it("keeps the sign (received positive, paid negative) and maps ask/bid to short/long", () => {
    const payments = fundingToPayments([
      { history_id: 1, symbol: "ETH", side: "ask", amount: "112.0586", payout: "3.784465", rate: "0.0000125", created_at: 1791144004412 },
      { history_id: 2, symbol: "BNB", side: "bid", amount: "150", payout: "-12.5", rate: "0.0000118", created_at: 1791144015889 },
    ]);
    expect(payments.map((p) => [p.side, p.amountUsd])).toEqual([
      ["short", 3.784465],
      ["long", -12.5],
    ]);
    expect(payments[0].market).toBe("ETH");
  });
});
