/**
 * Pure helper for determining whether a user can edit their trading rules right now.
 *
 * Editing is blocked when any of these conditions hold:
 *   1. Account is stopped/locked by Guardrail
 *   2. A rule was breached today
 *   3. There is an open position
 *   4. Now falls within the pre-session lock buffer of any selected session
 *   5. Now falls within an active trading session
 *
 * Unlocked windows: before the lock buffer, and after all sessions end.
 */

import { getTradingDayWindow, SESSION_WINDOW_TIMEZONE } from "./trading-day.ts";

export const DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES = 60;

export type RuleEditReason =
  | "can_edit"
  | "no_session_configured"
  | "account_stopped"
  | "rule_breach_today"
  | "protection_locked_today"
  | "open_position"
  | "within_session"
  | "within_buffer";

export type RuleEditEligibility = {
  canEditNow: boolean;
  reason: RuleEditReason;
  /** UTC time when editing becomes available again. Null for non-time-based locks or when already allowed. */
  nextAllowedAt: Date | null;
  /** UTC time when the lock begins (= session start minus buffer). Null when no session or when already allowed. */
  lockStartsAt: Date | null;
  /** UTC start of the active or upcoming session. Null when no session configured or multi-session. */
  sessionStartsAt: Date | null;
  /** UTC end of the active or upcoming session. Null when no session configured. */
  sessionEndsAt: Date | null;
};

export type RuleEditEligibilityInput = {
  now?: Date;
  /** Multi-select preset IDs. When set (even empty array), takes precedence over single-session fields. */
  selectedSessionPresets?: string[] | null;
  /** Preset identifier: "ny" | "london" | "asia" | "custom". Legacy single-select. */
  sessionPreset?: string | null;
  /** Session start time as HH:mm in sessionTimezone (minute-precise). Falls back to sessionStartHour when absent. */
  sessionStartTime?: string | null;
  /** Session end time as HH:mm in sessionTimezone (minute-precise). Falls back to sessionEndHour when absent. */
  sessionEndTime?: string | null;
  /** Legacy integer hour (0-23). Used when sessionStartTime is absent. */
  sessionStartHour?: number | null;
  /** Legacy integer hour (0-23). Used when sessionEndTime is absent. */
  sessionEndHour?: number | null;
  sessionTimezone?: string | null;
  lockBufferMinutes?: number | null;
  hasOpenPosition?: boolean;
  hasRuleBreachToday?: boolean;
  hasProtectionLockToday?: boolean;
  isAccountStopped?: boolean;
};

export type SessionPreset = {
  id: "asia" | "london" | "ny_am" | "ny_pm";
  label: string;
  /** HH:mm start time in ET (America/New_York). */
  sessionStartTime: string;
  /** HH:mm end time in ET (America/New_York). */
  sessionEndTime: string;
  timezone: string;
};

export const SESSION_PRESETS: SessionPreset[] = [
  {
    id: "asia",
    label: "Asia",
    sessionStartTime: "18:00",
    sessionEndTime: "01:00",
    timezone: "America/New_York",
  },
  {
    id: "london",
    label: "London",
    sessionStartTime: "01:00",
    sessionEndTime: "09:30",
    timezone: "America/New_York",
  },
  {
    id: "ny_am",
    label: "NY AM",
    sessionStartTime: "09:30",
    sessionEndTime: "13:00",
    timezone: "America/New_York",
  },
  {
    id: "ny_pm",
    label: "NY PM",
    sessionStartTime: "13:00",
    sessionEndTime: "17:00",
    timezone: "America/New_York",
  },
];

/** Parse "HH:mm" → {hour, minute}. Returns null if format is invalid. */
function parseHHmm(s: string | null | undefined): { hour: number; minute: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export type LockWindow = { lockStart: Date; lockEnd: Date };

function computePresetLockWindow(
  preset: SessionPreset,
  now: Date,
  bufferMinutes: number,
): LockWindow {
  const startParsed = parseHHmm(preset.sessionStartTime)!;
  const endParsed = parseHHmm(preset.sessionEndTime)!;

  const win = getTradingDayWindow({
    timezone: preset.timezone,
    sessionStartHour: startParsed.hour,
    sessionEndHour: endParsed.hour,
    sessionStartMinute: startParsed.minute,
    sessionEndMinute: endParsed.minute,
    now,
  });

  let sessionStart = win.start;
  let sessionEnd = win.end;
  if (now >= sessionEnd) {
    const dayMs = 24 * 60 * 60_000;
    sessionStart = new Date(sessionStart.getTime() + dayMs);
    sessionEnd = new Date(sessionEnd.getTime() + dayMs);
  }

  return {
    lockStart: new Date(sessionStart.getTime() - bufferMinutes * 60_000),
    lockEnd: sessionEnd,
  };
}

export function mergeLockWindows(windows: LockWindow[]): LockWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.lockStart.getTime() - b.lockStart.getTime());
  const merged: LockWindow[] = [{ lockStart: sorted[0].lockStart, lockEnd: sorted[0].lockEnd }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.lockStart.getTime() <= last.lockEnd.getTime()) {
      if (curr.lockEnd.getTime() > last.lockEnd.getTime()) {
        last.lockEnd = curr.lockEnd;
      }
    } else {
      merged.push({ lockStart: curr.lockStart, lockEnd: curr.lockEnd });
    }
  }
  return merged;
}

/**
 * Returns true when the UTC trade timestamp falls within any of the selected
 * session's active windows (not the lock buffer, just the session itself).
 */
export function isTradeInsideSelectedSessions({
  tradeTime,
  selectedSessions,
}: {
  tradeTime: Date;
  selectedSessions: string[];
}): boolean {
  if (selectedSessions.length === 0) return false;
  return selectedSessions.some((id) => {
    const preset = SESSION_PRESETS.find((p) => p.id === id);
    if (!preset) return false;
    const startParsed = parseHHmm(preset.sessionStartTime);
    const endParsed = parseHHmm(preset.sessionEndTime);
    if (!startParsed || !endParsed) return false;
    return getTradingDayWindow({
      timezone: preset.timezone,
      sessionStartHour: startParsed.hour,
      sessionEndHour: endParsed.hour,
      sessionStartMinute: startParsed.minute,
      sessionEndMinute: endParsed.minute,
      now: tradeTime,
    }).isCurrentSessionOpen;
  });
}

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

  if (input.isAccountStopped) {
    return {
      canEditNow: false,
      reason: "account_stopped",
      nextAllowedAt: null,
      lockStartsAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  if (input.hasRuleBreachToday) {
    return {
      canEditNow: false,
      reason: "rule_breach_today",
      nextAllowedAt: null,
      lockStartsAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  if (input.hasProtectionLockToday) {
    return {
      canEditNow: false,
      reason: "protection_locked_today",
      nextAllowedAt: null,
      lockStartsAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  if (input.hasOpenPosition) {
    return {
      canEditNow: false,
      reason: "open_position",
      nextAllowedAt: null,
      lockStartsAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  // ── Multi-session path (selectedSessionPresets takes precedence) ───────────
  if (input.selectedSessionPresets != null) {
    if (input.selectedSessionPresets.length === 0) {
      return {
        canEditNow: true,
        reason: "no_session_configured",
        nextAllowedAt: null,
        lockStartsAt: null,
        sessionStartsAt: null,
        sessionEndsAt: null,
      };
    }

    const validPresets = input.selectedSessionPresets
      .map((id) => SESSION_PRESETS.find((p) => p.id === id))
      .filter((p): p is SessionPreset => p != null);

    if (validPresets.length === 0) {
      return {
        canEditNow: true,
        reason: "no_session_configured",
        nextAllowedAt: null,
        lockStartsAt: null,
        sessionStartsAt: null,
        sessionEndsAt: null,
      };
    }

    const rawWindows = validPresets.map((p) => computePresetLockWindow(p, now, lockBufferMinutes));
    const merged = mergeLockWindows(rawWindows);

    const activeLock = merged.find((w) => now >= w.lockStart && now < w.lockEnd) ?? null;

    if (activeLock) {
      const isWithinSession = validPresets.some((preset) => {
        const startParsed = parseHHmm(preset.sessionStartTime)!;
        const endParsed = parseHHmm(preset.sessionEndTime)!;
        const win = getTradingDayWindow({
          timezone: preset.timezone,
          sessionStartHour: startParsed.hour,
          sessionEndHour: endParsed.hour,
          sessionStartMinute: startParsed.minute,
          sessionEndMinute: endParsed.minute,
          now,
        });
        let sStart = win.start;
        let sEnd = win.end;
        if (now >= sEnd) {
          const dayMs = 24 * 60 * 60_000;
          sStart = new Date(sStart.getTime() + dayMs);
          sEnd = new Date(sEnd.getTime() + dayMs);
        }
        return now >= sStart && now < sEnd;
      });

      return {
        canEditNow: false,
        reason: isWithinSession ? "within_session" : "within_buffer",
        nextAllowedAt: activeLock.lockEnd,
        lockStartsAt: activeLock.lockStart,
        sessionStartsAt: null,
        sessionEndsAt: activeLock.lockEnd,
      };
    }

    const upcoming = merged
      .filter((w) => w.lockStart > now)
      .sort((a, b) => a.lockStart.getTime() - b.lockStart.getTime())[0] ?? null;

    return {
      canEditNow: true,
      reason: "can_edit",
      nextAllowedAt: null,
      lockStartsAt: upcoming?.lockStart ?? null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  // ── Single-session path (legacy / custom) ─────────────────────────────────
  const tz = input.sessionTimezone ?? SESSION_WINDOW_TIMEZONE;

  const startParsed = parseHHmm(input.sessionStartTime);
  const endParsed = parseHHmm(input.sessionEndTime);

  const startHour = startParsed?.hour ?? (input.sessionStartHour != null && Number.isFinite(input.sessionStartHour) ? Math.floor(input.sessionStartHour) : null);
  const startMinute = startParsed?.minute ?? 0;
  const endHour = endParsed?.hour ?? (input.sessionEndHour != null && Number.isFinite(input.sessionEndHour) ? Math.floor(input.sessionEndHour) : null);
  const endMinute = endParsed?.minute ?? 0;

  const window = getTradingDayWindow({
    timezone: tz,
    sessionStartHour: startHour,
    sessionEndHour: endHour,
    sessionStartMinute: startMinute,
    sessionEndMinute: endMinute,
    now,
  });

  if (!window.hasSessionHours) {
    return {
      canEditNow: true,
      reason: "no_session_configured",
      nextAllowedAt: null,
      lockStartsAt: null,
      sessionStartsAt: null,
      sessionEndsAt: null,
    };
  }

  const dayMs = 24 * 60 * 60_000;
  let sessionStart = window.start;
  let sessionEnd = window.end;
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
      lockStartsAt: cutoffTime,
      sessionStartsAt: sessionStart,
      sessionEndsAt: sessionEnd,
    };
  }

  return {
    canEditNow: true,
    reason: "can_edit",
    nextAllowedAt: null,
    lockStartsAt: cutoffTime,
    sessionStartsAt: sessionStart,
    sessionEndsAt: sessionEnd,
  };
}

const TZ_CITY_LABEL: Record<string, string> = {
  "Asia/Jerusalem": "Israel time",
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Los_Angeles": "PT",
  "America/Denver": "MT",
  "Europe/London": "London time",
  "Europe/Berlin": "Berlin time",
  "Europe/Paris": "Paris time",
  "Asia/Tokyo": "Tokyo time",
  "Asia/Bangkok": "Bangkok time",
  "Australia/Sydney": "Sydney time",
  "Asia/Dubai": "Dubai time",
};

/**
 * Formats a UTC Date as a short local time string in the given IANA timezone.
 * e.g. "4:00 PM ET" or "12:00 PM London time"
 */
export function formatLocalTime(utcDate: Date, tz: string): string {
  const city = TZ_CITY_LABEL[tz];
  if (city) {
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(utcDate);
    return `${time} ${city}`;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(utcDate);
}

/**
 * Returns a human-readable lock message for the given eligibility state.
 *
 * - sessionTimezone: the timezone the session is defined in (used for "next edit window" time)
 * - userTimezone: the user's local timezone (shown as a second clock when different from session tz)
 */
export function buildRuleEditLockMessage(
  eligibility: RuleEditEligibility,
  sessionTimezone?: string | null,
  userTimezone?: string | null,
): string {
  const sessionTz = sessionTimezone ?? SESSION_WINDOW_TIMEZONE;

  function formatNextWindow(nextAt: Date): string {
    const sessionFormatted = formatLocalTime(nextAt, sessionTz);
    if (userTimezone && userTimezone !== sessionTz) {
      const userFormatted = formatLocalTime(nextAt, userTimezone);
      return `${sessionFormatted} / ${userFormatted}`;
    }
    return sessionFormatted;
  }

  switch (eligibility.reason) {
    case "account_stopped":
      return "Account is stopped by Guardrail. Rules cannot be changed until the account is manually reset.";

    case "rule_breach_today":
      return "You already hit a protection rule today, so changes cannot affect today. These changes will apply from the next trading day.";

    case "protection_locked_today":
      return "You already hit a protection rule today, so changes cannot affect today. These changes will apply from the next trading day.";

    case "open_position":
      return "You have an open position. Rules will be editable once the position is closed.";

    case "within_session": {
      const until = eligibility.nextAllowedAt
        ? ` Next edit window: ${formatNextWindow(eligibility.nextAllowedAt)}.`
        : "";
      return `Rule changes are locked during your active trading session.${until}`;
    }

    case "within_buffer": {
      const until = eligibility.nextAllowedAt
        ? ` Next edit window: ${formatNextWindow(eligibility.nextAllowedAt)}.`
        : "";
      return `Rule changes are locked during your active trading session.${until}`;
    }

    default:
      return "Rule changes are locked during your active trading session.";
  }
}
