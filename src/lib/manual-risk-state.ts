/**
 * Manual Mode risk state calculator.
 *
 * Pure, side-effect-free helper that derives "Am I allowed to trade now?"
 * from the user's saved RiskRules and today's ManualTradeEntry records.
 *
 * App-level only — does NOT block orders at the broker. Used on /dashboard
 * and /guardian when no broker is connected.
 */

import type { ManualTradeEntry, RiskRules } from "@prisma/client";

export type ManualRiskPermission = "SAFE" | "WARNING" | "LOCKED";

export type ManualBreachReason =
  | "daily_loss_limit"
  | "daily_profit_target"
  | "max_trades"
  | "stop_after_losses"
  | "risk_per_trade_exceeded"
  | "rule_breach_logged";

export type ManualRiskState = {
  // Today totals
  todayPnL: number;
  todayTradesCount: number;
  winCount: number;
  lossCount: number;
  consecutiveLosses: number;
  largestLoss: number; // positive number representing the size of the largest loss
  ruleBreachesToday: number;

  // Remaining capacity
  remainingTrades: number | null;
  remainingDailyLossBudget: number | null;
  /** 0..1 progress toward daily profit target. null when no target. */
  dailyProfitTargetProgress: number | null;

  // Hard breach flags
  dailyLossLimitHit: boolean;
  dailyProfitTargetHit: boolean;
  maxTradesHit: boolean;
  stopAfterLossesHit: boolean;
  riskPerTradeExceeded: boolean;

  // Soft warnings (rule approaching its threshold)
  approachingDailyLoss: boolean; // >= 80% of limit
  approachingMaxTrades: boolean; // 1 trade left
  approachingLossStreak: boolean; // 1 loss before stop-after-losses

  // Overall verdict
  permission: ManualRiskPermission;
  /** Primary reason — used for hero copy when LOCKED. */
  blockReason: ManualBreachReason | null;
  /** Most recent rule breach in today's log, if any. */
  lastBreach: {
    reason: ManualBreachReason;
    tradedAt: Date;
    label: string;
    detail: string;
  } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && v !== null && "toNumber" in v) {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isLoss(pnl: number | null): boolean {
  return pnl !== null && pnl < 0;
}

function consecutiveLossStreak(trades: ManualTradeEntry[]): number {
  // trades passed in chronological order (oldest -> newest); count tail of losses.
  let streak = 0;
  for (let i = trades.length - 1; i >= 0; i -= 1) {
    const pnl = toNum(trades[i].pnl);
    if (isLoss(pnl)) {
      streak += 1;
    } else if (pnl !== null) {
      // a non-loss closes the streak
      break;
    }
    // null pnl trades are skipped (open trade or unknown outcome)
  }
  return streak;
}

function buildBreachInfo(reason: ManualBreachReason, trade: ManualTradeEntry | null): {
  label: string;
  detail: string;
} {
  switch (reason) {
    case "daily_loss_limit":
      return {
        label: "Daily loss limit",
        detail: "Your P&L crossed the daily loss limit you set in Rules.",
      };
    case "daily_profit_target":
      return {
        label: "Daily profit target",
        detail: "Your P&L reached the daily profit target. Session is locked to protect the win.",
      };
    case "max_trades":
      return {
        label: "Max trades per day",
        detail: "You've hit the maximum number of trades you allow yourself per day.",
      };
    case "stop_after_losses":
      return {
        label: "Consecutive loss stop",
        detail: "You hit your consecutive-loss stop. Session is locked.",
      };
    case "risk_per_trade_exceeded":
      return {
        label: "Risk per trade exceeded",
        detail: trade?.symbol
          ? `Risk on the ${trade.symbol} trade was larger than your max-risk-per-trade rule.`
          : "A trade risked more than your max-risk-per-trade rule.",
      };
    case "rule_breach_logged":
      return {
        label: "Rule breach logged",
        detail: trade && trade.breachReason
          ? trade.breachReason
          : "You marked one of today's trades as a rule breach.",
      };
  }
}

// ─── Core calculator ─────────────────────────────────────────────────────

/**
 * Compute today's manual-mode risk state.
 *
 * @param rules         User's RiskRules (or null when not yet configured).
 * @param todayTrades   Today's ManualTradeEntry rows in any order.
 *                      The function sorts by tradedAt internally.
 */
export function computeManualRiskState(input: {
  rules: RiskRules | null;
  todayTrades: ManualTradeEntry[];
}): ManualRiskState {
  const { rules } = input;
  const trades = [...input.todayTrades].sort(
    (a, b) => a.tradedAt.getTime() - b.tradedAt.getTime(),
  );

  // ── Aggregate today's results ────────────────────────────────────────
  let todayPnL = 0;
  let winCount = 0;
  let lossCount = 0;
  let largestLoss = 0;
  let ruleBreachesToday = 0;
  let riskPerTradeExceeded = false;
  let lastRiskBreachTrade: ManualTradeEntry | null = null;
  let lastLoggedBreachTrade: ManualTradeEntry | null = null;

  const maxRiskPerTrade = toNum(rules?.maxRiskPerTrade);

  for (const trade of trades) {
    const pnl = toNum(trade.pnl);
    if (pnl !== null) {
      todayPnL += pnl;
      if (pnl > 0) winCount += 1;
      else if (pnl < 0) {
        lossCount += 1;
        if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl);
      }
    }

    if (trade.ruleBreached) {
      ruleBreachesToday += 1;
      lastLoggedBreachTrade = trade;
    }

    const risk = toNum(trade.riskAmount);
    if (maxRiskPerTrade !== null && risk !== null && risk > maxRiskPerTrade) {
      riskPerTradeExceeded = true;
      lastRiskBreachTrade = trade;
    }
  }

  const consecutiveLosses = consecutiveLossStreak(trades);
  const todayTradesCount = trades.length;

  // ── Limits from rules ────────────────────────────────────────────────
  const maxTradesPerDay = rules?.maxTradesPerDay ?? null;
  const stopAfterLosses = rules?.stopAfterLosses ?? null;
  const maxDailyLoss = toNum(rules?.maxDailyLoss);
  const dailyProfitTarget = toNum(rules?.dailyProfitTarget);

  const remainingTrades =
    maxTradesPerDay !== null ? Math.max(0, maxTradesPerDay - todayTradesCount) : null;

  const lossUsed = todayPnL < 0 ? Math.abs(todayPnL) : 0;
  const remainingDailyLossBudget =
    maxDailyLoss !== null ? Math.max(0, maxDailyLoss - lossUsed) : null;

  const dailyProfitTargetProgress =
    dailyProfitTarget !== null && dailyProfitTarget > 0
      ? Math.max(0, Math.min(1, todayPnL / dailyProfitTarget))
      : null;

  // ── Hard breach flags ────────────────────────────────────────────────
  const dailyLossLimitHit =
    maxDailyLoss !== null && lossUsed >= maxDailyLoss && lossUsed > 0;
  const dailyProfitTargetHit =
    dailyProfitTarget !== null && dailyProfitTarget > 0 && todayPnL >= dailyProfitTarget;
  const maxTradesHit =
    maxTradesPerDay !== null && todayTradesCount >= maxTradesPerDay;
  const stopAfterLossesHit =
    stopAfterLosses !== null && stopAfterLosses > 0 && consecutiveLosses >= stopAfterLosses;

  // ── Soft warnings ────────────────────────────────────────────────────
  const approachingDailyLoss =
    !dailyLossLimitHit && maxDailyLoss !== null && maxDailyLoss > 0 && lossUsed >= 0.8 * maxDailyLoss;
  const approachingMaxTrades =
    !maxTradesHit && maxTradesPerDay !== null && remainingTrades === 1;
  const approachingLossStreak =
    !stopAfterLossesHit &&
    stopAfterLosses !== null &&
    stopAfterLosses > 1 &&
    consecutiveLosses === stopAfterLosses - 1;

  // ── Permission verdict ───────────────────────────────────────────────
  // Priority: hardest breach first.
  let blockReason: ManualBreachReason | null = null;
  let lastBreach: ManualRiskState["lastBreach"] = null;

  if (dailyLossLimitHit) blockReason = "daily_loss_limit";
  else if (dailyProfitTargetHit) blockReason = "daily_profit_target";
  else if (stopAfterLossesHit) blockReason = "stop_after_losses";
  else if (maxTradesHit) blockReason = "max_trades";

  // Last breach surfaced in UI: prefer hard block, then risk-per-trade, then logged breach.
  const newestTrade = trades[trades.length - 1] ?? null;
  if (blockReason) {
    const info = buildBreachInfo(blockReason, newestTrade);
    lastBreach = {
      reason: blockReason,
      tradedAt: newestTrade?.tradedAt ?? new Date(),
      label: info.label,
      detail: info.detail,
    };
  } else if (riskPerTradeExceeded && lastRiskBreachTrade) {
    const info = buildBreachInfo("risk_per_trade_exceeded", lastRiskBreachTrade);
    lastBreach = {
      reason: "risk_per_trade_exceeded",
      tradedAt: lastRiskBreachTrade.tradedAt,
      label: info.label,
      detail: info.detail,
    };
  } else if (lastLoggedBreachTrade) {
    const info = buildBreachInfo("rule_breach_logged", lastLoggedBreachTrade);
    lastBreach = {
      reason: "rule_breach_logged",
      tradedAt: lastLoggedBreachTrade.tradedAt,
      label: info.label,
      detail: info.detail,
    };
  }

  const hasWarning =
    approachingDailyLoss ||
    approachingMaxTrades ||
    approachingLossStreak ||
    riskPerTradeExceeded ||
    ruleBreachesToday > 0;

  const permission: ManualRiskPermission = blockReason
    ? "LOCKED"
    : hasWarning
      ? "WARNING"
      : "SAFE";

  return {
    todayPnL,
    todayTradesCount,
    winCount,
    lossCount,
    consecutiveLosses,
    largestLoss,
    ruleBreachesToday,

    remainingTrades,
    remainingDailyLossBudget,
    dailyProfitTargetProgress,

    dailyLossLimitHit,
    dailyProfitTargetHit,
    maxTradesHit,
    stopAfterLossesHit,
    riskPerTradeExceeded,

    approachingDailyLoss,
    approachingMaxTrades,
    approachingLossStreak,

    permission,
    blockReason,
    lastBreach,
  };
}

// ─── Date helpers ────────────────────────────────────────────────────────

/**
 * Returns [startOfTodayUTC, startOfTomorrowUTC) for filtering "today's" trades
 * in the user's display timezone. Caller passes the timezone offset.
 *
 * For now we use server-local "today". Timezone-aware bucketing can be added
 * when we expose user timezone preferences to this layer.
 */
export function getTodayRange(now: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}
