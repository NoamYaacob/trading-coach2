import type { CoachBrainInput } from "./types";
import { getLocale } from "@/lib/i18n";
import { formatMarketTimeForUser } from "@/lib/market-hours";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function t(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

function formatAmount(amount: number, language: string): string {
  const n = Math.round(amount).toString();
  return language === "he" ? `${n}$` : `$${n}`;
}

// ─── Factual rule/usage reply ─────────────────────────────────────────────────

/** Formats factual rule/usage data directly in TypeScript. No model call. */
export function buildFactualReply(input: CoachBrainInput): string {
  const { actionId, rules, usage, language } = input;
  const f = getLocale(language).factual;
  const isRemaining = actionId === "remaining";
  const parts: string[] = [];

  if (isRemaining) {
    if (rules.maxDailyLoss != null) {
      const used = Math.abs(Math.min(usage.todayPnL, 0));
      const remaining = Math.max(0, rules.maxDailyLoss - used);
      parts.push(
        used > 0
          ? t(f.lossRemainingUsed, { amount: formatAmount(remaining, language) })
          : t(f.lossRemainingFull, { amount: formatAmount(rules.maxDailyLoss, language) }),
      );
    }
    if (rules.maxTradesPerDay != null) {
      parts.push(t(f.tradesCountLine, { count: usage.todayTradesCount, limit: rules.maxTradesPerDay }));
    }
    if (rules.stopAfterLosses != null && usage.consecutiveLosses > 0) {
      parts.push(t(f.consecutiveLossesLine, { count: usage.consecutiveLosses, limit: rules.stopAfterLosses }));
    }
  } else {
    if (rules.maxDailyLoss != null) {
      parts.push(t(f.dailyLossLimitLine, { amount: formatAmount(rules.maxDailyLoss, language) }));
    }
    if (rules.maxTradesPerDay != null) {
      parts.push(t(f.maxTradesLine, { limit: rules.maxTradesPerDay }));
    }
    if (rules.stopAfterLosses != null) {
      parts.push(t(f.stopAfterLossesLine, { limit: rules.stopAfterLosses }));
    }
  }

  return parts.length > 0 ? parts.join(" ") : f.noLimitsConfigured;
}

// ─── Market-hours reply ───────────────────────────────────────────────────────

/** Formats market open/close status directly in TypeScript. No model call. */
export function buildMarketHoursReply(input: CoachBrainInput): string {
  const { language } = input;
  const f = getLocale(language).factual;

  if (!input.marketStatus) return f.noMarketData;

  const status = input.marketStatus;
  const now = new Date();
  const name = f.markets[status.marketType] ?? status.marketType;
  const session = status.sessionName ? (f.sessions[status.sessionName] ?? status.sessionName) : null;
  const tz = status.userTimezone;

  if (status.marketOpen) {
    if (status.nextCloseAtUtc) {
      const time = formatMarketTimeForUser(status.nextCloseAtUtc, tz, language, now);
      if (session) return t(f.marketOpenSession, { name, session, time });
      return t(f.marketOpen, { name, time });
    }
    // No close time (e.g. crypto 24/7)
    return t(f.marketOpenNoClose, { name });
  }

  if (status.nextOpenAtUtc) {
    const time = formatMarketTimeForUser(status.nextOpenAtUtc, tz, language, now);
    return t(f.marketClosedNextOpen, { name, time });
  }
  return t(f.marketClosed, { name });
}

// ─── Trading-status reply ─────────────────────────────────────────────────────

/**
 * Formats trading permission status directly in TypeScript. No model call.
 * Answers "can I trade?" with either a clear block reason or remaining capacity.
 */
export function buildTradingStatusReply(input: CoachBrainInput): string {
  const { language } = input;
  const f = getLocale(language).factual;

  if (!input.tradingPermission) return f.noTradingData;

  const perm = input.tradingPermission;

  if (!perm.allowedToTrade) {
    switch (perm.blockReason) {
      case "market_closed":
        return buildMarketHoursReply(input);

      case "daily_loss_limit":
        return f.dailyLossLimitHit;

      case "max_trades": {
        const limit = input.rules.maxTradesPerDay;
        return limit !== null ? t(f.maxTradesHit, { limit }) : f.maxTradesHitGeneric;
      }

      case "consecutive_losses": {
        const limit = input.rules.stopAfterLosses;
        return limit !== null ? t(f.consecutiveLossesHit, { limit }) : f.consecutiveLossesHitGeneric;
      }

      case "session_ended":
        return f.sessionEnded;

      case "guardian_locked":
        return f.guardianLocked;

      case "pre_news_block":
        return f.preNewsBlock;

      default:
        return f.tradingBlocked;
    }
  }

  const parts: string[] = [f.tradingAllowed];
  if (perm.remainingTrades !== null) {
    parts.push(t(f.tradesRemaining, { count: perm.remainingTrades }));
  }
  if (perm.remainingDailyLossBudget !== null) {
    parts.push(t(f.lossBudgetRemaining, { amount: formatAmount(perm.remainingDailyLossBudget, language) }));
  }
  return parts.join(" ");
}
