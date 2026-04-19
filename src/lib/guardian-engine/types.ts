export type NormalizedEventType =
  | "trade_opened"
  | "trade_closed"
  | "position_size_changed"
  | "daily_pnl_updated"
  | "loss_streak_updated"
  | "rule_warning_triggered"
  | "rule_breach_triggered"
  | "cooldown_started"
  | "cooldown_ended";

export type NormalizedEvent = {
  accountId: string;
  eventType: NormalizedEventType;
  externalTradeId?: string;
  side?: "BUY" | "SELL";
  quantity?: number;
  price?: number;
  pnl?: number;
  occurredAt: Date;
  rawPayload?: unknown;
};

export type SessionState = {
  accountId: string;
  sessionDate: string;
  dailyPnl: number;
  tradesCount: number;
  consecutiveLosses: number;
  lastTradeAt: Date | null;
  cooldownActive: boolean;
  cooldownUntil: Date | null;
  riskState: "NORMAL" | "WARNING" | "STOPPED";
};

export type AccountRules = {
  maxDailyLoss: number | null;
  riskPerTrade: number | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  allowedStartHour: number | null;
  allowedEndHour: number | null;
};

export type DetectionTrigger =
  | "consecutive_losses"
  | "rapid_trading"
  | "revenge_entry"
  | "increased_size_after_loss"
  | "outside_allowed_hours"
  | "daily_loss_limit"
  | "max_trades_reached";

export type DetectionContext = {
  previousTradeAt: Date | null;
  previousTradePnl: number | null;
  previousTradeQty: number | null;
};

export type InterventionOutcome =
  | { action: "no_action" }
  | { action: "warning"; trigger: DetectionTrigger; message: string }
  | { action: "stop"; trigger: DetectionTrigger; message: string }
  | { action: "cooldown"; trigger: DetectionTrigger; durationMinutes: number; message: string }
  | { action: "telegram_message_trigger"; trigger: DetectionTrigger; coachingIntent: string };
