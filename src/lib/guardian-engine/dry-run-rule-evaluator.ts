/**
 * Phase 2A: pure dry-run rule evaluation logic.
 *
 * Safety contract (observe-only — no side-effects):
 *   - Pure computation only; no Prisma, no DB, no broker calls
 *   - No risk state mutations, no intervention records
 *   - No position flattening, no order cancellation
 *   - Always dry run — never triggers enforcement
 *   - DB persistence lives in dry-run-rule-evaluator-db.ts
 */

// ── Input types ───────────────────────────────────────────────────────────────

export type DryRunRuleInput = {
  accountId: string;
  userId: string;
  externalAccountId: string | null;
  env: string;
  /** YYYY-MM-DD trading day key */
  tradingDay: string;

  // Live session state
  dailyPnl: number;
  tradesCount: number;
  /**
   * "verified"  — broker source we trust; trade-limit evaluation allowed.
   * "estimated" — may include other accounts; trade-limit suppressed.
   * "unavailable" — fills not fetched; trade-limit suppressed.
   */
  tradeCountSource: string;
  consecutiveLosses: number;

  // Account risk rules (null = rule not configured, skip evaluation)
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  /**
   * Daily profit target (positive amount). Dry-run audit only — a profit-target
   * breach never creates an internal lock or any broker action. The internal
   * lock path passes null here so it is excluded from enforcement entirely.
   */
  dailyProfitTarget: number | null;

  /** Optional source event identifier for traceability */
  sourceEventId?: string | null;
};

export type DryRunRuleResultType =
  | "daily_loss_limit"
  | "trade_limit"
  | "max_loss_streak"
  | "daily_profit_target";

export type DryRunRuleResult = {
  ruleType: DryRunRuleResultType;
  thresholdAmount: number | null;
  thresholdCount: number | null;
  observedAmount: number | null;
  observedCount: number | null;
  /** Deterministic dedup key — used for upsert to prevent duplicate rows. */
  dedupKey: string;
  /** What Guardrail would have done in live mode. Always "internal_lock" in Phase 2A. */
  actionWouldHaveTaken: string;
};

export type DryRunEvaluationResult = {
  violations: DryRunRuleResult[];
  /** Rules skipped because of insufficient data, with reasons. */
  skipped: Array<{ ruleType: string; reason: string }>;
};

// ── Pure evaluation ───────────────────────────────────────────────────────────

export function evaluateDryRunRules(input: DryRunRuleInput): DryRunEvaluationResult {
  const violations: DryRunRuleResult[] = [];
  const skipped: Array<{ ruleType: string; reason: string }> = [];

  // daily_loss_limit
  if (input.maxDailyLoss != null) {
    // dailyPnl is negative when in a loss. Breach when pnl <= -maxDailyLoss.
    if (input.dailyPnl <= -Math.abs(input.maxDailyLoss)) {
      violations.push({
        ruleType: "daily_loss_limit",
        thresholdAmount: input.maxDailyLoss,
        thresholdCount: null,
        observedAmount: input.dailyPnl,
        observedCount: null,
        dedupKey: `${input.accountId}:daily_loss_limit:${input.tradingDay}:dry_run`,
        actionWouldHaveTaken: "internal_lock",
      });
    }
  }

  // trade_limit — only when tradeCountSource is "verified".
  // Semantics: maxTradesPerDay is the ALLOWANCE. A user setting "Max trades per
  // day = 3" expects 3 trades to be permitted; the lock fires only after the
  // allowance has been EXCEEDED. So with maxTradesPerDay=3:
  //   tradesCount 0..3 → no lock (within allowance)
  //   tradesCount 4    → lock (one past the allowance)
  // Comparison: tradesCount > maxTradesPerDay (strict, post-trade monitoring).
  // Note for future pre-order blocking: a pre-order gate would use >= so the
  // 4th order is blocked BEFORE it fills. That is a separate codepath and is
  // not implemented here.
  // Suppressed when tradeCountSource != "verified" because broker-derived
  // counts can include other accounts (estimated) or be missing (unavailable).
  if (input.maxTradesPerDay != null) {
    if (input.tradeCountSource !== "verified") {
      skipped.push({ ruleType: "trade_limit", reason: `tradeCountSource=${input.tradeCountSource}` });
    } else if (input.tradesCount > input.maxTradesPerDay) {
      violations.push({
        ruleType: "trade_limit",
        thresholdAmount: null,
        thresholdCount: input.maxTradesPerDay,
        observedAmount: null,
        observedCount: input.tradesCount,
        dedupKey: `${input.accountId}:trade_limit:${input.tradingDay}:dry_run`,
        actionWouldHaveTaken: "internal_lock",
      });
    }
  }

  // max_loss_streak
  if (input.stopAfterLosses != null) {
    if (input.consecutiveLosses >= input.stopAfterLosses) {
      violations.push({
        ruleType: "max_loss_streak",
        thresholdAmount: null,
        thresholdCount: input.stopAfterLosses,
        observedAmount: null,
        observedCount: input.consecutiveLosses,
        dedupKey: `${input.accountId}:max_loss_streak:${input.tradingDay}:dry_run`,
        actionWouldHaveTaken: "internal_lock",
      });
    }
  }

  // daily_profit_target — dry-run audit only.
  // Mirrors Guardian's sign/threshold logic (guardian.ts evaluateGuardianRules):
  // dailyPnl is positive when in profit; the target is reached when pnl >= target.
  // A profit-target breach is NEVER passed to the internal lock or broker path —
  // the internal lock evaluator supplies dailyProfitTarget=null so this branch
  // is skipped there entirely.
  if (input.dailyProfitTarget != null) {
    if (input.dailyPnl >= input.dailyProfitTarget) {
      violations.push({
        ruleType: "daily_profit_target",
        thresholdAmount: input.dailyProfitTarget,
        thresholdCount: null,
        observedAmount: input.dailyPnl,
        observedCount: null,
        dedupKey: `${input.accountId}:daily_profit_target:${input.tradingDay}:dry_run`,
        actionWouldHaveTaken: "internal_lock",
      });
    }
  }

  return { violations, skipped };
}
