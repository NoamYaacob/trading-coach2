import type {
  NormalizedEvent,
  SessionState,
  AccountRules,
  DetectionContext,
  InterventionOutcome,
} from "./types";

const RAPID_TRADE_WINDOW_MS = 5 * 60_000;
const RAPID_TRADE_THRESHOLD = 3;
const REVENGE_WINDOW_MS = 2 * 60_000;
const DEFAULT_COOLDOWN_MINUTES = 15;
const SIZE_INCREASE_THRESHOLD = 1.25;

export function detectIntervention(
  event: NormalizedEvent,
  state: SessionState,
  rules: AccountRules,
  ctx: DetectionContext,
): InterventionOutcome {
  if (state.cooldownActive || state.riskState === "STOPPED") {
    return { action: "no_action" };
  }

  // Daily loss limit breached
  if (rules.maxDailyLoss !== null && state.dailyPnl <= -Math.abs(rules.maxDailyLoss)) {
    return {
      action: "telegram_message_trigger",
      trigger: "daily_loss_limit",
      coachingIntent: "account_locked",
    };
  }

  // Consecutive losses limit reached
  if (rules.stopAfterLosses !== null && state.consecutiveLosses >= rules.stopAfterLosses) {
    return {
      action: "cooldown",
      trigger: "consecutive_losses",
      durationMinutes: DEFAULT_COOLDOWN_MINUTES,
      message: `${state.consecutiveLosses} consecutive losses — pausing.`,
    };
  }

  // Max trades per day reached
  if (rules.maxTradesPerDay !== null && state.tradesCount >= rules.maxTradesPerDay) {
    return {
      action: "stop",
      trigger: "max_trades_reached",
      message: `Max trades reached (${rules.maxTradesPerDay}).`,
    };
  }

  // Rapid trading: too many trades too quickly
  if (
    ctx.previousTradeAt !== null &&
    state.tradesCount >= RAPID_TRADE_THRESHOLD &&
    event.occurredAt.getTime() - ctx.previousTradeAt.getTime() < RAPID_TRADE_WINDOW_MS
  ) {
    return {
      action: "warning",
      trigger: "rapid_trading",
      message: "Multiple trades in a short window.",
    };
  }

  // Revenge entry: opened trade within 2 min of a loss
  if (
    event.eventType === "trade_opened" &&
    ctx.previousTradePnl !== null &&
    ctx.previousTradePnl < 0 &&
    ctx.previousTradeAt !== null &&
    event.occurredAt.getTime() - ctx.previousTradeAt.getTime() < REVENGE_WINDOW_MS
  ) {
    return {
      action: "telegram_message_trigger",
      trigger: "revenge_entry",
      coachingIntent: "stop_revenge",
    };
  }

  // Increased size after a loss
  if (
    event.quantity !== undefined &&
    ctx.previousTradeQty !== null &&
    ctx.previousTradePnl !== null &&
    ctx.previousTradePnl < 0 &&
    event.quantity > ctx.previousTradeQty * SIZE_INCREASE_THRESHOLD
  ) {
    return {
      action: "warning",
      trigger: "increased_size_after_loss",
      message: "Position size increased after a loss.",
    };
  }

  // Outside allowed trading hours
  if (rules.allowedStartHour !== null && rules.allowedEndHour !== null) {
    const hour = event.occurredAt.getUTCHours();
    if (hour < rules.allowedStartHour || hour >= rules.allowedEndHour) {
      return {
        action: "warning",
        trigger: "outside_allowed_hours",
        message: "Trade outside configured hours.",
      };
    }
  }

  // Unrealized drawdown warning: current open position has floated past risk-per-trade.
  // This fires on daily_pnl_updated events from broker account snapshots.
  if (
    event.unrealizedPnl !== undefined &&
    event.unrealizedPnl < 0 &&
    rules.riskPerTrade !== null &&
    Math.abs(event.unrealizedPnl) > rules.riskPerTrade
  ) {
    return {
      action: "warning",
      trigger: "unrealized_drawdown",
      message: `Unrealized loss (${event.unrealizedPnl.toFixed(2)}) exceeds risk-per-trade (${rules.riskPerTrade}).`,
    };
  }

  return { action: "no_action" };
}
