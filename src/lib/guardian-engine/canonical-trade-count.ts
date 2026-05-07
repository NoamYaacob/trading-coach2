import { classifyFill, normalizeSide } from "./fill-classifier.ts";

/** Minimal fill shape consumed by deriveCanonicalEntryCount. */
export type CanonicalFill = {
  externalTradeId: string | null;
  contractId: number | null;
  side: string | null;
  quantity: string | null;
  /** Execution price — used as a tiebreaker in the stable sort and as part of
   *  the composite dedup key for fills that lack an externalTradeId. */
  price: string | null;
  occurredAt: Date;
  rawPayload: unknown;
};

/**
 * Stable composite dedup key for fills that lack an externalTradeId.
 * Two fills with the same contract + time + side + qty + price are treated as
 * the same physical execution even without a broker-assigned ID.
 */
function compositeKey(f: CanonicalFill): string {
  return [
    String(f.contractId ?? ""),
    f.occurredAt.toISOString(),
    f.side ?? "",
    f.quantity ?? "",
    f.price ?? "",
  ].join("|");
}

/**
 * Pure, DB-free entry-count function.
 *
 * Accepts fill records from any storage path (webhook "trade_closed*" or sync
 * "fill"), deduplicates them, groups by contract, and counts only position
 * entries using position-aware classification.
 *
 * Tradovate's "# of Trades" = number of times a position opened from flat.
 * Scale-ins (adding to an existing non-flat position) are NOT counted.
 * Reversals (position flips sign without touching flat) count as a new trade.
 *
 * Exported for unit testing; production callers use countCanonicalEntries()
 * in session-state.ts.
 */
export function deriveCanonicalEntryCount(fills: CanonicalFill[]): number {
  // Deduplicate fills with an externalTradeId.
  // When two records share an ID (one "fill" from sync, one "trade_closed*"
  // from webhook), keep whichever has contractId for better grouping.
  const byExtId = new Map<string, CanonicalFill>();
  // Deduplicate fills that lack an externalTradeId via composite key.
  const noIdSeen = new Set<string>();
  const noIdFills: CanonicalFill[] = [];

  for (const fill of fills) {
    if (!fill.externalTradeId) {
      const key = compositeKey(fill);
      if (!noIdSeen.has(key)) {
        noIdSeen.add(key);
        noIdFills.push(fill);
      }
      continue;
    }
    const existing = byExtId.get(fill.externalTradeId);
    if (!existing || (fill.contractId != null && existing.contractId == null)) {
      byExtId.set(fill.externalTradeId, fill);
    }
  }

  // Sort deterministically: primary by occurredAt, secondary by numeric fill ID
  // (Tradovate assigns monotonically increasing IDs), tertiary by price.
  // Stable ordering is critical when two fills share the same timestamp —
  // without it, entry fills from separate round trips can be reordered into
  // a BUY+BUY+SELL+SELL sequence that makes the second BUY look like a scale_in.
  const deduped = [...byExtId.values(), ...noIdFills].sort((a, b) => {
    const timeDiff = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    const aId = a.externalTradeId != null ? Number(a.externalTradeId) : Infinity;
    const bId = b.externalTradeId != null ? Number(b.externalTradeId) : Infinity;
    if (aId !== bId) return aId - bId;
    return (Number(a.price) || 0) - (Number(b.price) || 0);
  });

  // Group by contract. Prefer numeric contractId; fall back to symbol from
  // rawPayload (the sync path stores symbol in rawPayload when contractId is
  // unavailable for legacy fills stored before the contractId fix).
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

  // Count entries per contract using position-aware classification.
  // Only "entry" (flat→non-flat) and "reversal" (sign flip) count.
  // Scale-ins (growing an existing position) do NOT count — this matches
  // Tradovate's Performance Report "# of Trades" definition.
  let entryCount = 0;
  for (const [, group] of byContract) {
    let position = 0;
    for (const fill of group) {
      const side = normalizeSide(fill.side);
      const qty = Number(fill.quantity);
      const cls = classifyFill(position, side, qty);
      if (cls === "entry" || cls === "reversal") entryCount++;
      position += side === "BUY" ? qty : -qty;
    }
  }
  return entryCount;
}
