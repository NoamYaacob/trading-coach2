import { classifyFill } from "./fill-classifier.ts";

/** Minimal fill shape consumed by deriveCanonicalEntryCount. */
export type CanonicalFill = {
  externalTradeId: string | null;
  contractId: number | null;
  side: string | null;
  quantity: string | null;
  occurredAt: Date;
  rawPayload: unknown;
};

/**
 * Pure, DB-free entry-count function.
 *
 * Accepts fill records from any storage path (webhook "trade_closed*" or sync
 * "fill"), deduplicates them by externalTradeId, groups by contract, and
 * counts only position entries using position-aware classification.
 *
 * Exported for unit testing; production callers use countCanonicalEntries()
 * in session-state.ts.
 */
export function deriveCanonicalEntryCount(fills: CanonicalFill[]): number {
  // Deduplicate by externalTradeId. When two records share an ID (one "fill"
  // from sync, one "trade_closed*" from webhook), keep whichever has contractId
  // since it provides better per-contract grouping.
  const byExtId = new Map<string, CanonicalFill>();
  const noIdFills: CanonicalFill[] = [];
  for (const fill of fills) {
    if (!fill.externalTradeId) {
      noIdFills.push(fill);
      continue;
    }
    const existing = byExtId.get(fill.externalTradeId);
    if (!existing || (fill.contractId != null && existing.contractId == null)) {
      byExtId.set(fill.externalTradeId, fill);
    }
  }
  const deduped = [...byExtId.values(), ...noIdFills].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  // Group by contract. Prefer numeric contractId; fall back to symbol from rawPayload
  // (the sync path stores symbol in rawPayload when contractId is unavailable).
  const byContract = new Map<string, CanonicalFill[]>();
  for (const fill of deduped) {
    let key: string;
    if (fill.contractId != null) {
      key = `cid:${fill.contractId}`;
    } else {
      const payload = fill.rawPayload as { symbol?: string } | null;
      key = `sym:${payload?.symbol ?? "unknown"}`;
    }
    const group = byContract.get(key);
    if (group) {
      group.push(fill);
    } else {
      byContract.set(key, [fill]);
    }
  }

  let entryCount = 0;
  for (const [, group] of byContract) {
    let position = 0;
    for (const fill of group) {
      const side = fill.side as "BUY" | "SELL";
      const qty = Number(fill.quantity);
      const cls = classifyFill(position, side, qty);
      if (cls === "entry" || cls === "reversal") entryCount++;
      position += side === "BUY" ? qty : -qty;
    }
  }
  return entryCount;
}
