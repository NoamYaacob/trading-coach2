/**
 * Pure round-trip trade reconstruction from broker fills.
 *
 * Each `NormalizedTradeEvent` is a single broker fill (entry, scale-in, or
 * exit).  A "round-trip trade" is a position that opened from flat, was
 * possibly grown/reduced, and returned to flat.  We reconstruct these by
 * walking fills chronologically per contract and matching exits against
 * earlier entries using FIFO.
 *
 * Used by the /trades page and the dashboard "Today's trades" panel.  Pure
 * function — no DB, no I/O, safe for unit tests.
 */

import { classifyFill, normalizeSide } from "../guardian-engine/fill-classifier.ts";

export type FillInput = {
  id: string;
  externalTradeId: string | null;
  contractId: number | null;
  side: string | null;
  quantity: string | null;
  price: string | null;
  pnl: string | null;
  occurredAt: Date;
  rawPayload: unknown;
};

export type RoundTripTrade = {
  /** Composite id from the closing fill so React keys are stable. */
  id: string;
  /** Symbol from rawPayload.contract.name / .symbol, falls back to contractId. */
  symbol: string;
  /** Position direction at entry — "LONG" if first fill was BUY, else "SHORT". */
  side: "LONG" | "SHORT";
  /** Total contracts closed in this round trip. */
  qty: number;
  /** Volume-weighted entry price across all opening fills. */
  entryPrice: number;
  /** Volume-weighted exit price across all closing fills for this trip. */
  exitPrice: number;
  openedAt: Date;
  closedAt: Date;
  holdMs: number;
  /** Realized P&L.  Sum of broker-provided pnl on closing fills when
   *  available; otherwise computed as (exit-entry)*qty*sideMultiplier. */
  pnl: number;
  /** True if at least one closing fill had a non-null broker pnl. */
  pnlSource: "broker" | "computed";
};

type OpenLot = {
  qty: number;
  price: number;
  openedAt: Date;
};

type OpenPosition = {
  side: "LONG" | "SHORT";
  lots: OpenLot[];
  /** Symbol captured from the first opening fill — preferred over the closing
   *  fill's symbol since "what was traded" is determined at entry. */
  symbol: string;
};

function extractSymbol(fill: FillInput): string {
  const payload = fill.rawPayload as
    | { contract?: { name?: string; symbol?: string }; symbol?: string; contractName?: string }
    | null
    | undefined;
  return (
    payload?.contract?.name ??
    payload?.contract?.symbol ??
    payload?.symbol ??
    payload?.contractName ??
    (fill.contractId != null ? `#${fill.contractId}` : "—")
  );
}

function contractKey(fill: FillInput): string {
  if (fill.contractId != null) return `cid:${fill.contractId}`;
  const payload = fill.rawPayload as { symbol?: string } | null;
  return `sym:${payload?.symbol ?? "unknown"}`;
}

/**
 * Reconstruct round-trip trades from a chronological list of fills.
 *
 * Fills are sorted by occurredAt + externalTradeId for stable ordering when
 * two fills share a timestamp.  Per contract, lots are tracked FIFO: each
 * entry fill enqueues a lot, each exit fill consumes lots from the front of
 * the queue.  When the position returns to flat, a round-trip is emitted.
 *
 * Reversals (sign flip without touching flat) close the existing position
 * and open a new one in the opposite direction with the remaining quantity.
 */
export function reconstructRoundTrips(fills: FillInput[]): RoundTripTrade[] {
  const sorted = [...fills].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    const aId = a.externalTradeId != null ? Number(a.externalTradeId) : 0;
    const bId = b.externalTradeId != null ? Number(b.externalTradeId) : 0;
    return aId - bId;
  });

  const positions = new Map<string, OpenPosition>();
  const trades: RoundTripTrade[] = [];

  for (const fill of sorted) {
    const side = normalizeSide(fill.side);
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(price)) continue;

    const key = contractKey(fill);
    const open = positions.get(key);
    const netBefore = open
      ? open.lots.reduce((s, l) => s + l.qty, 0) * (open.side === "LONG" ? 1 : -1)
      : 0;
    const cls = classifyFill(netBefore, side, qty);
    const symbol = extractSymbol(fill);
    const brokerPnl = fill.pnl != null ? Number(fill.pnl) : null;

    if (cls === "entry") {
      positions.set(key, {
        side: side === "BUY" ? "LONG" : "SHORT",
        lots: [{ qty, price, openedAt: fill.occurredAt }],
        symbol,
      });
      continue;
    }

    if (cls === "scale_in" && open) {
      open.lots.push({ qty, price, openedAt: fill.occurredAt });
      continue;
    }

    if (cls === "reduction" && open) {
      let remaining = qty;
      let consumedQty = 0;
      let entryWeighted = 0;
      let earliestOpen: Date | null = null;

      while (remaining > 0 && open.lots.length > 0) {
        const lot = open.lots[0]!;
        const take = Math.min(remaining, lot.qty);
        consumedQty += take;
        entryWeighted += lot.price * take;
        if (earliestOpen == null || lot.openedAt < earliestOpen) earliestOpen = lot.openedAt;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty === 0) open.lots.shift();
      }

      const sideMul = open.side === "LONG" ? 1 : -1;
      const entryPriceAvg = consumedQty > 0 ? entryWeighted / consumedQty : 0;
      const computedPnl = (price - entryPriceAvg) * consumedQty * sideMul;

      trades.push({
        id: `${key}-${fill.id}`,
        symbol: open.symbol,
        side: open.side,
        qty: consumedQty,
        entryPrice: entryPriceAvg,
        exitPrice: price,
        openedAt: earliestOpen ?? fill.occurredAt,
        closedAt: fill.occurredAt,
        holdMs: fill.occurredAt.getTime() - (earliestOpen?.getTime() ?? fill.occurredAt.getTime()),
        pnl: brokerPnl != null ? brokerPnl : computedPnl,
        pnlSource: brokerPnl != null ? "broker" : "computed",
      });

      if (open.lots.length === 0) positions.delete(key);
      continue;
    }

    if (cls === "reversal" && open) {
      const openQty = open.lots.reduce((s, l) => s + l.qty, 0);
      let closeRemaining = openQty;
      let entryWeighted = 0;
      let earliestOpen: Date | null = null;

      for (const lot of open.lots) {
        entryWeighted += lot.price * lot.qty;
        if (earliestOpen == null || lot.openedAt < earliestOpen) earliestOpen = lot.openedAt;
      }

      const sideMul = open.side === "LONG" ? 1 : -1;
      const entryPriceAvg = openQty > 0 ? entryWeighted / openQty : 0;
      const computedPnl = (price - entryPriceAvg) * openQty * sideMul;

      trades.push({
        id: `${key}-${fill.id}-rev`,
        symbol: open.symbol,
        side: open.side,
        qty: openQty,
        entryPrice: entryPriceAvg,
        exitPrice: price,
        openedAt: earliestOpen ?? fill.occurredAt,
        closedAt: fill.occurredAt,
        holdMs: fill.occurredAt.getTime() - (earliestOpen?.getTime() ?? fill.occurredAt.getTime()),
        pnl: brokerPnl != null ? brokerPnl : computedPnl,
        pnlSource: brokerPnl != null ? "broker" : "computed",
      });

      // Opened a new opposite-side position with the remaining quantity.
      closeRemaining = qty - openQty;
      positions.set(key, {
        side: side === "BUY" ? "LONG" : "SHORT",
        lots: [{ qty: closeRemaining, price, openedAt: fill.occurredAt }],
        symbol,
      });
      continue;
    }
  }

  return trades;
}
