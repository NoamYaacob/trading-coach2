/**
 * Pure resolution of a day's total P&L for the Trades-page day header.
 *
 * Priority of truth:
 *   1. Broker Cash History net (cashBalanceLog) for that day — authoritative
 *      after-fees net, even when per-trade fee allocation is unavailable.
 *   2. Sum of per-trade net — only when EVERY trade that day carried broker
 *      per-fill fees (feesAvailable).
 *   3. Sum of fill P&L BEFORE fees — labelled as such; never called "Net".
 *
 * This is how the real after-fees day net (e.g. -0.40 for 1868411 / 2026-06-02)
 * reaches the UI even though row-level fees are "Not reported".
 */

export type DayTradeRow = {
  /** Fill/gross P&L (before fees). */
  pnl: number;
  /** Net P&L when per-fill fees are known; equals pnl when they are not. */
  netPnl: number;
  /** True only when this trade carried broker per-fill fee data. */
  feesAvailable: boolean;
};

export type DayNetSource = "broker_net" | "trade_net" | "fill_before_fees";

export type DayNetDisplay = {
  /** The value to show for the day. */
  pnl: number;
  /** Where it came from. */
  source: DayNetSource;
  /** True when `pnl` is a true after-fees net (broker or per-trade). */
  isNet: boolean;
};

/**
 * Resolve the day total. `brokerDayNet` is the cashBalanceLog net for the day
 * (undefined when the broker did not report fees for that day).
 */
export function resolveDayNet(
  rows: DayTradeRow[],
  brokerDayNet: number | undefined,
): DayNetDisplay {
  if (brokerDayNet != null) {
    return { pnl: brokerDayNet, source: "broker_net", isNet: true };
  }
  const dayFeesAvailable = rows.length > 0 && rows.every((t) => t.feesAvailable);
  if (dayFeesAvailable) {
    return { pnl: sum(rows, (t) => t.netPnl), source: "trade_net", isNet: true };
  }
  return { pnl: sum(rows, (t) => t.pnl), source: "fill_before_fees", isNet: false };
}

function sum<T>(arr: T[], pick: (t: T) => number): number {
  return arr.reduce((s, t) => s + pick(t), 0);
}

/** Round to cents, avoiding FP drift (e.g. -0.39999999 → -0.40). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Row-level resolution
// ---------------------------------------------------------------------------

export type TradeRowResolution = {
  /**
   * Signed fees for this trade (negative = cost to the trader).
   * null when not determinable — show "Not reported".
   */
  fees: number | null;
  /**
   * After-fees net P&L for this trade.
   * null when not determinable — show "—".
   */
  net: number | null;
};

/**
 * Resolve the row-level fees and net P&L for a single trade.
 *
 * Priority:
 *   1. Per-trade broker fees (feesAvailable) — always authoritative.
 *   2. Single-trade day with broker day net — the whole day net is
 *      attributable to this one trade, so we can back-infer fees:
 *      inferredFees = brokerDayNet - tradePnl  (e.g. -0.40 - 1.50 = -1.90)
 *   3. Multi-trade day without per-trade fees — cannot allocate; null/null.
 *
 * `fees` is returned as a signed number (negative = cost) matching the
 * fmt$ convention. `trade.fees` on RoundTripTrade is a positive magnitude;
 * this function normalises it to signed.
 */
export function resolveTradeRowNet(
  trade: { pnl: number; netPnl: number; fees: number | null; feesAvailable: boolean },
  tradesInDay: number,
  brokerDayNet: number | undefined,
): TradeRowResolution {
  if (trade.feesAvailable) {
    return {
      fees: trade.fees != null ? -trade.fees : null,
      net: trade.netPnl,
    };
  }
  if (tradesInDay === 1 && brokerDayNet != null) {
    return {
      fees: brokerDayNet - trade.pnl,
      net: brokerDayNet,
    };
  }
  return { fees: null, net: null };
}

// ---------------------------------------------------------------------------
// Day-level fee allocation (two-tier fee model)
// ---------------------------------------------------------------------------

/**
 * Where a row's fees came from:
 *  - "exact": broker per-fill commission (cashBalanceLog/deps fillId fees).
 *  - "account-balance-derived": back-derived from the Account Balance History
 *    day net and the day's gross P&L, then allocated across that day's trades.
 *    Used for historical trades that closed before per-fill fees were captured.
 */
export type FeeSource = "exact" | "account-balance-derived";

export type RowNet = {
  /** Signed fees (negative = cost). null when undeterminable → "Not reported". */
  fees: number | null;
  /** After-fees net. null when undeterminable → "—". */
  net: number | null;
  /** Provenance of `fees`/`net`. null when undeterminable. */
  feeSource: FeeSource | null;
};

export type DayRowInput = {
  id: string;
  pnl: number;
  netPnl: number;
  fees: number | null;
  feesAvailable: boolean;
  /** Contracts in the round trip — the allocation weight for derived fees. */
  qty: number;
};

/**
 * Resolve fees + net for EVERY trade in a single day, supporting multi-trade
 * historical days (the two-tier fee model):
 *
 *   Tier A — exact: any trade with broker per-fill fees keeps its exact
 *     fees/net (e.g. Jun 2: gross +1.50, fees -1.90, net -0.40).
 *
 *   Tier B — Account-Balance-derived: for trades WITHOUT per-fill fees, when
 *     the Account Balance History day net is known, the day's total fee is
 *     back-derived and allocated across those trades:
 *       remainingNet      = ABHdayNet - sum(exact trades' net)
 *       derivedFeesTotal  = remainingNet - sum(derived trades' gross)   (≤ 0)
 *       per-trade fee      = derivedFeesTotal weighted by contract qty
 *     The last derived row absorbs the rounding remainder so the allocation
 *     sums EXACTLY to derivedFeesTotal — i.e. sum(all nets) == ABHdayNet.
 *
 *   When neither per-fill fees nor an ABH day net exist, fees/net are null
 *   (the UI shows "Not reported" / "—" — never a fabricated net).
 *
 * This generalises the old single-trade inference (one derived row, no exact
 * rows → fee = ABHdayNet - gross), which remains a special case here.
 */
export function resolveDayRowNets(
  rows: DayRowInput[],
  brokerDayNet: number | undefined,
): Map<string, RowNet> {
  const out = new Map<string, RowNet>();
  const exactRows = rows.filter((r) => r.feesAvailable);
  const derivedRows = rows.filter((r) => !r.feesAvailable);

  // Tier A — exact per-fill fees are always authoritative.
  for (const r of exactRows) {
    out.set(r.id, {
      fees: r.fees != null ? -r.fees : null,
      net: r.netPnl,
      feeSource: "exact",
    });
  }

  if (derivedRows.length === 0) return out;

  // No ABH day net → cannot derive fees for the remaining rows.
  if (brokerDayNet == null) {
    for (const r of derivedRows) {
      out.set(r.id, { fees: null, net: null, feeSource: null });
    }
    return out;
  }

  // Tier B — derive the total fee for the non-exact rows from ABH day net.
  const knownNet = round2(exactRows.reduce((s, r) => s + r.netPnl, 0));
  const remainingNet = round2(brokerDayNet - knownNet);
  const derivedGross = round2(derivedRows.reduce((s, r) => s + r.pnl, 0));
  const derivedFeesTotal = round2(remainingNet - derivedGross);

  // Allocate by contract quantity (fees scale with contracts traded). Equal
  // split when total qty is 0. The last row takes the remainder so the sum is
  // exact and the day reconciles to ABH net.
  const totalQty = derivedRows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0);
  let allocated = 0;
  derivedRows.forEach((r, i) => {
    const isLast = i === derivedRows.length - 1;
    let fee: number;
    if (isLast) {
      fee = round2(derivedFeesTotal - allocated);
    } else {
      const weight = totalQty > 0 ? r.qty / totalQty : 1 / derivedRows.length;
      fee = round2(derivedFeesTotal * weight);
      allocated = round2(allocated + fee);
    }
    out.set(r.id, {
      fees: fee,
      net: round2(r.pnl + fee),
      feeSource: "account-balance-derived",
    });
  });

  return out;
}

/**
 * Classify a trade as winning, losing, or flat using effective net P&L when
 * determinable, falling back to gross fill P&L.
 *
 * For single-trade days with broker day net, the inferred net is used so that
 * a trade with gross +1.50 but net -0.40 is correctly classified as losing.
 */
export function resolveTradeClassification(
  trade: { pnl: number; netPnl: number; fees: number | null; feesAvailable: boolean },
  tradesInDay: number,
  brokerDayNet: number | undefined,
): "winning" | "losing" | "flat" {
  const rowRes = resolveTradeRowNet(trade, tradesInDay, brokerDayNet);
  const effective = rowRes.net ?? trade.pnl;
  if (effective > 0) return "winning";
  if (effective < 0) return "losing";
  return "flat";
}
