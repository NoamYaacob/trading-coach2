/**
 * Trading Permission Service
 *
 * Pure, side-effect-free layer that combines market-hours status and
 * the rule-engine violation feed into a single TradingPermission object.
 *
 * Consumers: Telegram coach, dashboard UI, future execution guardrails.
 * Does NOT make DB calls. Takes pre-computed data from callers.
 */

import type { MarketStatus } from "@/lib/market-hours";
import type { ViolationFeed } from "@/lib/rule-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TradingBlockReason =
  | "market_closed"
  | "daily_loss_limit"
  | "max_trades"
  | "consecutive_losses"
  | "session_ended"
  | "guardian_locked"
  | "pre_news_block";

/**
 * Unified trading permission snapshot.
 * allowedToTrade is the single gate; all other fields give the UI richer context.
 */
export type TradingPermission = {
  allowedToTrade: boolean;
  /** Primary reason trading is not allowed. null when allowedToTrade is true. */
  blockReason: TradingBlockReason | null;
  /** Remaining trades before daily limit. null when no limit is configured. */
  remainingTrades: number | null;
  /** Remaining loss budget in account currency. null when no limit is configured. */
  remainingDailyLossBudget: number | null;
  dailyLossLimitHit: boolean;
  maxTradesHit: boolean;
  stopAfterLossesTriggered: boolean;
  /** True when the exchange/market is currently outside trading hours. */
  marketClosed: boolean;
};

export type TradingPermissionInput = {
  marketStatus: MarketStatus;
  violationFeed: ViolationFeed;
  guardianLocked: boolean;
  sessionEnded: boolean;
  maxTradesPerDay: number | null;
  todayTradesCount: number;
  maxDailyLoss: number | null;
  todayPnL: number;
  stopAfterLosses: number | null;
  consecutiveLosses: number;
};

// ─── Core evaluator ───────────────────────────────────────────────────────────

/**
 * Compute trading permission from pre-evaluated data.
 * Priority order when multiple blocks apply:
 *   1. market_closed
 *   2. guardian_locked
 *   3. session_ended
 *   4. daily_loss_limit (critical severity)
 *   5. max_trades
 *   6. consecutive_losses
 *   7. pre_news_block
 */
export function getTradingPermission(input: TradingPermissionInput): TradingPermission {
  const {
    marketStatus, violationFeed, guardianLocked, sessionEnded,
    maxTradesPerDay, todayTradesCount, maxDailyLoss, todayPnL,
    stopAfterLosses, consecutiveLosses,
  } = input;

  // Derived flags from the rule engine
  const dailyLossLimitHit = violationFeed.triggeredViolations.some(v => v.ruleId === "max_daily_loss");
  const maxTradesHit = violationFeed.triggeredViolations.some(v => v.ruleId === "max_trades_per_day");
  const stopAfterLossesTriggered = violationFeed.triggeredViolations.some(
    v => v.ruleId === "stop_after_consecutive_losses",
  );
  const preNewsBlocked = violationFeed.blockedViolations.some(
    v => v.ruleId === "no_trade_before_major_news",
  );
  const marketClosed = !marketStatus.marketOpen;

  // Remaining capacity (always computed regardless of block state — useful for UI)
  const remainingTrades =
    maxTradesPerDay !== null ? Math.max(0, maxTradesPerDay - todayTradesCount) : null;
  const lossUsed = Math.abs(Math.min(todayPnL, 0));
  const remainingDailyLossBudget =
    maxDailyLoss !== null ? Math.max(0, maxDailyLoss - lossUsed) : null;

  // Priority-ordered block detection
  let blockReason: TradingBlockReason | null = null;

  if (marketClosed) {
    blockReason = "market_closed";
  } else if (guardianLocked) {
    blockReason = "guardian_locked";
  } else if (sessionEnded) {
    blockReason = "session_ended";
  } else if (dailyLossLimitHit) {
    blockReason = "daily_loss_limit";
  } else if (maxTradesHit) {
    blockReason = "max_trades";
  } else if (stopAfterLossesTriggered) {
    blockReason = "consecutive_losses";
  } else if (preNewsBlocked) {
    blockReason = "pre_news_block";
  }

  return {
    allowedToTrade: blockReason === null,
    blockReason,
    remainingTrades,
    remainingDailyLossBudget,
    dailyLossLimitHit,
    maxTradesHit,
    stopAfterLossesTriggered,
    marketClosed,
  };
}

// ─── Intent detection ─────────────────────────────────────────────────────────

const PATTERNS_HE = [
  "אפשר לסחור",
  "אפשר לפתוח",
  "האם אני יכול לסחור",
  "האם אפשר לסחור",
  "האם אני חייב לעצור",
  "האם הגעתי לסטופ",
  "הגעתי לסטופ",
  "האם עצרתי",
  "עדיין אפשר לסחור",
  "עדיין אפשר",
  "כבר עצרתי",
  "האם פגעתי בגבול",
  "מותר לסחור",
  "יש לי עסקאות",
  "נשאר לי",
];

const PATTERNS_EN = [
  "can i trade",
  "can i open",
  "am i allowed to trade",
  "am i stopped",
  "did i hit my limit",
  "have i reached my limit",
  "am i done for the day",
  "can i open another",
  "am i blocked",
  "how many trades left",
  "trading allowed",
];

/** True when the user is explicitly asking about their trading permission / status. */
export function isTradingStatusQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return (
    PATTERNS_HE.some(p => lower.includes(p)) ||
    PATTERNS_EN.some(p => lower.includes(p))
  );
}
