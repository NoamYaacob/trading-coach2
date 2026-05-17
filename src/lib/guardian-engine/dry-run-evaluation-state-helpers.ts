/**
 * Pure helpers for the dry-run-evaluation-state diagnostic endpoint.
 * No Next.js imports — safe to import from tests and the route alike.
 */

import {
  evaluateDryRunRules,
  type DryRunRuleInput,
  type DryRunRuleResult,
} from "./dry-run-rule-evaluator.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuleStatus =
  | "would_fire"
  | "below_threshold"
  | "skipped_missing_rule"
  | "skipped_insufficient_data"
  | "skipped_unverified_trade_count"
  | "skipped_env_gate";

export type RuleEvalEntry = {
  ruleType: string;
  status: RuleStatus;
  threshold: number | null;
  observed: number | null;
  wouldFire: boolean;
  reason: string | null;
};

export type AccountEvalInput = {
  accountId: string;
  userId: string;
  externalAccountId: string | null;
  env: string;
  isActive: boolean;
  missingFromBrokerSince: Date | null;
  protectionStatus: string;
  sessionState: {
    sessionDate: string;
    dailyPnl: number;
    tradesCount: number;
    tradeCountSource: string;
    consecutiveLosses: number;
    updatedAt: Date;
  } | null;
  riskRules: {
    maxDailyLoss: number | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
  } | null;
  enableLive: boolean;
};

export type AccountEvalResult = {
  evaluationEligible: boolean;
  ruleEvaluation: RuleEvalEntry[];
  wouldFire: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const RULE_TYPES = ["daily_loss_limit", "trade_limit", "max_loss_streak"] as const;

function skipAllRules(status: RuleStatus, reason: string): RuleEvalEntry[] {
  return RULE_TYPES.map((ruleType) => ({
    ruleType,
    status,
    threshold: null,
    observed: null,
    wouldFire: false,
    reason,
  }));
}

export function buildRuleEntry(opts: {
  ruleType: string;
  threshold: number | null;
  observed: number | null;
  violations: DryRunRuleResult[];
  skippedMap: Map<string, string>;
}): RuleEvalEntry {
  const { ruleType, threshold, observed, violations, skippedMap } = opts;

  if (threshold === null) {
    return {
      ruleType,
      status: "skipped_missing_rule",
      threshold: null,
      observed,
      wouldFire: false,
      reason: "rule_not_configured",
    };
  }

  if (violations.some((v) => v.ruleType === ruleType)) {
    return { ruleType, status: "would_fire", threshold, observed, wouldFire: true, reason: null };
  }

  const skipReason = skippedMap.get(ruleType);
  if (skipReason) {
    const status: RuleStatus = skipReason.includes("tradeCountSource")
      ? "skipped_unverified_trade_count"
      : "skipped_insufficient_data";
    return { ruleType, status, threshold, observed, wouldFire: false, reason: skipReason };
  }

  return { ruleType, status: "below_threshold", threshold, observed, wouldFire: false, reason: null };
}

export function deriveAccountEvaluation(input: AccountEvalInput): AccountEvalResult {
  const { isActive, missingFromBrokerSince, protectionStatus, env, sessionState, riskRules, enableLive } = input;

  if (!isActive) {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_insufficient_data", "account_inactive"),
      wouldFire: false,
    };
  }
  if (missingFromBrokerSince != null) {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_insufficient_data", "missing_from_broker"),
      wouldFire: false,
    };
  }
  if (protectionStatus !== "protected") {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_insufficient_data", `protectionStatus=${protectionStatus}`),
      wouldFire: false,
    };
  }
  if (env === "live" && !enableLive) {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_env_gate", "TRADOVATE_LISTENER_ENABLE_LIVE=false"),
      wouldFire: false,
    };
  }
  if (!sessionState) {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_insufficient_data", "no_session_state"),
      wouldFire: false,
    };
  }
  if (!riskRules) {
    return {
      evaluationEligible: false,
      ruleEvaluation: skipAllRules("skipped_missing_rule", "no_account_risk_rules"),
      wouldFire: false,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const evalInput: DryRunRuleInput = {
    accountId: input.accountId,
    userId: input.userId,
    externalAccountId: input.externalAccountId,
    env,
    tradingDay: sessionState.sessionDate ?? today,
    dailyPnl: sessionState.dailyPnl,
    tradesCount: sessionState.tradesCount,
    tradeCountSource: sessionState.tradeCountSource,
    consecutiveLosses: sessionState.consecutiveLosses,
    maxDailyLoss: riskRules.maxDailyLoss,
    maxTradesPerDay: riskRules.maxTradesPerDay,
    stopAfterLosses: riskRules.stopAfterLosses,
    // This diagnostic reads account-level rules only; the profit target lives
    // on GuardianProfile. Profit-target dry-run auditing is handled by
    // dry-run-rule-evaluator-db.ts, not this helper.
    dailyProfitTarget: null,
  };

  const { violations, skipped } = evaluateDryRunRules(evalInput);
  const skippedMap = new Map(skipped.map((s) => [s.ruleType, s.reason]));

  const ruleEvaluation: RuleEvalEntry[] = [
    buildRuleEntry({
      ruleType: "daily_loss_limit",
      threshold: riskRules.maxDailyLoss,
      observed: sessionState.dailyPnl,
      violations,
      skippedMap,
    }),
    buildRuleEntry({
      ruleType: "trade_limit",
      threshold: riskRules.maxTradesPerDay,
      observed: sessionState.tradesCount,
      violations,
      skippedMap,
    }),
    buildRuleEntry({
      ruleType: "max_loss_streak",
      threshold: riskRules.stopAfterLosses,
      observed: sessionState.consecutiveLosses,
      violations,
      skippedMap,
    }),
  ];

  return {
    evaluationEligible: true,
    ruleEvaluation,
    wouldFire: ruleEvaluation.some((r) => r.wouldFire),
  };
}
