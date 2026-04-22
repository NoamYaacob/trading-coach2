import type { CoachBrainInput } from "./types";

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
