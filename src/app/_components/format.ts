import { berlinDate } from "@/lib/core/time";

export const eur = (x: number) => x.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const usd = (x: number) => x.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
/** Calendar day in German local time, matching the tax year the row is counted in. */
export const day = (iso: string | null) => (iso ? berlinDate(iso) : "—");

export const card = "rounded-xl border border-line bg-panel p-5 shadow-sm";
export const button = "rounded-md border border-line bg-panel px-3 py-2 text-sm shadow-xs hover:bg-hover outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50";
export const input = "rounded-md border border-line bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/50";
