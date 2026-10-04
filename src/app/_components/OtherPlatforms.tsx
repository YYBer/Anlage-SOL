import { button, card, input } from "./format";

/** Inputs stay strings so half-typed numbers like "12," survive re-renders. */
export interface OtherRow {
  label: string;
  gains: string;
  losses: string;
}

const storageKey = (wallet: string, year: number) => `anlage-sol:others:${wallet}:${year}`;

export function loadOthers(wallet: string, year: number): OtherRow[] {
  try {
    const raw = localStorage.getItem(storageKey(wallet, year));
    return raw ? (JSON.parse(raw) as OtherRow[]) : [];
  } catch {
    return [];
  }
}

export function saveOthers(wallet: string, year: number, rows: OtherRow[]) {
  try {
    localStorage.setItem(storageKey(wallet, year), JSON.stringify(rows));
  } catch {
    // Private mode or storage disabled: entries just won't be remembered.
  }
}

export function OtherPlatforms({ rows, onChange }: { rows: OtherRow[]; onChange: (rows: OtherRow[]) => void }) {
  const update = (i: number, patch: Partial<OtherRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const hasValues = rows.some((r) => r.gains.trim() || r.losses.trim());

  return (
    <section className={card}>
      <h2 className="text-sm font-medium">Other platforms</h2>
      <p className="mt-1 text-xs text-muted">
        Perp or futures results from platforms we don&apos;t read (Hyperliquid, Lighter, a foreign exchange), e.g. the other leg of a cross-platform funding
        trade. Take gains and losses in EUR from that platform&apos;s report; they go into the same KAP lines. Leave out German brokers that already withheld
        tax.
      </p>

      {rows.length > 0 && (
        <div className="mt-4 grid gap-2">
          <div className="hidden grid-cols-[1fr_9rem_9rem_2.5rem] gap-2 text-xs text-muted sm:grid">
            <span>Platform</span>
            <span>Gains €</span>
            <span>Losses €</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_9rem_9rem_2.5rem]">
              <input
                value={r.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="e.g. Hyperliquid"
                aria-label="Platform"
                className={`${input} col-span-2 sm:col-span-1`}
              />
              <input
                value={r.gains}
                onChange={(e) => update(i, { gains: e.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Gains in EUR"
                className={`${input} text-right font-mono`}
              />
              <input
                value={r.losses}
                onChange={(e) => update(i, { losses: e.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                aria-label="Losses in EUR"
                className={`${input} text-right font-mono`}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label="Remove platform"
                className={`${button} col-span-2 text-muted sm:col-span-1`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button type="button" onClick={() => onChange([...rows, { label: "", gains: "", losses: "" }])} className={`${button} mt-4`}>
        Add platform
      </button>
      {hasValues && <p className="mt-3 text-xs text-muted">Entered by you, not verified on-chain. Keep that platform&apos;s report as proof.</p>}
    </section>
  );
}
