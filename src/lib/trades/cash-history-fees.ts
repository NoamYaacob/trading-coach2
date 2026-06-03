/**
 * Cash History (Tradovate cashBalanceLog) — the source of truth for fees and
 * realized P&L, exactly as the trader sees it in Tradovate's Cash History.
 *
 * Each ledger row carries a signed `delta`, a `contract`, an `accountId`, a
 * trading-day key, and a "Cash Change Type". The types we care about:
 *
 *   Fee rows (delta is negative):
 *     - Exchange Fee
 *     - Clearing Fee
 *     - Nfa Fee
 *     - Commission
 *   Realized P&L rows:
 *     - Trade Paired   (delta is the paired/closed P&L, signed)
 *
 * All other types (Fund Transaction, Entitlement Subscription, …) are ignored.
 *
 * Real example — account 1868411, 2026-06-02, MNQM6:
 *   Trade Paired           +1.50
 *   fees (8 rows summed)    -1.90
 *   netPnl = tradePnl+fees  -0.40
 *
 * Sign convention (mirrors the ledger, NOT round-trips.ts):
 *   - `tradePnl` is the signed sum of Trade Paired deltas (e.g. +1.50).
 *   - `fees` is the signed sum of fee deltas — already NEGATIVE (e.g. -1.90).
 *   - `netPnl = tradePnl + fees` (because fees are negative).
 *
 * Honesty rules:
 *   - We never fabricate fees. `feesAvailable` is false unless at least one fee
 *     row was present for that group; callers must not present tradePnl as Net
 *     when feesAvailable is false.
 *   - Account isolation is enforced: aggregation filters strictly to the
 *     requested accountId so another account's fees can never leak in.
 */

const FEE_TYPES = new Set(["exchange fee", "clearing fee", "nfa fee", "commission"]);
const PNL_TYPES = new Set(["trade paired"]);

export type CashRowKind = "fee" | "pnl" | "other";

/** Classify a Cash Change Type. Case/whitespace-insensitive. */
export function classifyCashRow(changeType: string | null | undefined): CashRowKind {
  if (!changeType) return "other";
  const norm = changeType.trim().toLowerCase();
  if (FEE_TYPES.has(norm)) return "fee";
  if (PNL_TYPES.has(norm)) return "pnl";
  return "other";
}

/** A normalized Cash History ledger row. */
export type CashHistoryRow = {
  /** Owning account — REQUIRED so fees are never mixed across accounts. */
  accountId: string;
  /** Contract symbol, e.g. "MNQM6". null for non-trade rows. */
  contract: string | null;
  /** Trading-day key "YYYY-MM-DD". */
  date: string;
  /** Signed delta from the ledger (fees negative, Trade Paired signed). */
  delta: number;
  /** Raw "Cash Change Type" string. */
  changeType: string;
};

/** Aggregated P&L for one (account, contract, day) group. */
export type ContractDayPnl = {
  accountId: string;
  contract: string | null;
  date: string;
  /** Signed sum of Trade Paired deltas (e.g. +1.50). */
  tradePnl: number;
  /** Signed sum of fee deltas — negative (e.g. -1.90). 0 when none. */
  fees: number;
  /** tradePnl + fees (fees already negative) → e.g. -0.40. */
  netPnl: number;
  /** True when at least one fee row contributed. */
  feesAvailable: boolean;
};

function groupKey(accountId: string, contract: string | null, date: string): string {
  return `${accountId} ${contract ?? ""} ${date}`;
}

/**
 * Aggregate Cash History rows into per-(account, contract, day) P&L.
 *
 * Strictly filters to `accountId` — rows for any other account are dropped, so
 * fees from a different account can never be summed into this one.
 */
export function aggregateCashHistory(
  rows: CashHistoryRow[],
  accountId: string,
): ContractDayPnl[] {
  const map = new Map<string, ContractDayPnl>();

  for (const row of rows) {
    if (row.accountId !== accountId) continue; // account isolation
    const kind = classifyCashRow(row.changeType);
    if (kind === "other") continue;

    const key = groupKey(row.accountId, row.contract, row.date);
    let agg = map.get(key);
    if (!agg) {
      agg = {
        accountId: row.accountId,
        contract: row.contract,
        date: row.date,
        tradePnl: 0,
        fees: 0,
        netPnl: 0,
        feesAvailable: false,
      };
      map.set(key, agg);
    }

    if (kind === "fee") {
      agg.fees += row.delta;
      agg.feesAvailable = true;
    } else if (kind === "pnl") {
      agg.tradePnl += row.delta;
    }
  }

  // Finalize netPnl (round to cents to avoid FP drift like -0.3999999).
  for (const agg of map.values()) {
    agg.tradePnl = round2(agg.tradePnl);
    agg.fees = round2(agg.fees);
    agg.netPnl = round2(agg.tradePnl + agg.fees);
  }

  return Array.from(map.values());
}

/** One closed (paired) trade with the fees attributed to it. */
export type PairedTradePnl = {
  accountId: string;
  contract: string | null;
  date: string;
  /** Signed Trade Paired delta for this close (e.g. +1.50). */
  tradePnl: number;
  /** Signed fee sum attributed to this close — negative (e.g. -1.90). */
  fees: number;
  /** tradePnl + fees. */
  netPnl: number;
  feesAvailable: boolean;
};

/**
 * Group Cash History into individual paired trades (the "paired trade window").
 *
 * Walks rows in ledger order per (account, contract). Fee rows accumulate into
 * a bucket; when a "Trade Paired" row is reached, the accumulated fees since the
 * previous paired close are attributed to it and the bucket resets. This mirrors
 * how fees for a trade's entry and exit fills precede its paired-P&L row.
 *
 * Account isolation is enforced (rows for other accounts are dropped). This is
 * best-effort per-trade attribution — the authoritative reconciliation total is
 * the per-day sum (see aggregateCashHistory / cashHistoryDayNet), which is exact
 * regardless of how fees distribute across same-window closes.
 */
export function aggregateByPairedTrade(
  rows: CashHistoryRow[],
  accountId: string,
): PairedTradePnl[] {
  // Preserve input (ledger) order within each contract bucket.
  const buckets = new Map<string, { feeAcc: number; feeSeen: boolean }>();
  const out: PairedTradePnl[] = [];

  for (const row of rows) {
    if (row.accountId !== accountId) continue; // isolation
    const kind = classifyCashRow(row.changeType);
    if (kind === "other") continue;

    const ck = `${row.contract ?? ""}`;
    let b = buckets.get(ck);
    if (!b) {
      b = { feeAcc: 0, feeSeen: false };
      buckets.set(ck, b);
    }

    if (kind === "fee") {
      b.feeAcc += row.delta;
      b.feeSeen = true;
    } else if (kind === "pnl") {
      const fees = round2(b.feeAcc);
      const tradePnl = round2(row.delta);
      out.push({
        accountId: row.accountId,
        contract: row.contract,
        date: row.date,
        tradePnl,
        fees,
        netPnl: round2(tradePnl + fees),
        feesAvailable: b.feeSeen,
      });
      b.feeAcc = 0;
      b.feeSeen = false;
    }
  }

  return out;
}

/**
 * Roll Cash History up to per-day NET P&L for the given account, summed across
 * contracts. Only days that actually have a Trade Paired row are included, and
 * a day is only emitted when fee data is available for it (so the calendar /
 * dashboard never label a fees-missing day as Net).
 *
 * Returns a `Record<"YYYY-MM-DD", netPnl>` suitable for the calendar's
 * `brokerDayNet` prop.
 */
export function cashHistoryDayNet(
  rows: CashHistoryRow[],
  accountId: string,
): Record<string, number> {
  const perGroup = aggregateCashHistory(rows, accountId);
  const byDate = new Map<string, { net: number; feesAvailable: boolean; hasTrade: boolean }>();

  for (const g of perGroup) {
    const cur = byDate.get(g.date) ?? { net: 0, feesAvailable: false, hasTrade: false };
    cur.net += g.netPnl;
    cur.feesAvailable = cur.feesAvailable || g.feesAvailable;
    cur.hasTrade = cur.hasTrade || g.tradePnl !== 0 || g.feesAvailable;
    byDate.set(g.date, cur);
  }

  const out: Record<string, number> = {};
  for (const [date, v] of byDate) {
    if (v.feesAvailable && v.hasTrade) out[date] = round2(v.net);
  }
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Raw cashBalanceLog row shape (defensive — Tradovate field names vary by
 * plan/version). Every field optional; the normalizer tolerates absence.
 */
export type RawCashBalanceLogRow = {
  id?: number;
  accountId?: number | null;
  contractId?: number | null;
  contract?: string | null;
  timestamp?: string | null;
  tradeDate?: { year?: number; month?: number; day?: number } | string | null;
  amount?: number | null;
  realizedPnL?: number | null;
  /** May be a plain string ("Exchange Fee") or a {name} object. */
  cashChangeType?: string | { name?: string } | null;
};

/**
 * Normalize raw cashBalanceLog rows into CashHistoryRow, keeping ONLY rows for
 * the given broker account (`brokerAccountId`) and tagging them with our DB
 * `dbAccountId`. This is where account isolation begins: rows for other broker
 * accounts are dropped before they can ever be aggregated.
 *
 * Pure and defensive: rows missing a usable delta or date are skipped, never
 * throwing. Contract grouping falls back to the numeric contractId as a string.
 */
export function normalizeCashBalanceLogRows(
  raw: RawCashBalanceLogRow[],
  brokerAccountId: number,
  dbAccountId: string,
): CashHistoryRow[] {
  const out: CashHistoryRow[] = [];
  for (const r of raw) {
    if (r.accountId != null && r.accountId !== brokerAccountId) continue;

    const changeType = typeof r.cashChangeType === "string"
      ? r.cashChangeType
      : (r.cashChangeType?.name ?? "");
    if (!changeType) continue;

    const delta = r.amount ?? r.realizedPnL;
    if (delta == null || !Number.isFinite(delta)) continue;

    const date = deriveDateKey(r);
    if (!date) continue;

    const contract = r.contract ?? (r.contractId != null ? String(r.contractId) : null);

    out.push({ accountId: dbAccountId, contract, date, delta, changeType });
  }
  return out;
}

function deriveDateKey(r: RawCashBalanceLogRow): string | null {
  const td = r.tradeDate;
  if (td && typeof td === "object" && td.year && td.month && td.day) {
    return `${td.year}-${pad2(td.month)}-${pad2(td.day)}`;
  }
  if (typeof td === "string" && td.length > 0) {
    const k = isoDatePrefix(td);
    if (k) return k;
  }
  if (typeof r.timestamp === "string" && r.timestamp.length > 0) {
    const k = isoDatePrefix(r.timestamp);
    if (k) return k;
  }
  return null;
}

function isoDatePrefix(s: string): string | null {
  // Accepts "2026-06-02T...", "2026-06-02", or "06/02/2026 15:43:58".
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
