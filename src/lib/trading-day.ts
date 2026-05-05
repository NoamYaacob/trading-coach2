/**
 * Trading-day window calculator.
 *
 * Pure, side-effect-free helper that turns the user's timezone + optional
 * session hours into the half-open UTC window `[start, end)` that defines
 * the current "trading day" — used to bucket trades for P&L, max trades,
 * loss streak, and daily-loss / profit-target rules.
 *
 * Why this exists: a futures trader's "today" is not the server's calendar
 * day. Sessions span timezones, and many futures sessions are overnight
 * (e.g. 22:00 -> 05:00 next day). All surfaces that compute daily metrics
 * must use the same window so summaries match the rule engine.
 */

import { isValidTimeZone } from "./timezone.ts";

export const FALLBACK_TIMEZONE = "Asia/Jerusalem";

export type TradingDayInput = {
  /** IANA timezone, e.g. "Asia/Jerusalem", "America/New_York". */
  timezone?: string | null;
  /** Optional session start hour in the user's timezone (0-23). */
  sessionStartHour?: number | null;
  /** Optional session end hour in the user's timezone (0-23). */
  sessionEndHour?: number | null;
  /** Defaults to new Date(). */
  now?: Date;
};

export type TradingDayWindow = {
  /** UTC instant marking the start of the current trading day window (inclusive). */
  start: Date;
  /** UTC instant marking the end of the current trading day window (exclusive). */
  end: Date;
  /** Resolved IANA timezone used for the calculation. */
  timezone: string;
  /** Human-readable label like "Apr 26, 16:30 to Apr 26, 23:00 Asia/Jerusalem". */
  label: string;
  /** True when `now` falls within `[start, end)`. */
  isCurrentSessionOpen: boolean;
  /** True when the user has configured session hours. */
  hasSessionHours: boolean;
  /** True when sessionEndHour <= sessionStartHour (the window crosses midnight). */
  isOvernight: boolean;
};

export type LocalCalendarDayWindow = {
  /** UTC instant marking local midnight at the start of the day. */
  start: Date;
  /** UTC instant marking local midnight at the start of the next day. */
  end: Date;
  /** Resolved IANA timezone used for the calculation. */
  timezone: string;
  /** Human-readable label like "Apr 29, 2026". */
  label: string;
};

// ─── Timezone math helpers ────────────────────────────────────────────────

/**
 * Returns the offset of `tz` from UTC at moment `at`, in minutes east of UTC.
 * Positive = east of UTC (e.g. Asia/Jerusalem returns +120 in winter, +180 in summer).
 *
 * Uses `Intl.DateTimeFormat` so DST transitions are handled automatically.
 */
function tzOffsetMinutes(at: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Hour can come back as "24" in some locales/edge cases; normalise to 0.
  const hour = get("hour") % 24;
  const tzAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((tzAsUtcMs - at.getTime()) / 60_000);
}

/**
 * Returns the UTC Date corresponding to (year-month-day hour:minute) in `tz`.
 * Two-pass to handle DST transitions: the second pass corrects when the
 * naive offset shifts the candidate across a DST boundary.
 */
function fromTzParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // First guess: treat the parts as if they were in UTC.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offset1 = tzOffsetMinutes(guess, tz);
  const adjusted = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = tzOffsetMinutes(adjusted, tz);
  if (offset2 === offset1) return adjusted;
  return new Date(guess.getTime() - offset2 * 60_000);
}

/** Returns the year/month/day of `at` as observed in `tz`. */
function getCalendarDateInTz(at: Date, tz: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

function clampHour(h: number | null | undefined): number | null {
  if (h === null || h === undefined) return null;
  if (!Number.isFinite(h)) return null;
  const n = Math.floor(h);
  if (n < 0 || n > 23) return null;
  return n;
}

function formatLabel(start: Date, end: Date, tz: string): string {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const a = dateFmt.format(start);
  const b = dateFmt.format(end);
  return `${a} – ${b} ${tz}`;
}

function formatCalendarDayLabel(start: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(start);
}

// ─── Core API ─────────────────────────────────────────────────────────────

/**
 * Compute the current trading-day window in UTC.
 *
 * Behaviour:
 *
 * - No session hours configured -> calendar day (00:00 to 24:00) in the
 *   user's timezone.
 *
 * - sessionEndHour > sessionStartHour (same-day session, e.g. 9 -> 16):
 *   The window is the most recent session start at or before `now`,
 *   spanning `(sessionEndHour - sessionStartHour)` hours.
 *
 * - sessionEndHour <= sessionStartHour (overnight session, e.g. 22 -> 5):
 *   Treated as crossing midnight. Duration = (24 - start) + end hours.
 *   Window starts at the most recent `sessionStartHour` boundary at or
 *   before `now`.
 *
 * Edge cases:
 *
 * - now BEFORE today's session start -> window is yesterday's session
 *   (the most recently ended session is still "today's trading day").
 *
 * - now AFTER today's session end (same-day) -> window is today's just-
 *   ended session (so post-session review still shows today's trades).
 *
 * - now AFTER MIDNIGHT but BEFORE overnight session end -> the active
 *   session is yesterday's overnight, which is still open.
 */
export function getTradingDayWindow(input: TradingDayInput = {}): TradingDayWindow {
  const tz = isValidTimeZone(input.timezone) ? (input.timezone as string) : FALLBACK_TIMEZONE;
  const now = input.now ?? new Date();

  const startHour = clampHour(input.sessionStartHour);
  const endHour = clampHour(input.sessionEndHour);
  const hasSessionHours = startHour !== null && endHour !== null;

  // ── No session hours: calendar day in tz ───────────────────────────────
  if (!hasSessionHours) {
    const today = getCalendarDateInTz(now, tz);
    const start = fromTzParts(today.year, today.month, today.day, 0, 0, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    return {
      start,
      end,
      timezone: tz,
      label: formatLabel(start, end, tz),
      isCurrentSessionOpen: now.getTime() >= start.getTime() && now.getTime() < end.getTime(),
      hasSessionHours: false,
      isOvernight: false,
    };
  }

  const isOvernight = endHour <= startHour;
  const durationHours = isOvernight ? 24 - startHour + endHour : endHour - startHour;

  const today = getCalendarDateInTz(now, tz);
  const todayStart = fromTzParts(today.year, today.month, today.day, startHour, 0, tz);

  // If we're at or past today's start, this is the active window.
  // Otherwise the active window is yesterday's session.
  let windowStart: Date;
  if (now.getTime() >= todayStart.getTime()) {
    windowStart = todayStart;
  } else {
    windowStart = new Date(todayStart.getTime() - 24 * 60 * 60_000);
  }

  const windowEnd = new Date(windowStart.getTime() + durationHours * 60 * 60_000);

  return {
    start: windowStart,
    end: windowEnd,
    timezone: tz,
    label: formatLabel(windowStart, windowEnd, tz),
    isCurrentSessionOpen:
      now.getTime() >= windowStart.getTime() && now.getTime() < windowEnd.getTime(),
    hasSessionHours: true,
    isOvernight,
  };
}

// ── CME Globex trading day ─────────────────────────────────────────────────

/**
 * CME Globex daily futures sessions start at 17:00 America/Chicago (5 PM CT).
 * Returns the UTC Date of the 5PM CT boundary that opened the current session.
 *
 * Examples (CDT = UTC-5):
 *   now = 2026-05-05 18:00 CT (23:00 UTC) → session opened May 5 17:00 CT → 2026-05-05 22:00Z
 *   now = 2026-05-06 03:00 CT (08:00 UTC) → same session              → 2026-05-05 22:00Z
 *   now = 2026-05-06 18:00 CT (23:00 UTC) → next session opened        → 2026-05-06 22:00Z
 */
export function deriveCmeTradingDaySessionStart(now?: Date): Date {
  return getTradingDayWindow({
    timezone: "America/Chicago",
    sessionStartHour: 17,
    sessionEndHour: 17,
    now,
  }).start;
}

/**
 * Returns the YYYY-MM-DD trading-day key for the current CME Globex session,
 * expressed as the America/Chicago calendar date when that session opened.
 * Changes at 17:00 CT, not at UTC midnight.
 */
export function deriveCmeTradingDayKey(now?: Date): string {
  const sessionStart = deriveCmeTradingDaySessionStart(now);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(sessionStart);
}

export function getLocalCalendarDayWindow(input: {
  timezone?: string | null;
  now?: Date;
} = {}): LocalCalendarDayWindow {
  const tz = isValidTimeZone(input.timezone) ? (input.timezone as string) : FALLBACK_TIMEZONE;
  const now = input.now ?? new Date();
  const today = getCalendarDateInTz(now, tz);
  const start = fromTzParts(today.year, today.month, today.day, 0, 0, tz);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);

  return {
    start,
    end,
    timezone: tz,
    label: formatCalendarDayLabel(start, tz),
  };
}
