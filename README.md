# Anlage SOL — your Solana trades, ready for ELSTER

> **Deine Solana-Trades. Fertig für ELSTER.**
> German tax reports for Solana traders: paste a wallet, get the exact lines to type into the tax form — no spreadsheets, no manual tagging.

**Live MVP:** https://anlage-sol.vercel.app — no wallet connection, no signup. Paste any Solana address (or press a sample button) and press *Generate report*.

Sample wallets to test with (found on mainnet, not ours):

| Button | Wallet | What it shows |
|---|---|---|
| Phoenix perps | `wTfZZqcs9YLcfNN6wtLyWnKpDDWJGyz5G9A6tZpfgMw` | 155 Phoenix perp fills and 725 funding payments → Anlage KAP |
| Spot swaps | `4vy8sofeZxjkoFxSXCN4f2jw5sVeRLWXxRBMpmn1Vqwd` | a small spot trader, ~50 transactions → Anlage SO |
| Jupiter Perps | `YzrEWGRqsgsQrENqjom3YaWA3xjZxDguAzYDfwWhLz7` | very active; minutes on a public RPC |
| Pacifica | `DxPKAPbkiTVdxx9wLvxPJf2Qgqa5Su24rBXYxgF4xhJb` | 181 fills and 2.002 funding payments in 2026, 44 closed positions; about 2 minutes, because Pacifica's API serves 50 rows per request |

The hosted demo runs on a public Solana RPC (~1 request/s), so the first query on a busy wallet takes minutes. A wallet queried before answers in about a second.

## Problem

Germany taxes a Solana trader's two kinds of activity under two different laws, on two different forms, and they cannot offset each other:

- **Perps** are Termingeschäfte under § 20 Abs. 2 EStG → **Anlage KAP**. Every closing fill is a taxable event in the year it happens, in EUR at that day's rate.
- **Spot swaps** are private disposals under § 23 EStG → **Anlage SO**. FIFO per token, tax-free after one year, 1.000 € Freigrenze.

No broker sends a Steuerbescheinigung for any of this. The trader has to reconstruct it: find every fill across venues, convert each to EUR at the right daily rate, apply FIFO across years, split the result over two forms, and keep proof the tax office accepts. Commercial crypto tax tools import CEX CSVs and stumble over on-chain perps — Jupiter Perps has no history API at all, and funding payments are invisible in a plain transaction list.

**Anlage SOL does that from a wallet address alone**, and every number it prints links back to the transaction it came from.

## Product

Enter a wallet and a tax year. The report that comes back has:

- **Anlage KAP line items** — line 19 (net result) and line 22 (contained losses), as numbers to type into ELSTER.
- **Anlage SO line items** — lines 45–51 and 58 for crypto disposals, with FIFO holding periods and the 1.000 € Freigrenze applied.
- **A ledger** of every fill, funding payment and disposal, each linking to its transaction on Solscan, so an auditor can follow any euro back to the chain.
- **A PDF receipt** (Nachweis) with the method described in German, and **CSV exports** (positions, audit ledger, Koinly).
- **Fields for what the chain cannot know**: the purchase price of tokens that arrived by transfer, and gains/losses from other platforms (Hyperliquid, CEX) that join the same KAP lines.

Two decisions the tool does not make for the user: how funding fees should count (no official German guidance exists yet, so it is a choice with both options explained), and anything requiring a tax advisor's signature. It produces numbers and evidence, not advice.

The whole input is a wallet address, a tax year and that one funding choice. Venue checkboxes were removed on purpose: a venue the user forgets to tick would silently understate the report.

## Solana integration

The product *is* the Solana integration — the chain is the only data source. No Steuerbescheinigung, no exchange CSV, no user-entered trade list.

**Reading perps (Anlage KAP):**

- **Jupiter Perps** (`PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu`) has no history API. Opens and liquidations do not list the owner wallet in their accounts, so the adapter derives the wallet's 9 **Position PDAs** (3 markets × long + 2 stablecoin-collateral shorts) with `findProgramAddressSync`, pages `getSignaturesForAddress` over each, and decodes the program's **Anchor `emit_cpi!` events** out of the inner instructions with `BorshEventCoder` and the program IDL. That yields size, price, PnL, position fee and funding fee per execution.
- **Phoenix Perps** via its public API (`perp-api.phoenix.trade`) for trades, funding and collateral, with the on-chain signature kept on every row so the receipt stays verifiable.
- **Pacifica** via its public API (`api.pacifica.fi`). It matches off-chain, so these fills carry no transaction signature: the receipt says so and points to the account's Pacifica history instead of Solscan for those rows. The API reports PnL net of the fee and no position size, so the adapter adds the fee back and rebuilds the running size per market and side.

**Reading spot (Anlage SO), DEX-agnostic:** for every transaction of the wallet, the adapter nets `preTokenBalances` against `postTokenBalances` (plus the SOL delta, minus rent dust and the network fee). Tokens out + tokens in = a swap, which is a disposal plus an acquisition under § 23 EStG. This works identically for Jupiter, pump.fun, PumpSwap, Raydium, Orca, Meteora, DFlow or an unknown trading bot, because it reads the *effect* of the transaction instead of parsing each program's instructions. Program IDs are matched afterwards (`spot/venues.ts`) only to name the venue on screen. Perp-program transactions are excluded, since they belong to KAP.

**Stack:** `@solana/web3.js` (RPC: `getSignaturesForAddress`, `getTransaction` with parsed token balances), `@coral-xyz/anchor` (PDA derivation, event decoding, IDL), Next.js 16 API route streaming NDJSON progress to the page.

**Network:** mainnet, read-only. Devnet has no perp history and no priceable tokens, so a tax report there would be empty — `SOLANA_RPC_URL` can point anywhere, but the demo uses mainnet because that is where the data a German tax return needs actually lives. Nothing is signed, no key is ever requested, and the app holds no custody: it only reads public history.

## Run locally

```bash
npm install
npm run dev                 # web UI on http://localhost:3000
npm test                    # unit tests
npm run report -- <wallet> --year 2026 [--protocols phoenix,jupiter] [--funding include] [--max-sigs 200] [--no-spot] \
  [--other "Hyperliquid:120.50:40"]   # label:gainsEur:lossesEur, repeatable
```

Copy `.env.example` to `.env.local`. Speed depends on the RPC (measured 2026-09-21, 173-transaction wallet):

| | First query | Same wallet again |
|---|---|---|
| Public RPC (~1 `getTransaction`/s) | 3–5 min | ~1 s (transactions are cached in the server process) |
| Helius free tier (~10 req/s) | ~20 s (estimated) | ~1 s |

The API streams progress (`application/x-ndjson`), and the page shows it in a status bar at the bottom of the screen.
Perps come back first as a partial result; spot follows and skips transactions already known as perp fills
(measured on the perp sample wallet: 145 of 191 transactions skipped, full report in 12 s with a warm cache).

## Layout

```
src/lib/
  core/types.ts          protocol-neutral Fill / FundingPayment / Position
  core/positions.ts      fills → positions (open until size returns to 0)
  adapters/phoenix.ts    Phoenix perp API (trades, funding, collateral)
  adapters/jupiter/      Jupiter Perps: Position PDAs → signatures → Anchor CPI events
  adapters/pacifica.ts   Pacifica API (off-chain matching, no signatures)
  spot/history.ts        any transaction → net token deltas → swap / transfer
  spot/prices.ts         CoinGecko daily EUR, stablecoins via ECB
  tax/fx.ts              ECB USD/EUR reference rates
  tax/germany.ts         § 20 EStG realization per closing fill → Anlage KAP lines
  tax/germany-so.ts      § 23 EStG FIFO per token → Anlage SO lines
  export/csv.ts          positions, audit ledger, Koinly
  export/pdf.ts          German receipt (Nachweis) with method and per-row signatures
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

- **Pacifica** (verified 2026-10-04 on two mainnet accounts): `api.pacifica.fi/api/v1/trades/history` and `/funding/history`
  are public and need no key. `pnl` is net of `fee` ((price − entry_price) × amount − fee to the cent), funding `payout` is
  signed (positive = received) with `side` ask = short, and no row carries a transaction signature. `limit` above 50 answers
  429 and `start_time`/`end_time` span at most 30 days, but plain cursor paging has no window limit and reaches the account's
  first trade (seen: 2025-09-24), so it is not a rolling retention window.

## Tax model (Germany)

- Tax years, calendar days and holding periods use German local time (Europe/Berlin, `core/time.ts`): a close at
  2026-12-31 23:30 UTC belongs to 2027. CSV timestamps stay in UTC; the PDF shows Berlin time.
- Each reducing fill counts as a (partial) Glattstellung in the year it happens. Opening fees are released
  pro rata to the size closed.
- Anlage KAP: line 19 = net result (ausländische Kapitalerträge), line 22 = contained losses (darin enthaltene Verluste ohne
  Aktienveräußerungsverluste). Checked against the 2025 form (2026-09): since JStG 2024 the separate Termingeschäft lines
  (2024: lines 21 and 24) are gone, so perp gains and losses go only into lines 19 and 22. The 2026 form is not out yet; recheck then.
- Other platforms (Hyperliquid, CEX, …): the user enters gains/losses in EUR; they are added to both KAP lines (`tax/kap.ts`).
- Funding: `separate` (default, listed apart) or `include` (part of the derivative result). There is no official guidance, so the choice is left to the user.
- EUR via ECB reference rate of the German trading day (last published rate on weekends/holidays); USDC/USDT treated as USD.

## Anlage SO (spot)

- Reads every transaction of the wallet and nets the wallet's token balance changes; tokens out + tokens in = a swap (disposal + acquisition). It works the same whether the user traded on Jupiter, pump.fun or through a trading bot, because it doesn't depend on the DEX. The venue (`spot/venues.ts`) is shown for information only. Perp program transactions are excluded (they are KAP).
- FIFO per token over the full history; > 1 year holding is tax-free; 1.000 € Freigrenze noted.
- Prices: stablecoins via ECB; others via CoinGecko daily EUR (public API: last 365 days, set `COINGECKO_API_KEY` for more); unpriced tokens valued by the other side of the swap.
- Tokens that arrive without a payment from the wallet have no on-chain purchase price. Cost basis is taken in this order: the user's own entry, else the market value on arrival if the wallet signed and paid for the transaction (a likely purchase funded from elsewhere), else 0 €. Each disposal shows which applied ("your entry" / "estimated" / "cost unknown"), marked A / S / * in the receipt.
- The user can enter the real purchase price and date per arrival; the browser reruns FIFO on the server's valued movements, so nothing is fetched again (kept per wallet in the browser). The date matters: moving tokens between your own wallets does not restart the one-year holding period.
- Anlage SO lines 45–51/58 checked against the official 2025 form (2026-09); the 2026 form is not out yet.

## Limits

- Mainnet only in practice (see *Network* above), and the hosted demo's public RPC makes the first query on a busy wallet slow.
- Prices for tokens older than 365 days need a CoinGecko key.
- Line numbers are checked against the official 2025 forms; the 2026 forms are not published yet, and the report says so for years it could not verify.
- Funds the wallet holds elsewhere are only half visible: when a trade settles from a trading bot's own account, a second wallet or an exchange, tokens arrive with no payment and returning SOL looks like a transfer. The cost estimate and the manual entry cover this; following those accounts would need per-bot work.
- It is a reporting tool, not tax advice. Every figure is traceable precisely so a tax advisor can check it.

## Roadmap

- **Phoenix SOL collateral.** Phoenix accepts SOL as collateral and converts it to other assets automatically when an
  account gets risky. Those conversions may be disposals under § 23 EStG (Anlage SO). Currently only USDC collateral is assumed.
- **More perp venues:** GMTrade.
- **Perp vs perp on one platform** (funding-rate arbitrage type 1): hedges inside one DEX, e.g. long SOL in one Phoenix
  subaccount and short in another (Phoenix cross margin nets same-market positions within an account), or long and short
  at once on Jupiter. The legs are already counted in Anlage KAP; missing is the arbitrage option in the UI and pairing
  of same-platform legs in the hedge view.
- Jupiter longs collateralized in SOL/ETH/BTC: the internal swap of collateral is not an Anlage SO disposal yet.
- Staking/airdrop income (§ 22 Nr. 3).
- CoinTracking / Blockpit CSV.
- Jupiter: parallel fetching for paid RPC.
