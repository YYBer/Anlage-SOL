# Perpelster

Tax reports for Solana perp traders, starting with Germany: enter a wallet, pick a tax year, get
Anlage KAP line items for ELSTER, a ledger in which every fill links to its on-chain transaction, and a Koinly CSV.

## Run

```bash
npm install
npm run dev                 # web UI on http://localhost:3000
npm test                    # unit tests
npm run report -- <wallet> --year 2026 --protocols phoenix,jupiter [--funding include] [--max-sigs 200] [--spot] \
  [--other "Hyperliquid:120.50:40"]   # label:gainsEur:lossesEur, repeatable
```

Copy `.env.example` to `.env.local` and set `SOLANA_RPC_URL` to a paid RPC for Jupiter.

Sample wallets (found on mainnet, not ours):
- Phoenix: `wTfZZqcs9YLcfNN6wtLyWnKpDDWJGyz5G9A6tZpfgMw`
- Spot (Jupiter swaps, memecoins): `3gg6BxZxR8G2jrQvJAU9b7YpZ1fNYE6o8fbufcnxQB1D`
- Jupiter: `YzrEWGRqsgsQrENqjom3YaWA3xjZxDguAzYDfwWhLz7` (very active; use `--max-sigs`)

## Layout

```
src/lib/
  core/types.ts          protocol-neutral Fill / FundingPayment / Position
  core/positions.ts      fills → positions (open until size returns to 0)
  adapters/phoenix.ts    Phoenix perp API (trades, funding, collateral)
  adapters/jupiter/      Jupiter Perps: Position PDAs → signatures → Anchor CPI events
  tax/fx.ts              ECB USD/EUR reference rates
  tax/germany.ts         § 20 EStG realization per closing fill → Anlage KAP lines
  export/csv.ts          positions, audit ledger, Koinly
  report.ts              fetch + FX + report
src/app/                 Next.js UI and POST /api/report
scripts/report.ts        CLI
```

## Data source notes (verified 2026-09-21)

- **Phoenix**: `perp-api.phoenix.trade/v1/trader/{wallet}/…` answered without auth although the docs
  list Bearer auth. `realizedPnl` is average-cost PnL before fees; it matches Phoenix's own
  `/v1/users/{wallet}/pnl`. One fill can flip short→long and is split into a close and an open.
- **Jupiter Perps**: no history API. `increasePosition4` and liquidations do not include the owner
  wallet, so history is read per Position PDA (9 per wallet). In events `feeUsd = positionFeeUsd + fundingFeeUsd`,
  `pnlDelta` is before fees, and `priceImpactFeeUsd` is already in the execution price.

## Tax model (Germany)

- Tax years, calendar days and holding periods use German local time (Europe/Berlin, `core/time.ts`): a close at
  2026-12-31 23:30 UTC belongs to 2027. CSV timestamps stay in UTC; the PDF shows Berlin time.
- Each reducing fill counts as a (partial) Glattstellung in the year it happens. Opening fees are released
  pro rata to the size closed.
- Anlage KAP: line 19 = net result, line 22 = contained losses. **Line numbers not yet checked against the official form.**
- Other platforms (Hyperliquid, CEX, …): the user enters gains/losses in EUR; they are added to both KAP lines (`tax/kap.ts`).
- Funding: `separate` (default, listed apart) or `include` (part of the derivative result). There is no official guidance, so the choice is left to the user.
- EUR via ECB reference rate of the German trading day (last published rate on weekends/holidays); USDC/USDT treated as USD.

## Anlage SO (spot)

- Reads every transaction of the wallet and nets the wallet's token balance changes; tokens out + tokens in = a swap (disposal + acquisition), independent of the DEX. Perp program transactions are excluded (they are KAP).
- FIFO per token over the full history; > 1 year holding is tax-free; 1.000 € Freigrenze noted.
- Prices: stablecoins via ECB; others via CoinGecko daily EUR (public API: last 365 days, set `COINGECKO_API_KEY` for more); unpriced tokens valued by the other side of the swap.
- Incoming transfers of non-stablecoins have unknown cost and are set to 0 € (flagged). Anlage SO lines 45–51/58 follow the Blockpit 2025 guide, not yet checked against the official form.

## Roadmap

- **Phoenix SOL collateral.** Phoenix accepts SOL as collateral and converts it to other assets automatically when an
  account gets risky. Those conversions may be disposals under § 23 EStG (Anlage SO). Currently only USDC collateral is assumed.
- **More perp venues:**
  - GMTrade
  - Pacifica: off-chain matching; its public API (`/api/v1/trades/history`, `/funding/history`) has PnL and fees per fill
    but no transaction signature, so those rows can't link to an on-chain receipt.
- Jupiter longs collateralized in SOL/ETH/BTC: the internal swap of collateral is not an Anlage SO disposal yet.
- Staking/airdrop income (§ 22 Nr. 3).
- Let users enter the purchase price of tokens that arrived by transfer (now 0 €).
- CoinTracking / Blockpit CSV.
- Jupiter: parallel fetching for paid RPC; streaming progress to the UI.
