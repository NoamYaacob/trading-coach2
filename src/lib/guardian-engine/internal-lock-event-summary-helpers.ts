/**
 * Pure helpers for the internal lock event summary endpoint.
 *
 * No Prisma, no Next.js — safe to import from tests and the route alike.
 * Takes normalised lock event rows (Decimal already converted to number)
 * and returns flat + grouped views for operator review.
 */

// ── Input type ────────────────────────────────────────────────────────────────

export type LockEventRow = {
  id: string;
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
  internalOnly: boolean;
  brokerActionTaken: boolean;
  createdAt: Date;
  clearedAt: Date | null;
  clearedBy: string | null;
};

// ── Output types ──────────────────────────────────────────────────────────────

export type AccountLockSummary = {
  accountId: string;
  label: string | null;
  externalAccountId: string | null;
  env: string;
  total: number;
  active: number;
  cleared: number;
  ruleTypes: string[];
  lastLockedAt: Date;
  lastClearedAt: Date | null;
};

export type RuleTypeLockSummary = {
  ruleType: string;
  total: number;
  active: number;
  cleared: number;
  affectedAccounts: string[];
};

export type LockEventSummary = {
  total: number;
  activeCount: number;
  clearedCount: number;
  recent: LockEventRow[];
  byAccount: AccountLockSummary[];
  byRuleType: RuleTypeLockSummary[];
};

// ── Grouping logic ────────────────────────────────────────────────────────────

export function buildLockEventSummary(rows: LockEventRow[]): LockEventSummary {
  if (rows.length === 0) {
    return {
      total: 0,
      activeCount: 0,
      clearedCount: 0,
      recent: [],
      byAccount: [],
      byRuleType: [],
    };
  }

  const activeCount = rows.filter((r) => r.clearedAt == null).length;
  const clearedCount = rows.length - activeCount;

  // ── byAccount ─────────────────────────────────────────────────────────────
  const accountMap = new Map<string, AccountLockSummary>();

  for (const row of rows) {
    const isActive = row.clearedAt == null;
    const existing = accountMap.get(row.accountId);
    if (!existing) {
      accountMap.set(row.accountId, {
        accountId: row.accountId,
        label: row.accountLabel,
        externalAccountId: row.externalAccountId,
        env: row.env,
        total: 1,
        active: isActive ? 1 : 0,
        cleared: isActive ? 0 : 1,
        ruleTypes: [row.ruleType],
        lastLockedAt: row.createdAt,
        lastClearedAt: row.clearedAt ?? null,
      });
    } else {
      existing.total++;
      if (isActive) {
        existing.active++;
      } else {
        existing.cleared++;
        if (row.clearedAt != null) {
          if (existing.lastClearedAt == null || row.clearedAt > existing.lastClearedAt) {
            existing.lastClearedAt = row.clearedAt;
          }
        }
      }
      if (!existing.ruleTypes.includes(row.ruleType)) {
        existing.ruleTypes.push(row.ruleType);
      }
      if (row.createdAt > existing.lastLockedAt) {
        existing.lastLockedAt = row.createdAt;
      }
    }
  }

  const byAccount = Array.from(accountMap.values()).sort(
    (a, b) => b.lastLockedAt.getTime() - a.lastLockedAt.getTime(),
  );

  // ── byRuleType ────────────────────────────────────────────────────────────
  const ruleMap = new Map<string, { total: number; active: number; cleared: number; accounts: Set<string> }>();

  for (const row of rows) {
    const isActive = row.clearedAt == null;
    const accountRef = row.accountLabel ?? row.accountId;
    const existing = ruleMap.get(row.ruleType);
    if (!existing) {
      ruleMap.set(row.ruleType, {
        total: 1,
        active: isActive ? 1 : 0,
        cleared: isActive ? 0 : 1,
        accounts: new Set([accountRef]),
      });
    } else {
      existing.total++;
      if (isActive) existing.active++;
      else existing.cleared++;
      existing.accounts.add(accountRef);
    }
  }

  const byRuleType: RuleTypeLockSummary[] = Array.from(ruleMap.entries())
    .map(([ruleType, { total, active, cleared, accounts }]) => ({
      ruleType,
      total,
      active,
      cleared,
      affectedAccounts: Array.from(accounts).sort(),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    total: rows.length,
    activeCount,
    clearedCount,
    recent: rows,
    byAccount,
    byRuleType,
  };
}
