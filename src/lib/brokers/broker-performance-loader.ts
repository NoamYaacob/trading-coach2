import { cache } from "react";

import { TradovateClient } from "@/lib/brokers/tradovate-client";
import type { BrokerAccountPerformance } from "@/lib/brokers/tradovate-client";

/**
 * Result of loading broker Account-Balance-History performance.
 *
 * The loader NEVER rejects — it resolves to a discriminated union so consumers
 * can render an honest "temporarily unavailable" state on failure instead of
 * crashing a Suspense boundary or, worse, silently falling back to wrong
 * fill-only data. ABH remains the source of truth whenever `status === "ok"`.
 */
export type BrokerPerfResult =
  | { status: "ok"; perf: BrokerAccountPerformance }
  | { status: "error" };

/**
 * Load broker Account-Balance-History performance for an account.
 *
 * Wrapped in React's `cache()` so that multiple sibling `<Suspense>` children
 * on the same page (KPI cards, equity curve, calendar, trader insights) share a
 * SINGLE ABH fetch per server request instead of issuing one each.
 *
 * This call is intentionally NOT time-capped — ABH is the source of truth and
 * must run to completion. It is kept off the page's blocking render path by
 * being awaited inside Suspense boundaries, so a slow ABH (3–8s) streams in
 * after the static shell paints rather than blocking navigation.
 *
 * Emits a structured timing line on every call (success or failure):
 *   [perf] route=<route> step=broker-performance ms=<duration> accountId=<id>
 */
export const loadBrokerPerformance = cache(
  async (
    route: string,
    accountId: string,
    userId: string,
  ): Promise<BrokerPerfResult> => {
    const start = Date.now();
    try {
      const client = new TradovateClient(accountId, userId);
      await client.initialize();
      const perf = await client.getHistoricalAccountPerformance();
      console.info(
        `[perf] route=${route} step=broker-performance ms=${Date.now() - start} accountId=${accountId}`,
      );
      return { status: "ok", perf };
    } catch (err) {
      console.warn(
        `[perf] route=${route} step=broker-performance ms=${Date.now() - start} accountId=${accountId} error=${err instanceof Error ? err.message : String(err)}`,
      );
      return { status: "error" };
    }
  },
);
