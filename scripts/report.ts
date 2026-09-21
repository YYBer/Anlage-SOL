// Usage: npx tsx scripts/report.ts <wallet> [--year 2026] [--protocols phoenix,jupiter] [--funding separate|include] [--out dir] [--max-sigs N]
//   [--no-spot] [--spot-max-sigs N]  (Anlage SO from the wallet's swaps is on by default)
//   [--other "Hyperliquid:120.50:40"]  (repeatable: label:gainsEur:lossesEur from another platform's report)
// Jupiter reads SOLANA_RPC_URL; the public RPC works but is slow and rate limited.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Protocol } from "../src/lib/core/types";
import { toDto } from "../src/lib/dto";
import { koinlyCsv, ledgerCsv, positionsCsv } from "../src/lib/export/csv";
import { buildReceipt } from "../src/lib/export/pdf";
import { germanyReport, germanySoReport } from "../src/lib/report";
import type { FundingMode } from "../src/lib/tax/germany";
import { combineKap, type OtherSource } from "../src/lib/tax/kap";
import { berlinYear } from "../src/lib/core/time";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const walletArg = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!walletArg) {
  console.error("usage: tsx scripts/report.ts <wallet> [--year 2026] [--protocols phoenix,jupiter] [--funding separate|include] [--out dir]");
  process.exit(1);
}
const wallet: string = walletArg;
const year = Number(flag("year", String(berlinYear(new Date()))));
const protocols = flag("protocols", "phoenix,jupiter").split(",") as Protocol[];
const fundingMode = flag("funding", "separate") as FundingMode;
const out = flag("out", "out");
const maxSigs = Number(flag("max-sigs", "5000"));
const spot = !args.includes("--no-spot");
const spotMaxSigs = Number(flag("spot-max-sigs", "3000"));
const others: OtherSource[] = args
  .flatMap((a, i) => (a === "--other" ? [args[i + 1]] : []))
  .map((spec) => {
    const [label, gains, losses] = spec.split(":");
    return { label, gainsEur: Number(gains) || 0, lossesEur: Number(losses) || 0 };
  });

async function main() {
  const { history, fx, report } = await germanyReport(wallet, year, protocols, fundingMode, { jupiter: { maxSignaturesPerSlot: maxSigs } });
  const eur = (x: number) => x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  console.log(`\n${wallet} · Steuerjahr ${year} · ${protocols.join("+")} · Funding: ${fundingMode}`);
  console.log(`fills=${history.fills.length} funding=${history.funding.length} collateral=${history.collateral.length}`);
  const open = report.positions.filter((r) => r.openAtYearEnd).length;
  const realizations = report.positions.reduce((s, r) => s + r.realizations.length, 0);
  console.log(`Positionen mit Realisierung ${year}: ${report.positions.length} (davon offen: ${open}), Glattstellungen: ${realizations}\n`);
  const total = combineKap(report.kap, others);
  console.log(`Anlage KAP Zeile ${report.kap.lineForeignIncome}: ${eur(total.foreignIncomeEur)}`);
  console.log(`Anlage KAP Zeile ${report.kap.lineContainedLosses}: ${eur(total.containedLossesEur)}`);
  console.log(`  On-chain: Gewinne ${eur(report.kap.gainsEur)}, Verluste ${eur(report.kap.lossesEur)}`);
  for (const o of others) console.log(`  ${o.label} (Nutzerangabe): Gewinne ${eur(o.gainsEur)}, Verluste ${eur(o.lossesEur)}`);
  if (fundingMode === "separate") {
    console.log(`Funding separat: erhalten ${eur(report.fundingSeparate.receivedEur)}, gezahlt ${eur(report.fundingSeparate.paidEur)}`);
  }
  for (const note of report.notes) console.log(`! ${note}`);

  mkdirSync(out, { recursive: true });
  const base = join(out, `${wallet.slice(0, 8)}-${year}`);
  writeFileSync(`${base}-positions.csv`, positionsCsv(report));
  writeFileSync(`${base}-ledger.csv`, ledgerCsv(report, fx));
  writeFileSync(`${base}-koinly.csv`, koinlyCsv(history.fills.filter((f) => berlinYear(f.time) === year), report.funding.map((f) => f.payment)));
  let so = null;
  if (spot) {
    so = await germanySoReport(wallet, year, { maxSignatures: spotMaxSigs });
    console.log(`\nAnlage SO ${year}: ${so.disposals.length} Veräußerungen`);
    for (const l of so.lines) console.log(`  Zeile ${l.line} ${l.label}: ${l.value}`);
    console.log(`  steuerfreie Gewinne (> 1 Jahr): ${eur(so.taxFreeGainEur)}`);
    for (const w of so.warnings) console.log(`! ${w}`);
  }

  const dto = toDto(history, fx, report);
  const pdf = buildReceipt({ report: dto, totals: combineKap(report.kap, others), others, so });
  writeFileSync(`${base}-nachweis.pdf`, Buffer.from(pdf.output("arraybuffer")));
  console.log(`\nCSV → ${base}-{positions,ledger,koinly}.csv`);
  console.log(`PDF → ${base}-nachweis.pdf`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
