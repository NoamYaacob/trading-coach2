// In-memory sliding-window rate limiter.
// Not suitable for multi-instance deploys — each process has its own store.
// For horizontal scale, replace checkRateLimit with a Redis/Upstash adapter
// behind the same interface.

const store = new Map<string, number[]>();
let lastPrune = Date.now();

function prune(): void {
  const now = Date.now();
  for (const [key, timestamps] of store.entries()) {
    // Keep timestamps up to 1 hour; window-specific filtering happens in checkRateLimit.
    const kept = timestamps.filter((t) => now - t < 3_600_000);
    if (kept.length === 0) {
      store.delete(key);
    } else {
      store.set(key, kept);
    }
  }
  lastPrune = now;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Sliding-window rate limit check.
 *
 * Returns ok:false (with a retry hint) if `key` has already been seen
 * `limit` or more times within the last `windowMs` milliseconds.
 * Records the current request on ok:true.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  if (now - lastPrune > 60_000) prune();

  const all = store.get(key) ?? [];
  const inWindow = all.filter((t) => now - t < windowMs);

  if (inWindow.length >= limit) {
    store.set(key, inWindow);
    const oldest = inWindow[0];
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000),
    };
  }

  inWindow.push(now);
  store.set(key, inWindow);
  return { ok: true };
}

/** Extract the client IP from a proxied request. */
export function getRequestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
