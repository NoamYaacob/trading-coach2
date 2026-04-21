/**
 * Intervention engine — maps trading events to coaching urgency levels and
 * generates the right coaching context for the AI or rule-based reply.
 *
 * Current events fire from Guardian rule evaluation and manual signals.
 * Broker event types are declared as structural placeholders for when live
 * trading integrations land.
 */

// ─── Event types ─────────────────────────────────────────────────────────────

/** Events the system can generate today (manual + Guardian-derived). */
export type CurrentInterventionEvent =
  | { type: "pre_session_check_in" }
  | { type: "near_daily_loss_limit"; pctUsed: number; remaining: number }
  | { type: "exceeded_trade_count"; count: number; limit: number }
  | { type: "consecutive_losses_warning"; streak: number; limit: number }
  | { type: "revenge_trading_signal"; traderState: string }
  | { type: "end_of_day_review"; pnl: number; tradeCount: number }
  | { type: "mid_session_goal_reminder"; goal: string };

/**
 * Future broker-sourced events — declared as a discriminated union so the
 * engine can be extended without changing call-sites.
 * None of these fire yet; they will be populated by live broker webhooks.
 */
export type FutureBrokerEvent =
  | { type: "broker_trade_opened"; symbol: string; side: "long" | "short"; size: number }
  | { type: "broker_drawdown_alert"; pct: number; accountPeak: number }
  | { type: "broker_position_oversized"; riskPct: number; maxRiskPct: number }
  | { type: "broker_overtrading_burst"; tradesInWindow: number; windowMinutes: number };

export type InterventionEvent = CurrentInterventionEvent | FutureBrokerEvent;

// ─── Urgency ─────────────────────────────────────────────────────────────────

export type InterventionUrgency = "low" | "medium" | "high" | "critical";

function classifyUrgency(event: InterventionEvent): InterventionUrgency {
  switch (event.type) {
    case "pre_session_check_in":
    case "mid_session_goal_reminder":
      return "low";

    case "near_daily_loss_limit":
      return event.pctUsed >= 0.9 ? "high" : "medium";

    case "exceeded_trade_count":
      return "high";

    case "consecutive_losses_warning":
      return event.streak >= event.limit ? "critical" : "high";

    case "revenge_trading_signal":
      return "critical";

    case "end_of_day_review":
      return "low";

    // Future broker events
    case "broker_drawdown_alert":
      return event.pct >= 0.8 ? "critical" : "high";

    case "broker_position_oversized":
      return "high";

    case "broker_overtrading_burst":
      return event.tradesInWindow >= 5 ? "critical" : "high";

    case "broker_trade_opened":
      return "low";

    default:
      return "medium";
  }
}

// ─── Intervention result ─────────────────────────────────────────────────────

export type InterventionResult = {
  event: InterventionEvent;
  urgency: InterventionUrgency;
  shouldSendTelegram: boolean;
  /** One-sentence coaching prompt sent to AI or used as fallback text. */
  coachingPrompt: string;
  /** Short label for the event, used in logs and UI. */
  label: string;
};

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildCoachingPrompt(event: InterventionEvent): string {
  switch (event.type) {
    case "pre_session_check_in":
      return "New session is starting. Give a brief grounding check-in — one question or anchor for today.";

    case "near_daily_loss_limit":
      return `Trader has used ${Math.round(event.pctUsed * 100)}% of their daily loss limit with $${event.remaining} remaining. Give a calm, direct warning — one line. No lecture.`;

    case "exceeded_trade_count":
      return `Trader has taken ${event.count} trades against a ${event.limit}-trade daily limit. The day should be done. Be firm but not harsh.`;

    case "consecutive_losses_warning":
      return `Trader is on a ${event.streak}-loss streak against a ${event.limit}-loss limit. Name the pattern and give a clear redirect — stop or pause.`;

    case "revenge_trading_signal":
      return `Trader state is ${event.traderState} — revenge trading signal active. Name the state directly. One redirect: step away. Not a negotiation.`;

    case "end_of_day_review":
      return `Session ended. PnL: ${event.pnl >= 0 ? "+" : ""}${event.pnl}, ${event.tradeCount} trades. Give a brief end-of-day reflection — acknowledge what happened, one forward thought.`;

    case "mid_session_goal_reminder":
      return `Mid-session check-in. Trader's goal: "${event.goal}". Remind them gently — one line. Not preachy.`;

    // Future broker events
    case "broker_trade_opened":
      return `Broker trade opened: ${event.side} ${event.size} ${event.symbol}. Acknowledge and stay grounded.`;

    case "broker_drawdown_alert":
      return `Account drawdown at ${Math.round(event.pct * 100)}% of peak. Direct warning — one line.`;

    case "broker_position_oversized":
      return `Position risk at ${event.riskPct}% against ${event.maxRiskPct}% max. Flag it clearly.`;

    case "broker_overtrading_burst":
      return `${event.tradesInWindow} trades in ${event.windowMinutes} minutes — overtrading signal. Name it and ask them to pause.`;
  }
}

function buildLabel(event: InterventionEvent): string {
  switch (event.type) {
    case "pre_session_check_in": return "Pre-session check-in";
    case "near_daily_loss_limit": return "Near daily loss limit";
    case "exceeded_trade_count": return "Trade count exceeded";
    case "consecutive_losses_warning": return "Consecutive losses warning";
    case "revenge_trading_signal": return "Revenge trading signal";
    case "end_of_day_review": return "End-of-day review";
    case "mid_session_goal_reminder": return "Goal reminder";
    case "broker_trade_opened": return "Trade opened";
    case "broker_drawdown_alert": return "Drawdown alert";
    case "broker_position_oversized": return "Position oversized";
    case "broker_overtrading_burst": return "Overtrading burst";
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Evaluate an intervention event and return a structured result.
 * Call-sites decide whether to send the result to Telegram, log it, etc.
 */
export function evaluateIntervention(event: InterventionEvent): InterventionResult {
  const urgency = classifyUrgency(event);
  const shouldSendTelegram = urgency !== "low" || event.type === "pre_session_check_in" || event.type === "end_of_day_review";

  return {
    event,
    urgency,
    shouldSendTelegram,
    coachingPrompt: buildCoachingPrompt(event),
    label: buildLabel(event),
  };
}

/**
 * Evaluate multiple events and return only those that should trigger a
 * Telegram message, sorted by urgency (critical → high → medium → low).
 */
export function filterActionableInterventions(
  events: InterventionEvent[],
): InterventionResult[] {
  const urgencyOrder: Record<InterventionUrgency, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return events
    .map(evaluateIntervention)
    .filter((r) => r.shouldSendTelegram)
    .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
}
