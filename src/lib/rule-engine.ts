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
  | "guardian_disabled"
  | "manual_rule_breach";

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
  /** Short product-facing message */
  message: string;
  severity: RuleSeverity;
  timestamp: Date;
  /** Optional next step surfaced to the trader */
  recommendedAction?: string;
};

// ─── Manual event signals ──────────────────────────────────────────────────────

/**
 * Derived signals from manually logged trade/session events.
 * Produced by deriveManualEventSignals() in manual-trade-events.ts.
 * Optional augmentation — rules degrade gracefully when absent.
 */
export type ManualEventSignals = {
  /** Number of trade_opened + trade_closed events logged */
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** Current consecutive loss streak from the manual event sequence */
  consecutiveLosses: number;
  /** Net PnL from manual win/loss/pnl_update events; null when no PnL values were provided */
  netPnL: number | null;
  /** True if a rule_breach event was logged */
  hasRuleBreach: boolean;
  /** True if any trade_opened or trade_closed event was logged */
  tradeActivityLogged: boolean;
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
  /**
   * Optional signals derived from manually logged trade events.
   * When provided, the engine can use them to augment Guardian-sourced values.
   * Rules that consume manual signals degrade gracefully when this is null.
   */
  manualSignals?: ManualEventSignals | null;
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
      message: "Guardian is off — risk rules are not enforcing this session.",
      severity: "medium",
      timestamp: now,
      recommendedAction: "Enable Guardian before trading.",
    });
  } else {
    results.push({
      ruleId: "guardian_disabled",
      ruleType: "guardian_disabled",
      status: "ok",
      reason: "Guardian is active.",
      message: "Guardian is active.",
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
        message: `Daily trade limit reached (${input.maxTradesPerDay}). No more entries today.`,
        severity: "high",
        timestamp: now,
        recommendedAction: "Stop. Do not enter any more trades today.",
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
        message: `One trade left before the daily limit (${input.maxTradesPerDay}).`,
        severity: "medium",
        timestamp: now,
        recommendedAction: "Choose the next entry carefully.",
      });
    } else {
      results.push({
        ruleId: "max_trades_per_day",
        ruleType: "max_trades_per_day",
        status: "ok",
        reason: `Trade count ${input.todayTradesCount} is within limit of ${input.maxTradesPerDay}.`,
        message: `${input.todayTradesCount} of ${input.maxTradesPerDay} trades taken today.`,
        severity: "low",
        timestamp: now,
      });
    }
  }

  // ── max_daily_loss ──────────────────────────────────────────────────────────
  if (input.maxDailyLoss !== null && input.maxDailyLoss !== undefined) {
    // If manual PnL data is available, take the more negative of the two values.
    // Guardian PnL is the authoritative enforcement source; manual signals augment it.
    const effectivePnL =
      input.manualSignals?.netPnL !== null && input.manualSignals?.netPnL !== undefined
        ? Math.min(input.todayPnL, input.manualSignals.netPnL)
        : input.todayPnL;

    if (effectivePnL <= -input.maxDailyLoss) {
      results.push({
        ruleId: "max_daily_loss",
        ruleType: "max_daily_loss",
        status: "triggered",
        reason: `Daily PnL ${effectivePnL} breached max daily loss limit of -${input.maxDailyLoss}.`,
        message: `Daily loss limit hit (${input.maxDailyLoss}). Trading is stopped.`,
        severity: "critical",
        timestamp: now,
        recommendedAction: "Stop completely. Wait for the reset window before resuming.",
      });
    } else {
      const warningThreshold = input.maxDailyLoss * 0.8;
      const approachingLimit =
        effectivePnL < 0 && Math.abs(effectivePnL) >= warningThreshold;

      results.push({
        ruleId: "max_daily_loss",
        ruleType: "max_daily_loss",
        status: approachingLimit ? "warning" : "ok",
        reason: approachingLimit
          ? `Daily PnL ${effectivePnL} is approaching max daily loss of -${input.maxDailyLoss}.`
          : `Daily PnL ${effectivePnL} is within max daily loss limit of -${input.maxDailyLoss}.`,
        message: approachingLimit
          ? `Approaching the daily loss limit. P&L: ${effectivePnL}, limit: -${input.maxDailyLoss}.`
          : `Today's P&L: ${effectivePnL}. Limit is -${input.maxDailyLoss}.`,
        severity: approachingLimit ? "high" : "low",
        timestamp: now,
        recommendedAction: approachingLimit
          ? "Reduce size and consider stopping early."
          : undefined,
      });
    }
  }

  // ── stop_after_consecutive_losses ───────────────────────────────────────────
  if (
    input.stopAfterConsecutiveLosses !== null &&
    input.stopAfterConsecutiveLosses !== undefined
  ) {
    // Use the higher streak between Guardian status and manual event signals.
    // Manual events may reflect a current streak not yet updated in Guardian status.
    const effectiveConsecutiveLosses = Math.max(
      input.consecutiveLosses,
      input.manualSignals?.consecutiveLosses ?? 0,
    );

    if (effectiveConsecutiveLosses >= input.stopAfterConsecutiveLosses) {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "triggered",
        reason: `Consecutive losses ${effectiveConsecutiveLosses} reached limit of ${input.stopAfterConsecutiveLosses}.`,
        message: `${effectiveConsecutiveLosses} consecutive losses — limit is ${input.stopAfterConsecutiveLosses}. Stop now.`,
        severity: "high",
        timestamp: now,
        recommendedAction: "Stop. Take a break before entering another trade.",
      });
    } else if (effectiveConsecutiveLosses > 0) {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "warning",
        reason: `${effectiveConsecutiveLosses} consecutive losses, limit is ${input.stopAfterConsecutiveLosses}.`,
        message: `${effectiveConsecutiveLosses} consecutive losses. Limit is ${input.stopAfterConsecutiveLosses}.`,
        severity: "medium",
        timestamp: now,
        recommendedAction: "Stay disciplined. One more loss will stop you.",
      });
    } else {
      results.push({
        ruleId: "stop_after_consecutive_losses",
        ruleType: "stop_after_consecutive_losses",
        status: "ok",
        reason: "No consecutive losses.",
        message: "No consecutive losses.",
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
          "Major economic event active — trading is blocked until the window closes.",
        severity: "high",
        timestamp: now,
        recommendedAction: "Wait for the event window to close before trading.",
      });
    } else if (mode === "SOFT_CAUTION") {
      results.push({
        ruleId: "no_trade_before_major_news",
        ruleType: "no_trade_before_major_news",
        status: "warning",
        reason: "Major economic event approaching. Caution mode active.",
        message:
          input.preNewsPolicy.message ??
          "Major economic event approaching — proceed with caution.",
        severity: "medium",
        timestamp: now,
        recommendedAction: "Keep position size small and have a clear plan.",
      });
    } else {
      // WARNING_ONLY
      results.push({
        ruleId: "no_trade_before_major_news",
        ruleType: "no_trade_before_major_news",
        status: "warning",
        reason: "Economic event nearby. Warning mode active.",
        message:
          input.preNewsPolicy.message ?? "Economic event nearby — stay alert.",
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
      message: "No active economic event.",
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
      message: "The daily session has not been started.",
      severity: "low",
      timestamp: now,
      recommendedAction: "Start the session before trading.",
    });
  } else {
    results.push({
      ruleId: "session_not_started",
      ruleType: "session_not_started",
      status: "ok",
      reason: "Session has been started or the day is closed.",
      message: "Session is open.",
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
      message: "The daily session has ended.",
      severity: "medium",
      timestamp: now,
      recommendedAction: "Wait for tomorrow's session.",
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
      message: "Guardian has locked the session.",
      severity: "high",
      timestamp: now,
      recommendedAction: "Wait for the reset window.",
    });
  } else {
    results.push({
      ruleId: "session_closed",
      ruleType: "session_closed",
      status: "ok",
      reason: "Session is not closed.",
      message: "Session is active.",
      severity: "low",
      timestamp: now,
    });
  }

  // ── manual_rule_breach ──────────────────────────────────────────────────────
  // Only evaluated when manual signals are present. Skipped entirely when
  // no manual event data is available so callers without signals see no noise.
  if (input.manualSignals !== null && input.manualSignals !== undefined) {
    if (input.manualSignals.hasRuleBreach) {
      results.push({
        ruleId: "manual_rule_breach",
        ruleType: "manual_rule_breach",
        status: "triggered",
        reason: "A rule breach was manually logged during this session.",
        message: "A rule breach was manually logged — review the session.",
        severity: "high",
        timestamp: now,
        recommendedAction: "Pause and check if any risk limits were exceeded.",
      });
    } else {
      results.push({
        ruleId: "manual_rule_breach",
        ruleType: "manual_rule_breach",
        status: "ok",
        reason: "No manual rule breach logged.",
        message: "No rule breach logged.",
        severity: "low",
        timestamp: now,
      });
    }
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
    manualSignals?: ManualEventSignals | null;
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
    manualSignals: options?.manualSignals ?? null,
    now: options?.now ?? new Date(),
  };
}
