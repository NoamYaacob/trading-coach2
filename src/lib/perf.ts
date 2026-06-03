/**
 * Server-render performance helpers.
 *
 * Pure, dependency-free, safe for unit tests. Used to keep slow broker/report
 * calls from blocking Next.js server-component navigation: every slow call is
 * wrapped so it either resolves quickly or rejects on a hard timeout, letting
 * the page render a safe fallback instead of freezing for ~10s.
 */

/**
 * Race a promise against a hard timeout. Rejects with a timeout Error (and logs
 * a structured `[perf] timeout` line) when `ms` elapses before the promise
 * settles. The timer is always cleared so a slow promise can't keep the event
 * loop alive after the race resolves.
 *
 * Callers MUST catch the rejection and fall back to a safe default — never let
 * a timeout throw the page.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      console.warn(`[perf] timeout label=${label} ms=${ms}`);
      reject(new Error(`timeout: ${label} exceeded ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Time an async data step and emit a structured server log:
 *   [perf] route=<route> step=<step> ms=<duration> accountId=<id>
 * Always logs (success or throw) so a slow/blocking step is visible in prod.
 */
export async function timed<T>(
  route: string,
  step: string,
  accountId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.info(
      `[perf] route=${route} step=${step} ms=${Date.now() - start} accountId=${accountId ?? "—"}`,
    );
  }
}
