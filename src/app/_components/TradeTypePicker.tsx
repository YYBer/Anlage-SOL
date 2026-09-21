import { ARB_KINDS, TRADE_TYPES, type ArbKind, type TradeSelection, type TradeType } from "../trade-types";

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function TradeTypePicker({ value, onChange }: { value: TradeSelection; onChange: (v: TradeSelection) => void }) {
  const setTypes = (types: TradeType[]) => onChange({ ...value, types });
  const setArb = (arbKinds: ArbKind[]) => onChange({ ...value, arbKinds });

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {TRADE_TYPES.map((t) => {
          const on = value.types.includes(t.id);
          return (
            <label
              key={t.id}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 transition-colors ${on ? "border-accent bg-accent/5" : "border-line hover:bg-hover"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={on} onChange={() => setTypes(toggle(value.types, t.id))} />
                  {t.title}
                </span>
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{t.forms}</span>
              </span>
              <span className="text-xs text-muted">{t.body}</span>
            </label>
          );
        })}
      </div>

      {value.types.includes("arbitrage") && (
        <fieldset className="grid gap-2 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-medium">Which kind of arbitrage?</legend>
          {ARB_KINDS.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input className="mt-1" type="checkbox" checked={value.arbKinds.includes(k.id)} onChange={() => setArb(toggle(value.arbKinds, k.id))} />
              <span>
                {k.title}
                <span className="block text-xs text-muted">{k.body}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
