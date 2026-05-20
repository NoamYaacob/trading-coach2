/**
 * Account-protection cutoff and lock logic.
 *
 * Pure functions. Given a user's session config (timezone + session hours +
 * cutoff minutes) and "now", computes:
 *
 *  - which trading day is currently being configured / is locked
 *  - the cutoff datetime past which today's protection cannot be reduced
 *  - whether the user is currently locked out of reducing protection / editing
 *    rules for the active trading day
 *
 * Why a separate module: the trading-day window defines P&L bucketing, but
 * protection has its own semantics — it spans the whole cutoff-to-session-end
 * window, and the "next trading day" must be exposed so we can label
 * "applies next trading day" messages.
 */

import {
  SESSION_WINDOW_TIMEZONE,
  getTradingDayWindow,
  type TradingDayWindow,
} from "./trading-day.ts";

export const DEFAULT_CUTOFF_MINUTES = 5;

export type ProtectionStatus =
  | "protected"
  | "monitor_only"
  | "ignored"
  | "archived"
  | "pending_decision";

export type RuleSource =
  | "default_trading_plan"
  | "account_specific"
  | "monitor_only"
  | "none";

export type ProtectionLockInput = {
  /**
   * @deprecated Session windows are anchored to America/Chicago (CME).
   * This field is no longer used in lock computation.
   */
  timezone?: string | null;
  sessionStartHour?: number | null;
  sessionEndHour?: number | null;
  cutoffMinutes?: number | null;
  now?: Date;
};

export type ProtectionLockState = {
  /** Effective IANA timezone used for the calculation. */
  timezone: string;
  /** True when the user has session hours configured. Without them we cannot
   *  derive a meaningful cutoff and the lock feature is treated as disabled. */
  hasSessionHours: boolean;
  /** Trading-day key (YYYY-MM-DD in user tz) that today's protection covers. */
  tradingDayKey: string;
  /** Trading-day key for the next session — used in "applies next trading day". */
  nextTradingDayKey: string;
  /** UTC datetime past which today's protection is locked. null when no
   *  session hours are configured. */
  cutoffTime: Date | null;
  /** True when `now` is between the cutoff and the end of today's session. */
  isLocked: boolean;
  /** When locked: "active_session" when the session has started (now >= lockedFrom),
   *  "pre_session" when we're in the cutoff buffer before the session opens.
   *  null when not locked. */
  lockReason: "active_session" | "pre_session" | null;
  /** When locked, the UTC datetime of the trading session start (the moment
   *  the protected session opened). null when not locked or no session hours. */
  lockedFrom: Date | null;
  /** When locked, the UTC datetime at which the lock lifts (session end).
   *  null when not locked or when session hours are not configured. */
  lockedUntil: Date | null;
  /** When unlocked, the moment the next lock begins. When locked, null. */
  nextCutoffTime: Date | null;
};

// ─── Trading-day key (YYYY-MM-DD in user's timezone) ──────────────────────

/**
 * Returns the YYYY-MM-DD calendar date of `instant` in `tz`.
 */
export function dateKeyInTimezone(instant: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA emits ISO-like "YYYY-MM-DD"; fall back if not.
  const parts = fmt.formatToParts(instant);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function addDaysToKey(key: string, days: number): string {
  // key is YYYY-MM-DD; build a noon-UTC Date so DST nudges don't slip the day.
  const [y, m, d] = key.split("-").map(Number);
  const base = new Date(Date.UTC(y!, (m! - 1), d!, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

// ─── Lock-state computation ───────────────────────────────────────────────

/**
 * Compute the protection-lock state for a user, given session hours +
 * cutoff config.
 *
 * Session hours are canonical in America/Chicago (CME) time. The lock window
 * and trading-day keys are always computed in CME time so protection decisions
 * stay aligned with the futures market regardless of the user's local timezone
 * or US/Israel DST divergence.
 *
 * Without session hours we treat protection as never locked (the user has
 * not configured a trading session and we have no anchor). The UI surfaces
 * a hint to set session hours so this feature can engage.
 */
export function getProtectionLockState(input: ProtectionLockInput): ProtectionLockState {
  const now = input.now ?? new Date();
  // Session hours are stored as CME (America/Chicago) hours. Always compute
  // the lock window in CME time — never in the user's local timezone.
  const timezone = SESSION_WINDOW_TIMEZONE;
  const cutoffMinutes =
    input.cutoffMinutes != null && Number.isFinite(input.cutoffMinutes) && input.cutoffMinutes >= 0
      ? Math.floor(input.cutoffMinutes)
      : DEFAULT_CUTOFF_MINUTES;

  const window: TradingDayWindow = getTradingDayWindow({
    timezone,
    sessionStartHour: input.sessionStartHour,
    sessionEndHour: input.sessionEndHour,
    now,
  });

  if (!window.hasSessionHours) {
    // No session anchor → no cutoff. Protection changes always allowed.
    const todayKey = dateKeyInTimezone(now, timezone);
    return {
      timezone,
      hasSessionHours: false,
      tradingDayKey: todayKey,
      nextTradingDayKey: addDaysToKey(todayKey, 1),
      cutoffTime: null,
      isLocked: false,
      lockReason: null,
      lockedFrom: null,
      lockedUntil: null,
      nextCutoffTime: null,
    };
  }

  // `getTradingDayWindow` returns the most recent session — which may be
  // already closed when "now" falls between sessions. For protection purposes
  // we want the *upcoming or active* session: if today's window has ended,
  // advance by one day to anchor on the next session.
  const dayMs = 24 * 60 * 60_000;
  let sessionStart = window.start;
  let sessionEnd = window.end;
  if (now >= sessionEnd) {
    sessionStart = new Date(sessionStart.getTime() + dayMs);
    sessionEnd = new Date(sessionEnd.getTime() + dayMs);
  }
  const cutoffTime = new Date(sessionStart.getTime() - cutoffMinutes * 60_000);

  // Locked only when we're past the upcoming/active session's cutoff AND
  // before that session ends.
  if (now >= cutoffTime && now < sessionEnd) {
    const tradingDayKey = dateKeyInTimezone(sessionStart, timezone);
    return {
      timezone,
      hasSessionHours: true,
      tradingDayKey,
      nextTradingDayKey: addDaysToKey(tradingDayKey, 1),
      cutoffTime,
      isLocked: true,
      lockReason: now >= sessionStart ? "active_session" : "pre_session",
      lockedFrom: sessionStart,
      lockedUntil: sessionEnd,
      nextCutoffTime: null,
    };
  }

  // Unlocked: the user is configuring the upcoming session.
  const tradingDayKey = dateKeyInTimezone(sessionStart, timezone);
  return {
    timezone,
    hasSessionHours: true,
    tradingDayKey,
    nextTradingDayKey: addDaysToKey(tradingDayKey, 1),
    cutoffTime,
    isLocked: false,
    lockReason: null,
    lockedFrom: null,
    lockedUntil: null,
    nextCutoffTime: cutoffTime,
  };
}

// ─── Allowed-change matrix ────────────────────────────────────────────────

/**
 * Increasing protection (or moving from an unsafe state to a safer one) is
 * always allowed, even after the cutoff. Reducing protection is blocked while
 * locked — the change is saved as "applies next trading day" instead.
 *
 *   protected         > monitor_only > ignored > archived
 *   pending_decision  is unranked: it can transition to anything else.
 *
 * Returns true when `to` is at least as protective as `from`.
 */
const PROTECTION_RANK: Record<ProtectionStatus, number> = {
  protected: 4,
  monitor_only: 3,
  pending_decision: 2,
  ignored: 1,
  archived: 0,
};

export function isProtectionIncrease(
  from: ProtectionStatus,
  to: ProtectionStatus,
): boolean {
  // pending_decision → anything is treated as "configuring for the first time"
  // and is allowed even after cutoff (we lift the lock for first-time setup).
  if (from === "pending_decision") return true;
  return PROTECTION_RANK[to] >= PROTECTION_RANK[from];
}

/** Whether a protection change is permitted now, given the lock state. */
export function canChangeProtection(
  from: ProtectionStatus,
  to: ProtectionStatus,
  lock: ProtectionLockState,
): { allowed: boolean; appliesOnTradingDay: string } {
  if (!lock.isLocked) {
    return { allowed: true, appliesOnTradingDay: lock.tradingDayKey };
  }
  if (isProtectionIncrease(from, to)) {
    return { allowed: true, appliesOnTradingDay: lock.tradingDayKey };
  }
  // Reduction after cutoff: save as pending for next trading day.
  return { allowed: false, appliesOnTradingDay: lock.nextTradingDayKey };
}

// ─── Rule-source helper ───────────────────────────────────────────────────

export function deriveRuleSource(input: {
  protectionStatus: ProtectionStatus;
  hasAccountRules: boolean;
  hasDefaultRules: boolean;
}): RuleSource {
  if (input.protectionStatus === "monitor_only") return "monitor_only";
  if (input.protectionStatus !== "protected") return "none";
  if (input.hasAccountRules) return "account_specific";
  if (input.hasDefaultRules) return "default_trading_plan";
  return "none";
}
