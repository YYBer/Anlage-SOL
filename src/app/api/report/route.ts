import { PublicKey } from "@solana/web3.js";
import type { Progress } from "@/lib/core/progress";
import { berlinYear } from "@/lib/core/time";
import type { Protocol } from "@/lib/core/types";
import { toDto, type ReportStreamLine } from "@/lib/dto";
import { germanyReport, germanySoReport } from "@/lib/report";
import type { FundingMode } from "@/lib/tax/germany";

// Jupiter and spot history over RPC can take a while.
export const maxDuration = 300;

const PROTOCOLS: Protocol[] = ["phoenix", "jupiter"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    wallet?: string;
    year?: number;
    protocols?: string[];
    fundingMode?: string;
    /** Anlage SO from the wallet's spot swaps; on unless explicitly false. */
    spot?: boolean;
  } | null;

  // Input errors come back as plain JSON with a 400 before any streaming starts.
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
  // By default everything is read: users shouldn't have to know which venues they used, and a missed one
  // would silently understate the report. `protocols` / `spot` stay as overrides for debugging.
  const protocols = (body?.protocols ?? PROTOCOLS).filter((p): p is Protocol => PROTOCOLS.includes(p as Protocol));
  const spot = body?.spot ?? true;
  if (!protocols.length && !spot) return Response.json({ error: "Nothing to read" }, { status: 400 });
  const fundingMode: FundingMode = body?.fundingMode === "include" ? "include" : "separate";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: ReportStreamLine) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      const onProgress = (progress: Progress) => send({ type: "progress", progress });
      try {
        // Perps usually finish first (Phoenix is an API) and go out as a partial result. Spot lists the wallet's
        // transactions in parallel, then skips the ones perps already identified as fills.
        const perpsPromise = germanyReport(wallet, year, protocols, fundingMode, { onProgress });
        const perpSignatures = perpsPromise
          .then((p) => new Set(p.history.fills.map((f) => f.signature).filter((sig): sig is string => !!sig)))
          .catch(() => new Set<string>());
        const soPromise = spot
          ? germanySoReport(wallet, year, { onProgress, skipSignatures: perpSignatures }).catch((e: Error) => ({ error: e.message }))
          : Promise.resolve(null);
        const perps = await perpsPromise;
        const dto = toDto(perps.history, perps.fx, perps.report);
        if (spot) send({ type: "partial", report: { ...dto, soPending: true } });
        const so = await soPromise;
        send({ type: "result", report: so && "error" in so ? { ...dto, so: null, soError: so.error } : { ...dto, so } });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
