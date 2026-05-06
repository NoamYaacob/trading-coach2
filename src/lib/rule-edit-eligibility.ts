/**
 * Pure helper for determining whether a user can edit their trading rules right now.
 *
 * Editing is blocked when any of these conditions hold:
 *   1. Account is stopped/locked by Guardrail
 *   2. A rule was breached today
 *   3. There is an open position
 *   4. Now falls within the pre-session lock buffer
 *   5. Now falls within the active trading session
 *
 * Unlocked windows: before the lock buffer, and after the session ends.
 */

import { getTradingDayWindow, SESSION_WINDOW_TIMEZONE } from "./trading-day.ts";

export const DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES = 60;

export type RuleEditReason =
  | "can_edit"
  | "no_session_configured"
  | "account_stopped"
  | "rule_breach_today"
  | "open_position"
  | "within_session"
  | "within_buffer";

export type RuleEditEligibility = {
  canEditNow: boolean;
  reason: RuleEditReason;
  /** UTC time when editing becomes available again. Null for non-time-based locks or when already allowed. */
  nextAllowedAt: Date | null;
  /** UTC start of the active or upcoming session. Null when no session configured. */
  sessionStartsAt: Date | null;
  /** UTC end of the active or upcoming session. Null when no session configured. */
  sessionEndsAt: Date | null;
};

export type RuleEditEligibilityInput = {
  now?: Date;
  sessionStartHour?: number | null;
  sessionEndHour?: number | null;
  sessionTimezone?: string | null;
  lockBufferMinutes?: number | null;
  hasOpenPosition?: boolean;
  hasRuleBreachToday?: boolean;
  isAccountStopped?: boolean;
};

export type SessionPreset = {
  id: "ny" | "london" | "asia";
  label: string;
  sessionStartHour: number;
  sessionEndHour: number;
  timezone: string;
};

export const SESSION_PRESETS: SessionPreset[] = [
  {
    id: "ny",
    label: "New York (NYSE/CME)",
    sessionStartHour: 9,
    sessionEndHour: 16,
    timezone: "America/New_York",
  },
  {
    id: "london",
    label: "London (LSE)",
    sessionStartHour: 8,
    sessionEndHour: 12,
    timezone: "Europe/London",
  },
  {
    id: "asia",
    label: "Asia (Tokyo)",
    sessionStartHour: 9,
    sessionEndHour: 12,
    timezone: "Asia/Tokyo",
  },
];

export function deriveRuleEditEligibility(
  input: RuleEditEligibilityInput,
): RuleEditEligibility {
  const now = input.now ?? new Date();
  const lockBufferMinutes =
    input.lockBufferMinutes != null &&
    Number.isFinite(input.lockBufferMinutes) &&
    input.lockBufferMinutes >= 0
      ? Math.floor(input.lockBufferMinutes)
      : DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES;
  const tz = input.sessionTimezone ?? SESSION_WINDOW_TIMEZONE;

  if (input.isAccountStopped) {
    return {
      canEditNow: false,
      reason: "account_stopped",
      nextAllowedAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  if (input.hasRuleBreachToday) {
    return {
      canEditNow: false,
      reason: "rule_breach_today",
      nextAllowedAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  if (input.hasOpenPosition) {
    return {
      canEditNow: false,
      reason: "open_position",
      nextAllowedAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  const window = getTradingDayWindow({
    timezone: tz,
    sessionStartHour: input.sessionStartHour,
    sessionEndHour: input.sessionEndHour,
    now,
  });

  if (!window.hasSessionHours) {
    return {
      canEditNow: true,
      reason: "no_session_configured",
      nextAllowedAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  const dayMs = 24 * 60 * 60_000;
  let sessionStart = window.start;
  let sessionEnd = window.end;
  // When the current window has already ended, advance to the upcoming session.
  if (now >= sessionEnd) {
    sessionStart = new Date(sessionStart.getTime() + dayMs);
    sessionEnd = new Date(sessionEnd.getTime() + dayMs);
  }

  const cutoffTime = new Date(sessionStart.getTime() - lockBufferMinutes * 60_000);

  if (now >= cutoffTime && now < sessionEnd) {
    const isWithinSession = now >= sessionStart;
    return {
      canEditNow: false,
      reason: isWithinSession ? "within_session" : "within_buffer",
      nextAllowedAt: sessionEnd,
      sessionStartsAt: sessionStart,
      sessionEndsAt: sessionEnd,
    };
  }

  return {
    canEditNow: true,
    reason: "can_edit",
    nextAllowedAt: null,
    sessionStartsAt: sessionStart,
    sessionEndsAt: sessionEnd,
  };
}

/**
 * Formats a UTC Date as a short local time string in the given IANA timezone.
 * e.g. "4:00 PM ET" or "12:00 PM Europe/London"
 */
export function formatLocalTime(utcDate: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(utcDate);
}

/**
 * Returns a human-readable lock message for the given eligibility state.
 * Pass `sessionTimezone` to format the "Next edit window" time in the session tz.
 */
export function buildRuleEditLockMessage(
  eligibility: RuleEditEligibility,
  sessionTimezone?: string | null,
): string {
  const tz = sessionTimezone ?? SESSION_WINDOW_TIMEZONE;

  switch (eligibility.reason) {
    case "account_stopped":
      return "Account is stopped by Guardrail. Rules cannot be changed until the account is manually reset.";

    case "rule_breach_today":
      return "A rule was breached today. Rules are locked until the next session.";

    case "open_position":
      return "You have an open position. Rules will be editable once the position is closed.";

    case "within_session": {
      const until = eligibility.nextAllowedAt
        ? ` Next edit window: ${formatLocalTime(eligibility.nextAllowedAt, tz)}.`
        : "";
      return `Session is active. Rules are locked until the session ends.${until}`;
    }

    case "within_buffer": {
      const until = eligibility.nextAllowedAt
        ? ` Next edit window: ${formatLocalTime(eligibility.nextAllowedAt, tz)}.`
        : "";
      return `Session starts soon. Rules are locked until the session ends.${until}`;
    }

    default:
      return "Today's rules are locked. Changes will apply on the next trading day.";
  }
}
