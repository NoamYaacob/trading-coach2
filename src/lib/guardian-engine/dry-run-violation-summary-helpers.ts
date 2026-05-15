/**
 * Pure helpers for the dry-run violation summary endpoint.
 *
 * No Prisma, no Next.js — safe to import from tests and the route alike.
 * Takes normalised violation rows (Decimal already converted to number)
 * and returns three grouped views for baseline review.
 */

// ── Input type ────────────────────────────────────────────────────────────────

export type ViolationRow = {
  accountId: string;
  accountLabel: string | null;
  externalAccountId: string | null;
  env: string;
  ruleType: string;
  tradingDay: string;
  thresholdAmount: number | null;
  thresholdCount: number | null;
  observedAmount: number | null;
  observedCount: number | null;
  dryRun: boolean;
  actionWouldHaveTaken: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── Output types ──────────────────────────────────────────────────────────────

export type DaySummary = {
  tradingDay: string;
  /** Number of distinct account+rule combinations that fired on this day. */
  violationCount: number;
  ruleTypes: string[];
  accounts: string[];
};

export type AccountRuleSummary = {
  accountId: string;
  label: string | null;
  externalAccountId: string | null;
  env: string;
  ruleType: string;
  /** Trading days (YYYY-MM-DD) where this rule fired for this account. */
  tradingDays: string[];
  /** Number of distinct trading days the rule fired. */
  daysWithViolation: number;
  threshold: number | null;
  latestObservedAmount: number | null;
  latestObservedCount: number | null;
  dryRun: boolean;
  actionWouldHaveTaken: string;
  firstSeenAt: Date;
  lastUpdatedAt: Date;
};

export type RuleTypeSummary = {
  ruleType: string;
  /** Total distinct account+day combinations where this rule fired. */
  violationCount: number;
  tradingDays: string[];
  affectedAccounts: string[];
};

export type ViolationSummary = {
  totalViolations: number;
  byTradingDay: DaySummary[];
  byAccountAndRule: AccountRuleSummary[];
  byRuleType: RuleTypeSummary[];
};

// ── Grouping logic ────────────────────────────────────────────────────────────

export function buildViolationSummary(rows: ViolationRow[]): ViolationSummary {
  if (rows.length === 0) {
    return { totalViolations: 0, byTradingDay: [], byAccountAndRule: [], byRuleType: [] };
  }

  // ── byAccountAndRule ──────────────────────────────────────────────────────
  // Key: accountId + ruleType. For each combination, collect the distinct
  // trading days and track the latest observed values (from the most recently
  // updated row) plus the earliest createdAt (first time the rule fired).
  const accountRuleMap = new Map<string, AccountRuleSummary>();

  for (const row of rows) {
    const key = `${row.accountId}:${row.ruleType}`;
    const existing = accountRuleMap.get(key);
    if (!existing) {
      accountRuleMap.set(key, {
        accountId: row.accountId,
        label: row.accountLabel,
        externalAccountId: row.externalAccountId,
        env: row.env,
        ruleType: row.ruleType,
        tradingDays: [row.tradingDay],
        daysWithViolation: 1,
        threshold: row.thresholdAmount ?? row.thresholdCount ?? null,
        latestObservedAmount: row.observedAmount,
        latestObservedCount: row.observedCount,
        dryRun: row.dryRun,
        actionWouldHaveTaken: row.actionWouldHaveTaken,
        firstSeenAt: row.createdAt,
        lastUpdatedAt: row.updatedAt,
      });
    } else {
      if (!existing.tradingDays.includes(row.tradingDay)) {
        existing.tradingDays.push(row.tradingDay);
        existing.daysWithViolation++;
      }
      // Keep the latest observed values (most recently updated row wins).
      if (row.updatedAt > existing.lastUpdatedAt) {
        existing.lastUpdatedAt = row.updatedAt;
        existing.latestObservedAmount = row.observedAmount;
        existing.latestObservedCount = row.observedCount;
      }
      // Keep the earliest createdAt.
      if (row.createdAt < existing.firstSeenAt) {
        existing.firstSeenAt = row.createdAt;
      }
    }
  }

  const byAccountAndRule = Array.from(accountRuleMap.values()).sort(
    (a, b) => b.lastUpdatedAt.getTime() - a.lastUpdatedAt.getTime(),
  );

  // ── byTradingDay ──────────────────────────────────────────────────────────
  const dayMap = new Map<string, { ruleTypes: Set<string>; accounts: Set<string>; count: number }>();

  for (const row of rows) {
    const existing = dayMap.get(row.tradingDay);
    if (!existing) {
      dayMap.set(row.tradingDay, {
        ruleTypes: new Set([row.ruleType]),
        accounts: new Set([row.accountLabel ?? row.accountId]),
        count: 1,
      });
    } else {
      existing.ruleTypes.add(row.ruleType);
      existing.accounts.add(row.accountLabel ?? row.accountId);
      existing.count++;
    }
  }

  const byTradingDay: DaySummary[] = Array.from(dayMap.entries())
    .map(([tradingDay, { ruleTypes, accounts, count }]) => ({
      tradingDay,
      violationCount: count,
      ruleTypes: Array.from(ruleTypes).sort(),
      accounts: Array.from(accounts).sort(),
    }))
    .sort((a, b) => b.tradingDay.localeCompare(a.tradingDay));

  // ── byRuleType ────────────────────────────────────────────────────────────
  const ruleMap = new Map<string, { tradingDays: Set<string>; accounts: Set<string>; count: number }>();

  for (const row of rows) {
    const existing = ruleMap.get(row.ruleType);
    if (!existing) {
      ruleMap.set(row.ruleType, {
        tradingDays: new Set([row.tradingDay]),
        accounts: new Set([row.accountLabel ?? row.accountId]),
        count: 1,
      });
    } else {
      existing.tradingDays.add(row.tradingDay);
      existing.accounts.add(row.accountLabel ?? row.accountId);
      existing.count++;
    }
  }

  const byRuleType: RuleTypeSummary[] = Array.from(ruleMap.entries())
    .map(([ruleType, { tradingDays, accounts, count }]) => ({
      ruleType,
      violationCount: count,
      tradingDays: Array.from(tradingDays).sort().reverse(),
      affectedAccounts: Array.from(accounts).sort(),
    }))
    .sort((a, b) => b.violationCount - a.violationCount);

  return {
    totalViolations: rows.length,
    byTradingDay,
    byAccountAndRule,
    byRuleType,
  };
}
