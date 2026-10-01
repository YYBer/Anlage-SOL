import { useState } from "react";
import type { CostOverride, TransferInDto } from "@/lib/tax/so-dto";
import { parseEur } from "@/lib/format";
import { card, day, eur, input } from "./format";

/** Raw inputs, kept as typed so half-entered values survive re-renders. */
export interface OverrideInput {
  cost: string;
  date: string;
}

const storageKey = (wallet: string) => `perpelster:basis:${wallet}`;

// Purchase prices belong to the wallet, not to a tax year: a 2024 purchase matters for 2026 sales too.
export function loadOverrides(wallet: string): Record<string, OverrideInput> {
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    return raw ? (JSON.parse(raw) as Record<string, OverrideInput>) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(wallet: string, values: Record<string, OverrideInput>) {
  try {
    localStorage.setItem(storageKey(wallet), JSON.stringify(values));
  } catch {
    // Private mode or storage disabled: entries just won't be remembered.
  }
}

/** Only rows with a cost count; the date is optional (defaults to the arrival date). */
export function toOverrides(values: Record<string, OverrideInput>): Record<string, CostOverride> {
  const out: Record<string, CostOverride> = {};
  for (const [key, v] of Object.entries(values)) {
    if (!v.cost.trim()) continue;
    out[key] = { costEur: parseEur(v.cost), acquiredOn: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : undefined };
  }
  return out;
}

const amount = (x: number) => x.toLocaleString("de-DE", { maximumFractionDigits: x < 1 ? 6 : 2 });

export function TransfersIn({
  transfers,
  taxYear,
  values,
  onChange,
}: {
  transfers: TransferInDto[];
  taxYear: number;
  values: Record<string, OverrideInput>;
  onChange: (values: Record<string, OverrideInput>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const relevant = transfers.filter((t) => t.usedInTaxYear > 0 || values[t.key]?.cost);
  const rows = [...(showAll ? transfers : relevant)].sort((a, b) => b.usedInTaxYear - a.usedInTaxYear || a.time.localeCompare(b.time));
  const open = relevant.filter((t) => !values[t.key]?.cost.trim()).length;
  const set = (key: string, patch: Partial<OverrideInput>) => onChange({ ...values, [key]: { ...(values[key] ?? { cost: "", date: "" }), ...patch } });

  return (
    <section className={`${card} ${open ? "border-warn/60" : ""}`}>
      <h3 className="text-sm font-medium">Tokens you transferred in</h3>
      <p className="mt-1 text-xs text-muted">
        These tokens came from another wallet or an exchange, so their purchase isn&apos;t on this wallet&apos;s chain history. Until you fill them in they
        count as bought for 0 € on arrival, which overstates gains. Enter the date you originally bought them and what you paid in total: moving tokens between
        your own wallets doesn&apos;t restart the one-year holding period.
      </p>
      <p className="mt-2 text-xs">
        {relevant.length ? (
          <>
            <span className={open ? "text-warn" : "text-good"}>
              {open
                ? `${open} of ${relevant.length} transfers used by ${taxYear} sales still need a price.`
                : `All transfers used by ${taxYear} sales are filled in.`}
            </span>{" "}
          </>
        ) : (
          <span className="text-muted">None of them were used by taxable sales in {taxYear}. </span>
        )}
        {transfers.length > relevant.length && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-accent hover:underline">
            {showAll ? "Show only the ones that matter" : `Show all ${transfers.length}`}
          </button>
        )}
      </p>

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Arrived</th>
                <th className="py-2 pr-3 font-medium">Token</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th>
                <th className="py-2 pr-3 text-right font-medium">Value on arrival</th>
                <th className="py-2 pr-3 font-medium">Originally bought on</th>
                <th className="py-2 pr-3 font-medium">Total cost €</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.key} className="border-t border-line">
                  <td className="py-2 pr-3 tabular-nums">
                    <a href={`https://solscan.io/tx/${t.signature}`} target="_blank" rel="noreferrer" className="hover:underline">
                      {day(t.time)}
                    </a>
                    {t.usedInTaxYear > 0 && <span className="ml-1 text-xs text-warn">used by {t.usedInTaxYear} sales</span>}
                  </td>
                  <td className="py-2 pr-3 font-medium">{t.token}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{amount(t.amount)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-muted tabular-nums">{t.marketValueEur === null ? "—" : eur(t.marketValueEur)}</td>
                  <td className="py-2 pr-3">
                    <input
                      type="date"
                      value={values[t.key]?.date ?? ""}
                      max={t.time.slice(0, 10)}
                      onChange={(e) => set(t.key, { date: e.target.value })}
                      aria-label={`Purchase date of ${t.token} received ${day(t.time)}`}
                      className={`${input} py-1`}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={values[t.key]?.cost ?? ""}
                      onChange={(e) => set(t.key, { cost: e.target.value })}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={`Total purchase cost in EUR of ${t.token} received ${day(t.time)}`}
                      className={`${input} w-32 py-1 text-right font-mono`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Saved in this browser for this wallet. The receipt marks these rows as your own records, so keep the exchange statements that prove them.
      </p>
    </section>
  );
}
