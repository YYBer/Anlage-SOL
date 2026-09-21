// Shared, self-adjusting request budget per RPC endpoint. Jupiter and spot history run at the same time
// against the same RPC; one limiter per URL keeps their combined rate under the provider's limit.
// Measured 2026-09: Solana's public RPC sustains only ~1 getTransaction per second per IP.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Halve the rate after a 429. */
  limited(): void;
  /** Creep the rate back up after a success. */
  ok(): void;
  /** Current requests per second, for progress estimates. */
  rate(): number;
}

export function createLimiter(opts: { concurrency: number; start: number; min: number; max: number }): Limiter {
  let active = 0;
  let nextSlot = 0;
  let perSecond = opts.start;
  const queue: (() => void)[] = [];

  return {
    async run(fn) {
      if (active >= opts.concurrency) await new Promise<void>((r) => queue.push(r));
      active++;
      try {
        // Space out request starts evenly instead of bursting.
        const now = Date.now();
        const start = Math.max(now, nextSlot);
        nextSlot = start + 1000 / perSecond;
        if (start > now) await sleep(start - now);
        return await fn();
      } finally {
        active--;
        queue.shift()?.();
      }
    },
    limited() {
      perSecond = Math.max(opts.min, perSecond / 2);
      // Everyone waits a moment so the provider's window can reset.
      nextSlot = Math.max(nextSlot, Date.now() + 2000);
    },
    ok() {
      perSecond = Math.min(opts.max, perSecond + 0.05);
    },
    rate: () => perSecond,
  };
}

const byUrl = new Map<string, Limiter>();

export const isPublicRpc = (rpcUrl: string) => rpcUrl.includes("api.mainnet-beta.solana.com");

export function rpcLimiter(rpcUrl: string): Limiter {
  let l = byUrl.get(rpcUrl);
  if (!l) {
    l = isPublicRpc(rpcUrl)
      ? createLimiter({ concurrency: 3, start: 0.9, min: 0.3, max: 1.4 })
      : createLimiter({ concurrency: 16, start: 10, min: 2, max: 50 });
    byUrl.set(rpcUrl, l);
  }
  return l;
}

const isRateLimit = (e: unknown) => /429|too many requests/i.test(String((e as Error)?.message ?? e));

/**
 * Runs an RPC call through the limiter. 429s slow the whole limiter down and retry without the long
 * exponential sleeps that stall a batch; other errors retry a few times with backoff.
 */
export async function limitedCall<T>(limiter: Limiter, fn: () => Promise<T>): Promise<T> {
  let rateLimits = 0;
  let failures = 0;
  for (;;) {
    try {
      const r = await limiter.run(fn);
      limiter.ok();
      return r;
    } catch (e) {
      if (isRateLimit(e)) {
        limiter.limited();
        if (++rateLimits > 30) throw e;
      } else {
        if (++failures >= 5) throw e;
        await sleep(1000 * 2 ** failures);
      }
    }
  }
}

/** Maps with the limiter's pacing, reporting each completed item. Results keep input order. */
export async function mapLimited<T, R>(items: T[], limiter: Limiter, fn: (item: T) => Promise<R>, onDone?: (done: number) => void): Promise<R[]> {
  let done = 0;
  return Promise.all(
    items.map((item) =>
      limitedCall(limiter, () => fn(item)).then((r) => {
        onDone?.(++done);
        return r;
      }),
    ),
  );
}
