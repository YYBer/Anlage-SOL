import type { Progress, ProgressSource } from "@/lib/core/progress";

const LABELS: Record<ProgressSource, string> = {
  phoenix: "Phoenix",
  jupiter: "Jupiter Perps",
  pacifica: "Pacifica",
  spot: "Spot history",
  prices: "Token prices",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Fixed to the bottom of the viewport so the user sees progress wherever they are on the page,
 * without the page scrolling or resizing.
 */
export function ProgressPanel({ steps, elapsed }: { steps: Progress[]; elapsed: number }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-panel/95 px-4 py-3 shadow-lg backdrop-blur">
      <div className="mx-auto grid max-w-5xl gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
            Generating report…
          </span>
          <span className="font-mono text-xs text-muted tabular-nums">{clock(elapsed)}</span>
        </div>
        {steps.length === 0 && <p className="text-xs text-muted">Starting…</p>}
        {steps.map((p) => {
          const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : null;
          return (
            <div key={p.source} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span>
                  <span className={p.finished ? "text-good" : ""}>{p.finished ? "✓" : "•"}</span> {LABELS[p.source]}{" "}
                  <span className="text-muted">{p.message}</span>
                </span>
                {p.total ? (
                  <span className="font-mono text-muted tabular-nums">
                    {p.done}/{p.total}
                    {!p.finished && p.etaSeconds ? ` · ~${clock(p.etaSeconds)} left` : ""}
                  </span>
                ) : null}
              </div>
              {pct !== null && !p.finished && (
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
