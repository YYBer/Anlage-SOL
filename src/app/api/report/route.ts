import { PublicKey } from "@solana/web3.js";
import type { Protocol } from "@/lib/core/types";
import { toDto } from "@/lib/dto";
import { germanyReport, germanySoReport } from "@/lib/report";
import type { FundingMode } from "@/lib/tax/germany";
import { berlinYear } from "@/lib/core/time";

// Jupiter history over RPC can take a while.
export const maxDuration = 300;

const PROTOCOLS: Protocol[] = ["phoenix", "jupiter"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    wallet?: string;
    year?: number;
    protocols?: string[];
    fundingMode?: string;
    /** Also compute Anlage SO from the wallet's spot swaps. */
    spot?: boolean;
  } | null;

  const wallet = body?.wallet?.trim() ?? "";
  try {
    new PublicKey(wallet);
  } catch {
    return Response.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }
  const thisYear = berlinYear(new Date());
  const year = Number(body?.year ?? thisYear);
  if (!Number.isInteger(year) || year < 2023 || year > thisYear) {
    return Response.json({ error: `Tax year must be between 2023 and ${thisYear}` }, { status: 400 });
  }
  const protocols = (body?.protocols ?? ["phoenix"]).filter((p): p is Protocol => PROTOCOLS.includes(p as Protocol));
  if (!protocols.length && !body?.spot) return Response.json({ error: "Select at least one protocol or spot trading" }, { status: 400 });
  const fundingMode: FundingMode = body?.fundingMode === "include" ? "include" : "separate";

  try {
    // Perps and spot read different data; run them side by side. A failed SO run is reported, not fatal.
    const [perps, so] = await Promise.all([
      germanyReport(wallet, year, protocols, fundingMode),
      body?.spot ? germanySoReport(wallet, year).catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
    ]);
    const dto = toDto(perps.history, perps.fx, perps.report);
    if (so && "error" in so) return Response.json({ ...dto, so: null, soError: so.error });
    return Response.json({ ...dto, so });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
