import type { CoachBrainInput } from "./types";
import type { MarketStatus } from "@/lib/market-hours";
import type { TradingPermission } from "@/lib/trading-status";

/** Formats factual rule/usage data directly in TypeScript. No model call. */
export function buildFactualReply(input: CoachBrainInput): string {
  const { actionId, rules, usage, language } = input;
  const isRemaining = actionId === "remaining";

  if (language === "he") return buildHebrewFactual(rules, usage, isRemaining);
  if (language === "en") return buildEnglishFactual(rules, usage, isRemaining);

  // Fallback: English for unsupported languages
  return buildEnglishFactual(rules, usage, isRemaining);
}

function buildHebrewFactual(
  rules: CoachBrainInput["rules"],
  usage: CoachBrainInput["usage"],
  isRemaining: boolean,
): string {
  const parts: string[] = [];

  if (isRemaining) {
    if (rules.maxDailyLoss != null) {
      const used = Math.abs(Math.min(usage.todayPnL, 0));
      const remaining = Math.max(0, rules.maxDailyLoss - used);
      parts.push(
        used > 0
          ? `נשאר לך ${remaining.toFixed(0)}$ להפסד יומי.`
          : `לא הפסדת עדיין. יש לך ${rules.maxDailyLoss}$ מלאים.`,
      );
    }
    if (rules.maxTradesPerDay != null) {
      parts.push(`עסקאות: ${usage.todayTradesCount} מתוך ${rules.maxTradesPerDay}.`);
    }
    if (rules.stopAfterLosses != null && usage.consecutiveLosses > 0) {
      parts.push(`הפסדות ברצף: ${usage.consecutiveLosses} מתוך ${rules.stopAfterLosses}.`);
    }
  } else {
    if (rules.maxDailyLoss != null) parts.push(`גבול הפסד יומי: ${rules.maxDailyLoss}$.`);
    if (rules.maxTradesPerDay != null) parts.push(`מקסימום עסקאות: ${rules.maxTradesPerDay}.`);
    if (rules.stopAfterLosses != null)
      parts.push(`עצירה אחרי ${rules.stopAfterLosses} הפסדות ברצף.`);
  }

  return parts.length > 0 ? parts.join(" ") : "לא הוגדרו גבולות.";
}

function buildEnglishFactual(
  rules: CoachBrainInput["rules"],
  usage: CoachBrainInput["usage"],
  isRemaining: boolean,
): string {
  const parts: string[] = [];

  if (isRemaining) {
    if (rules.maxDailyLoss != null) {
      const used = Math.abs(Math.min(usage.todayPnL, 0));
      const remaining = Math.max(0, rules.maxDailyLoss - used);
      parts.push(
        used > 0
          ? `$${remaining.toFixed(0)} remaining on daily loss limit.`
          : `Full $${rules.maxDailyLoss} available — no losses yet.`,
      );
    }
    if (rules.maxTradesPerDay != null) {
      parts.push(`Trades: ${usage.todayTradesCount} of ${rules.maxTradesPerDay}.`);
    }
    if (rules.stopAfterLosses != null && usage.consecutiveLosses > 0) {
      parts.push(`Consecutive losses: ${usage.consecutiveLosses} of ${rules.stopAfterLosses}.`);
    }
  } else {
    if (rules.maxDailyLoss != null) parts.push(`Daily loss limit: $${rules.maxDailyLoss}.`);
    if (rules.maxTradesPerDay != null) parts.push(`Max trades: ${rules.maxTradesPerDay}.`);
    if (rules.stopAfterLosses != null)
      parts.push(`Stop after ${rules.stopAfterLosses} consecutive losses.`);
  }

  return parts.length > 0 ? parts.join(" ") : "No limits configured.";
}

// ─── Market-hours reply ───────────────────────────────────────────────────────

const HEBREW_WEEKDAYS: Record<string, string> = {
  Sunday: "ראשון", Monday: "שני", Tuesday: "שלישי",
  Wednesday: "רביעי", Thursday: "חמישי", Friday: "שישי", Saturday: "שבת",
};

const MARKET_NAME_HE: Record<string, string> = {
  FUTURES: "פיוצ'רס", US_EQUITIES: "שוק המניות", FOREX: "פורקס", CRYPTO: "קריפטו",
};

const MARKET_NAME_EN: Record<string, string> = {
  FUTURES: "Futures", US_EQUITIES: "Equities", FOREX: "Forex", CRYPTO: "Crypto",
};

function getZonedDisplay(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit", minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    timeStr: `${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`,
  };
}

function formatTimeHe(date: Date, tz: string, now: Date): string {
  const { weekday, timeStr } = getZonedDisplay(date, tz);
  const diffH = (date.getTime() - now.getTime()) / 3_600_000;
  if (diffH < 12) return `ב-${timeStr}`;
  return `ביום ${HEBREW_WEEKDAYS[weekday] ?? weekday} ב-${timeStr}`;
}

function formatTimeEn(date: Date, tz: string, now: Date): string {
  const { weekday, timeStr } = getZonedDisplay(date, tz);
  const diffH = (date.getTime() - now.getTime()) / 3_600_000;
  if (diffH < 12) return `at ${timeStr}`;
  return `on ${weekday} at ${timeStr}`;
}

function buildMarketHoursHebrewReply(status: MarketStatus): string {
  const now = new Date();
  const tz = status.userTimezone;
  const name = MARKET_NAME_HE[status.marketType] ?? "השוק";

  if (status.isOpen) {
    const parts = [`${name} פתוח.`];
    if (status.sessionName) parts.push(`${status.sessionName}.`);
    if (status.nextClose) parts.push(`נסגר ${formatTimeHe(status.nextClose, tz, now)}.`);
    return parts.join(" ");
  }

  const parts = [`${name} סגור.`];
  if (status.nextOpen) parts.push(`נפתח ${formatTimeHe(status.nextOpen, tz, now)}.`);
  return parts.join(" ");
}

function buildMarketHoursEnglishReply(status: MarketStatus): string {
  const now = new Date();
  const tz = status.userTimezone;
  const name = MARKET_NAME_EN[status.marketType] ?? "Market";

  if (status.isOpen) {
    const parts = [`${name} is open.`];
    if (status.sessionName) parts.push(`Session: ${status.sessionName}.`);
    if (status.nextClose) parts.push(`Closes ${formatTimeEn(status.nextClose, tz, now)}.`);
    return parts.join(" ");
  }

  const parts = [`${name} is closed.`];
  if (status.nextOpen) parts.push(`Opens ${formatTimeEn(status.nextOpen, tz, now)}.`);
  return parts.join(" ");
}

/** Formats market open/close status directly in TypeScript. No model call. */
export function buildMarketHoursReply(input: CoachBrainInput): string {
  if (!input.marketStatus) {
    return input.language === "he" ? "אין מידע על שעות מסחר." : "No market hours data available.";
  }
  if (input.language === "he") return buildMarketHoursHebrewReply(input.marketStatus);
  return buildMarketHoursEnglishReply(input.marketStatus);
}

// ─── Trading-status reply ─────────────────────────────────────────────────────

function buildTradingStatusHebrewReply(
  perm: TradingPermission,
  input: CoachBrainInput,
): string {
  if (!perm.allowedToTrade) {
    switch (perm.blockReason) {
      case "market_closed":
        // Redirect to market-hours handler; this path shouldn't fire in practice
        // because market_hours routing takes priority, but handle defensively.
        return input.marketStatus
          ? buildMarketHoursHebrewReply(input.marketStatus)
          : "השוק סגור עכשיו.";

      case "daily_loss_limit":
        return "הגעת לסטופ היומי. המסחר להיום נעצר.";

      case "max_trades": {
        const limit = input.rules.maxTradesPerDay;
        return limit !== null
          ? `הגעת ל-${limit} עסקאות היום. לא פותחים עוד עסקה.`
          : "הגעת למגבלת העסקאות היומית. לא פותחים עוד עסקה.";
      }

      case "consecutive_losses": {
        const limit = input.rules.stopAfterLosses;
        return limit !== null
          ? `${limit} הפסדות ברצף — הגעת לגבול. עוצרים להיום.`
          : "הגעת למגבלת ההפסדות ברצף. עוצרים להיום.";
      }

      case "session_ended":
        return "הסשן היומי נסגר. מחכים למחר.";

      case "guardian_locked":
        return "חשבון ננעל. המסחר מושעה.";

      case "pre_news_block":
        return "מסחר חסום לפני אירוע מאקרו.";

      default:
        return "מסחר מעוצר כרגע.";
    }
  }

  // Allowed — give compact status
  const parts: string[] = ["אפשר לסחור."];
  if (perm.remainingTrades !== null) {
    parts.push(`נשאר ${perm.remainingTrades} עסקאות.`);
  }
  if (perm.remainingDailyLossBudget !== null) {
    parts.push(`${perm.remainingDailyLossBudget.toFixed(0)}$ להפסד יומי.`);
  }
  return parts.join(" ");
}

function buildTradingStatusEnglishReply(
  perm: TradingPermission,
  input: CoachBrainInput,
): string {
  if (!perm.allowedToTrade) {
    switch (perm.blockReason) {
      case "market_closed":
        return input.marketStatus
          ? buildMarketHoursEnglishReply(input.marketStatus)
          : "Market is closed right now.";

      case "daily_loss_limit":
        return "Daily loss limit reached. Trading is stopped for today.";

      case "max_trades": {
        const limit = input.rules.maxTradesPerDay;
        return limit !== null
          ? `${limit} trades reached for today. No more entries.`
          : "Daily trade limit reached. No more entries.";
      }

      case "consecutive_losses": {
        const limit = input.rules.stopAfterLosses;
        return limit !== null
          ? `${limit} consecutive losses — limit reached. Stop now.`
          : "Consecutive loss limit reached. Stop now.";
      }

      case "session_ended":
        return "Today's session has ended. Wait for tomorrow.";

      case "guardian_locked":
        return "Account locked. Trading is suspended.";

      case "pre_news_block":
        return "Trading blocked — major economic event.";

      default:
        return "Trading is stopped right now.";
    }
  }

  const parts: string[] = ["You can trade."];
  if (perm.remainingTrades !== null) {
    parts.push(`${perm.remainingTrades} trades remaining.`);
  }
  if (perm.remainingDailyLossBudget !== null) {
    parts.push(`$${perm.remainingDailyLossBudget.toFixed(0)} loss budget left.`);
  }
  return parts.join(" ");
}

/**
 * Formats trading permission status directly in TypeScript. No model call.
 * Answers "can I trade?" with either a clear block reason or remaining capacity.
 */
export function buildTradingStatusReply(input: CoachBrainInput): string {
  if (!input.tradingPermission) {
    return input.language === "he" ? "אין מידע על מצב המסחר." : "No trading status data available.";
  }
  if (input.language === "he") return buildTradingStatusHebrewReply(input.tradingPermission, input);
  return buildTradingStatusEnglishReply(input.tradingPermission, input);
}
