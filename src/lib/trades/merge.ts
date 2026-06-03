/**
 * Pure helpers for merging imported DB fills with broker historical
 * Fills-report fills, and converting report rows into the reconstruction
 * input shape.
 *
 * Kept separate from load.ts (which imports prisma) so these can be unit-tested
 * without a database. load.ts re-exports them for callers.
 *
 * Pure — no DB, no I/O, safe for unit tests.
 */

import {
  reconstructRoundTrips,
  buildContractIdMap,
  type FillInput,
  type RoundTripTrade,
} from "./round-trips.ts";
import type { HistoricalFillRow } from "../brokers/tradovate-fills-report.ts";

/**
 * Convert parsed broker Fills-report rows into the pure `FillInput` shape so
 * they can be reconstructed into round-trip trades exactly like imported fills.
 *
 * The Fills report carries no per-fill P&L or commission, so `pnl` is null
 * (reconstruction computes gross P&L from entry/exit prices) and fees stay
 * unavailable. The contract symbol is placed in `rawPayload.symbol` so symbol
 * resolution and FIFO bucketing key off it (the report has no numeric
 * contractId). `externalTradeId` carries the broker fillId — the stable
 * identifier used for dedupe against imported fills.
 */
export function historicalFillsToFillInputs(rows: HistoricalFillRow[]): FillInput[] {
  return rows.map((r) => ({
    id: `fillsreport-${r.fillId}`,
    externalTradeId: r.fillId,
    contractId: null,
    side: r.side,
    quantity: String(r.quantity),
    price: String(r.price),
    pnl: null,
    occurredAt: new Date(r.timestamp),
    rawPayload: { symbol: r.contract, orderId: r.orderId },
  }));
}

/**
 * Reconstruct round-trip trades from imported DB fills merged with broker
 * historical Fills-report fills.
 *
 * Dedupe is at the FILL level by stable broker fill id: any historical report
 * fill whose `externalTradeId` (fillId) already exists among the imported DB
 * fills is dropped, so a trade present in both streams is reconstructed once.
 * The deduped union is reconstructed together (a single FIFO pass) so a
 * round-trip whose entry came from one stream and exit from the other still
 * pairs correctly.
 *
 * Returns trades newest-first for display.
 */
export function reconstructMergedTrades(
  dbFills: FillInput[],
  historicalFills: FillInput[],
): RoundTripTrade[] {
  const seen = new Set<string>();
  for (const f of dbFills) {
    if (f.externalTradeId) seen.add(f.externalTradeId);
  }
  const dedupedHistorical = historicalFills.filter(
    (f) => !(f.externalTradeId && seen.has(f.externalTradeId)),
  );

  const all = [...dbFills, ...dedupedHistorical];
  const contractIdMap = buildContractIdMap(all);
  const trades = reconstructRoundTrips(all, contractIdMap);
  return trades.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
}
