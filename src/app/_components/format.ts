import { berlinDate } from "@/lib/core/time";

export const eur = (x: number) => x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** Calendar day in German local time, matching the tax year the row is counted in. */
export const day = (iso: string | null) => (iso ? berlinDate(iso) : "—");

export const card = "rounded-xl border border-line bg-panel p-5";
export const button = "rounded-lg border border-line px-3 py-2 text-sm hover:bg-hover";
export const input = "rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";
