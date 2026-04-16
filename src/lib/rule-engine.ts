/**
 * Rule Engine v1
 *
 * A shared evaluation layer for trader discipline rules.
 * Returns normalized, structured results consumable by:
 * - Dashboard (readiness / Guardian context)
 * - Telegram coach (status replies + log metadata)
 * - Today Activity (violation-derived items)
 * - Post-Session Review (violation bullets)
 *
 * This is NOT a replacement for Guardian's control/enforcement layer.
 * Guardian remains responsible for lockouts, resets, and persistence.
 * This layer is purely evaluative and side-effect-free.
 */

import type { GuardianSnapshot } from "@/lib/guardian";

// ─── Rule types ────────────────────────────────────────────────────────────────

export type RuleType =
  | "max_trades_per_day"
  | "max_daily_loss"
  | "stop_after_consecutive_losses"
  | "no_trade_before_major_news"
  | "session_not_started"
  | "session_closed"
  | "guardian_disabled";

export type RuleStatus = "ok" | "warning" | "blocked" | "triggered";
export type RuleSeverity = "low" | "medium" | "high" | "critical";

// ─── Normalized output ─────────────────────────────────────────────────────────

export type RuleResult = {
  /** Stable identifier matching RuleType */
  ruleId: RuleType;
  ruleType: RuleType;
  /** ok = within limits; warning = approaching / soft caution; blocked = hard stop (session/news); triggered = limit breached */
  status: RuleStatus;
  /** Technical description of why this status was set */
  reason: string;
  /** Short product-facing message (Hebrew) */
  message: string;
  severity: RuleSeverity;
  timestamp: Date;
  /** Optional next step surfaced to the trader */
  recommendedAction?: string;
};

// ─── Input ─────────────────────────────────────────────────────────────────────

export type RuleEngineInput = {
  guardianEnabled: boolean;
  maxTradesPerDay: number | null;
  todayTradesCount: number;
  maxDailyLoss: number | null;
  todayPnL: number;
  stopAfterConsecutiveLosses: number | null;
  consecutiveLosses: number;
  sessionStarted: boolean;
  sessionEnded: boolean;
  /** TodaySessionStateKind from guardian.ts */
  todaySessionStateKind: string;
  preNewsPolicy?: {
    isActive: boolean;
    /** "HARD_BLOCK_MAJOR" | "SOFT_CAUTION" | "WARNING_ONLY" | "OFF" */
    mode: string;
    message?: string | null;
  } | null;
  now?: Date;
};

// ─── Violation feed ────────────────────────────────────────────────────────────

export type ViolationFeed = {
  /** All evaluated rule results (ok + non-ok) */
  results: RuleResult[];
  /** Results with status !== "ok" */
  activeViolations: RuleResult[];
  /** Results with status === "blocked" */
  blockedViolations: RuleResult[];
  /** Results with status === "triggered" (limit breached) */
  triggeredViolations: RuleResult[];
  /** Results with status === "warning" */
  warningViolations: RuleResult[];
  /** True if any rule is blocked or triggered */
  hasBlockingViolation: boolean;
  /** Highest-priority non-ok violation, or null if all ok */
  primaryViolation: RuleResult | null;
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

function severityOrder(severity: RuleSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

function statusOrder(status: RuleStatus): number {
  switch (status) {
    case "triggered":
      return 4;
    case "blocked":
      return 3;
    case "warning":
      return 2;
    case "ok":
      return 1;
  }
}

// ─── Evaluation ────────────────────────────────────────────────────────────────

/**
 * Evaluate all v1 discipline rules against the provided input.
 * Pure function — no DB calls, no side effects.
 */
export function evaluateRules(input: RuleEngineInput): RuleResult[] {
  const now = input.now ?? new Date();
  const results: RuleResult[] = [];

  // ── guardian_disabled ───────────────────────────────────────────────────────
  if (!input.guardianEnabled) {
    results.push({
      ruleId: "guardian_disabled",
      ruleType: "guardian_disabled",
      status: "warning",
      reason: "Guardian is not enabled for this session.",
      message: "הגארדיאן כבוי — חוקי הסיכון לא נאכפים.",
      severity: "medium",
      timestamp: now,
      recommendedAction: "הפעל את הגארדיאן לפני שמתחילים לסחור.",
    });
  } else {
    results.push({
      ruleId: "guardian_disabled",
      ruleType: "guardian_disabled",
      status: "ok",
      reason: "Guardian is active.",
      message: "הגארדיאן פעיל.",
      severity: "low",
      timestamp: now,
    });
  }

  // ── max_trades_per_day ──────────────────────────────────────────────────────
  if (input.maxTradesPerDay !== null && input.maxTradesPerDay !== undefined) {
    if (input.todayTradesCount >= input.maxTradesPerDay) {
      results.push({
        ruleId: "max_trades_per_day",
        ruleType: "max_trades_per_day",
        status: "triggered",
        reason: `Trade count ${input.todayTradesCount} reached or exceeded limit of ${input.maxTradesPerDay}.`,
        message: `הגעת למקסימום הסחרות היומי (${input.maxTradesPerDay}). אין יותר כניסות היום.`,
        severity: "high",
        timestamp: now,
        recommendedAction: "עצור. אין להמשיך לסחור היום.",
      });
    } else if (
      input.maxTradesPerDay > 1 &&
      input.todayTradesCount >= input.maxTradesPerDay - 1
    ) {
      results.push({
        ruleId: "max_trades_per_day",
        ruleType: "max_trades_per_day",
        status: "warning",
        reason: `Trade count ${input.todayTradesCount} is one away from the limit of ${input.maxTradesPerDay}.`,
        message: `נותרת סחרה אחת עד למכסה היומית (${input.maxTradesPerDay}).`,
        severity: "medium",
        timestamp: now,
        recommendedAction: "בחר בקפידה את הסחרה הבאה.",
      });
    } else {
      results.push({
        ruleId: "max_trades_per_day",
        ruleType: "max_trades_per_day",
        status: "ok",
        reason: `Trade count ${input.todayTradesCount} is within limit of ${input.maxTradesPerDay}.`,
        message: `${input.todayTradesCount} מתוך ${input.maxTradesPerDay} סחרות היום.`,
        severity: "low",
        timestamp: now,
      });
    }
  }

  // ── max_daily_loss ──────────────────────────────────────────────────────────
  if (input.maxDailyLoss !== null && input.maxDailyLoss !== undefined) {
    if (input.todayPnL <= -input.maxDailyLoss) {
      results.push({
        ruleId: "max_daily_loss",
        ruleType: "max_daily_loss",
        status: "triggered",
        reason: `Daily PnL ${input.todayPnL} breached max daily loss limit of -${input.maxDailyLoss}.`,
        message: `הגעת להפסד היומי המקסימלי (${input.maxDailyLoss}). המסחר נעצר.`,
        severity: "critical",
        timestamp: now,
        recommendedAction: "עצור לחלוטין. חכה לחלון האיפוס לפני שמתחילים מחדש.",
      });
    } else {
      const warningThreshold = input.maxDailyLoss * 0.8;
      const approachingLimit =
        input.todayPnL < 0 && Math.abs(input.todayPnL) >= warningThreshold;

      results.push({
        ruleId: "max_daily_loss",
        ruleType: "max_daily_loss",
        status: approachingLimit ? "warning" : "ok",
        reason: approachingLimit
          ? `Daily PnL ${input.todayPnL} is approaching max daily loss of -${input.maxDailyLoss}.`
          : `Daily PnL ${input.todayPnL} is within max daily loss limit of -${input.maxDailyLoss}.`,
        message: approachingLimit
          ? `מתקרב לגבול ההפסד היומי. PnL: ${input.todayPnL}, גבול: -${input.maxDailyLoss}.`
          : `PnL היומי: ${input.todayPnL}. הגבול הוא -${input.maxDailyLoss}.`,
        severity: approachingLimit ? "high" : "low",
        timestamp: now,
        recommendedAction: approachingLimit
          ? "שמור על מינוף נמוך ושקול לעצור."
          : undefined,
      });
    }
  }

  // ── stop_after_consecutive_losses ───────────────────────────────────────────
  if (
    input.stopAfterConsecutiveLosses !== null &&
    input.stopAfterConsecutiveLosses !== undefined
  ) {
    if (input.consecutiveLosses >= input.stopAfterConsecutiveLosses) {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "triggered",
        reason: `Consecutive losses ${input.consecutiveLosses} reached limit of ${input.stopAfterConsecutiveLosses}.`,
        message: `הגעת ל-${input.consecutiveLosses} הפסדים רצופים (גבול: ${input.stopAfterConsecutiveLosses}). עצור עכשיו.`,
        severity: "high",
        timestamp: now,
        recommendedAction: "עצור. קח הפסקה ואל תיכנס לעסקה נוספת.",
      });
    } else if (input.consecutiveLosses > 0) {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "warning",
        reason: `${input.consecutiveLosses} consecutive losses, limit is ${input.stopAfterConsecutiveLosses}.`,
        message: `${input.consecutiveLosses} הפסדים רצופים. הגבול הוא ${input.stopAfterConsecutiveLosses}.`,
        severity: "medium",
        timestamp: now,
        recommendedAction: "שמור על ריסון. הפסד נוסף יעצור אותך.",
      });
    } else {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "ok",
        reason: "No consecutive losses.",
        message: "אין הפסדים רצופים.",
        severity: "low",
        timestamp: now,
      });
    }
  }

  // ── no_trade_before_major_news ──────────────────────────────────────────────
  if (input.preNewsPolicy?.isActive) {
    const mode = input.preNewsPolicy.mode;

    if (mode === "HARD_BLOCK_MAJOR") {
      results.push({
        ruleId: "no_trade_before_major_news",
        ruleType: "no_trade_before_major_news",
        status: "blocked",
        reason: "Major economic event active. Trading blocked by pre-news policy.",
        message:
          input.preNewsPolicy.message ??
          "אירוע כלכלי גדול פעיל — המסחר חסום עד סיום החלון.",
        severity: "high",
        timestamp: now,
        recommendedAction: "המתן לסיום חלון האירוע לפני שמתחילים.",
      });
    } else if (mode === "SOFT_CAUTION") {
      results.push({
        ruleId: "no_trade_before_major_news",
        ruleType: "no_trade_before_major_news",
        status: "warning",
        reason: "Major economic event approaching. Caution mode active.",
        message:
          input.preNewsPolicy.message ??
          "אירוע כלכלי משמעותי מתקרב — המשך בזהירות.",
        severity: "medium",
        timestamp: now,
        recommendedAction: "שמור על גודל עסקה קטן ותוכנית ברורה.",
      });
    } else {
      // WARNING_ONLY
      results.push({
        ruleId: "no_trade_before_major_news",
        ruleType: "no_trade_before_major_news",
        status: "warning",
        reason: "Economic event nearby. Warning mode active.",
        message:
          input.preNewsPolicy.message ?? "אירוע כלכלי בקרבת מקום — היה ערני.",
        severity: "low",
        timestamp: now,
      });
    }
  } else {
    results.push({
      ruleId: "no_trade_before_major_news",
      ruleType: "no_trade_before_major_news",
      status: "ok",
      reason: "No active economic event policy.",
      message: "אין אירוע כלכלי פעיל.",
      severity: "low",
      timestamp: now,
    });
  }

  // ── session_not_started ─────────────────────────────────────────────────────
  if (!input.sessionStarted && !input.sessionEnded) {
    results.push({
      ruleId: "session_not_started",
      ruleType: "session_not_started",
      status: "warning",
      reason: "Trading session has not been started for today.",
      message: "הסשן היומי טרם הופעל.",
      severity: "low",
      timestamp: now,
      recommendedAction: "פתח את הסשן לפני שמתחילים לסחור.",
    });
  } else {
    results.push({
      ruleId: "session_not_started",
      ruleType: "session_not_started",
      status: "ok",
      reason: "Session has been started or the day is closed.",
      message: "הסשן פתוח.",
      severity: "low",
      timestamp: now,
    });
  }

  // ── session_closed ──────────────────────────────────────────────────────────
  if (input.sessionEnded) {
    results.push({
      ruleId: "session_closed",
      ruleType: "session_closed",
      status: "blocked",
      reason: "The trading session for today has been closed.",
      message: "הסשן היומי נסגר.",
      severity: "medium",
      timestamp: now,
      recommendedAction: "המתן לסשן מחר.",
    });
  } else if (
    input.todaySessionStateKind === "LOCKED_BY_GUARDIAN" ||
    input.todaySessionStateKind === "RESET_PENDING"
  ) {
    results.push({
      ruleId: "session_closed",
      ruleType: "session_closed",
      status: "blocked",
      reason: "Guardian has locked the session.",
      message: "הגארדיאן נעל את הסשן.",
      severity: "high",
      timestamp: now,
      recommendedAction: "המתן לחלון האיפוס.",
    });
  } else {
    results.push({
      ruleId: "session_closed",
      ruleType: "session_closed",
      status: "ok",
      reason: "Session is not closed.",
      message: "הסשן לא נסגר.",
      severity: "low",
      timestamp: now,
    });
  }

  return results;
}

// ─── Violation feed builder ────────────────────────────────────────────────────

/**
 * Run rule evaluation and return a structured violation feed.
 * Violations are sorted by severity (triggered > blocked > warning).
 */
export function buildViolationFeed(input: RuleEngineInput): ViolationFeed {
  const results = evaluateRules(input);
  const activeViolations = results.filter((r) => r.status !== "ok");
  const blockedViolations = results.filter((r) => r.status === "blocked");
  const triggeredViolations = results.filter((r) => r.status === "triggered");
  const warningViolations = results.filter((r) => r.status === "warning");

  const sorted = [...activeViolations].sort((a, b) => {
    const statusDiff = statusOrder(b.status) - statusOrder(a.status);
    if (statusDiff !== 0) return statusDiff;
    return severityOrder(b.severity) - severityOrder(a.severity);
  });

  return {
    results,
    activeViolations,
    blockedViolations,
    triggeredViolations,
    warningViolations,
    hasBlockingViolation:
      blockedViolations.length > 0 || triggeredViolations.length > 0,
    primaryViolation: sorted[0] ?? null,
  };
}

// ─── Bridge helper: GuardianSnapshot → RuleEngineInput ────────────────────────

/**
 * Build a RuleEngineInput from an already-computed GuardianSnapshot.
 * This bridges the Guardian domain into the Rule Engine without coupling the two.
 */
export function buildRuleEngineInputFromGuardianSnapshot(
  snapshot: GuardianSnapshot,
  options?: {
    sessionStarted?: boolean;
    sessionEnded?: boolean;
    todaySessionStateKind?: string;
    preNewsPolicy?: {
      isActive: boolean;
      mode: string;
      message?: string | null;
    } | null;
    now?: Date;
  },
): RuleEngineInput {
  const { profile, evaluation } = snapshot;

  const maxDailyLoss = profile.maxDailyLoss
    ? Number(profile.maxDailyLoss.toString())
    : null;

  return {
    guardianEnabled: profile.guardianEnabled,
    maxTradesPerDay: profile.maxTradesPerDay ?? null,
    todayTradesCount: evaluation.todayTradesCount,
    maxDailyLoss,
    todayPnL: evaluation.todayPnL,
    stopAfterConsecutiveLosses: profile.stopAfterConsecutiveLosses ?? null,
    consecutiveLosses: evaluation.consecutiveLosses,
    sessionStarted: options?.sessionStarted ?? false,
    sessionEnded: options?.sessionEnded ?? false,
    todaySessionStateKind: options?.todaySessionStateKind ?? "READY_TO_TRADE",
    preNewsPolicy: options?.preNewsPolicy ?? null,
    now: options?.now ?? new Date(),
  };
}
