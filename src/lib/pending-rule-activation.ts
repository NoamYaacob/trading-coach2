/**
 * Pure helpers for surfacing exactly when pending rule changes will activate.
 *
 * Why this exists:
 *   The Rules page used to render the next trading day as a bare YYYY-MM-DD
 *   key — e.g. "they apply on 2026-05-07". A futures trader cannot read that
 *   directly; CME sessions roll at 17:00 CT, not at midnight, so the
 *   "calendar date" is ambiguous. This module formats the activation moment
 *   as the explicit CME wall-clock time, with the user's local time alongside
 *   when their timezone is known.
 *
 * No I/O. No framework imports. Pure formatting + timezone math.
 */

import { fromTzParts, SESSION_WINDOW_TIMEZONE } from "./trading-day.ts";

/** Default CME Globex session start when the user has not configured custom
 *  hours. 17:00 America/Chicago is when the next futures session opens. */
export const DEFAULT_CME_SESSION_START_HOUR = 17;

/** Friendly local labels for known IANA timezones. Falls back to "local time"
 *  for unknown zones — better than echoing back the IANA string. */
const TZ_LOCAL_LABEL: Record<string, string> = {
  "Asia/Jerusalem": "Israel time",
  "America/New_York": "New York time",
  "America/Chicago": "CT",
  "America/Los_Angeles": "Pacific time",
  "Europe/London": "London time",
  "Europe/Berlin": "Berlin time",
  "Asia/Bangkok": "Bangkok time",
  "Asia/Tokyo": "Tokyo time",
  "Australia/Sydney": "Sydney time",
};

function localTzLabel(tz: string): string {
  return TZ_LOCAL_LABEL[tz] ?? "local time";
}

/**
 * Returns the UTC instant when the next trading session opens for a given
 * trading-day key. Trading days are anchored to America/Chicago (CME), so the
 * dateKey ("YYYY-MM-DD") is a date in that zone and `sessionStartHour` is the
 * hour of day in that zone. DST is handled correctly via fromTzParts.
 */
export function getNextTradingDayStartInstant(input: {
  /** YYYY-MM-DD key in America/Chicago. Comes from ProtectionLockState.nextTradingDayKey
   *  or AccountRiskRules.pendingEffectiveDate. */
  dateKey: string;
  /** Hour 0–23 in CME time. null/undefined → DEFAULT_CME_SESSION_START_HOUR (17). */
  sessionStartHour: number | null | undefined;
}): Date {
  const [y, m, d] = input.dateKey.split("-").map(Number);
  if (!y || !m || !d) {
    throw new Error(
      `getNextTradingDayStartInstant: invalid dateKey "${input.dateKey}", expected YYYY-MM-DD`,
    );
  }
  const hour =
    input.sessionStartHour != null && Number.isFinite(input.sessionStartHour)
      ? Math.max(0, Math.min(23, Math.floor(input.sessionStartHour)))
      : DEFAULT_CME_SESSION_START_HOUR;
  return fromTzParts(y, m, d, hour, 0, SESSION_WINDOW_TIMEZONE);
}

/**
 * Format a UTC Date as wall-clock time in `tz` using en-US conventions —
 * always producing the same shape regardless of host locale: "May 7, 2026,
 * 5:00 PM". The trailing tz suffix (e.g. " CT") is appended by the caller.
 */
function formatWallClock(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

/**
 * Format the activation moment for pending rule changes.
 *
 * Returns a string like:
 *   "May 7, 2026, 5:00 PM CT"
 *   "May 7, 2026, 5:00 PM CT / May 8, 2026, 1:00 AM Israel time"
 *
 * Always anchors to America/Chicago for the CME side. When `userTimezone` is
 * provided and is not America/Chicago, appends the user's local equivalent.
 */
export function formatPendingRuleActivation(input: {
  /** YYYY-MM-DD trading-day key in CME tz. */
  nextTradingDayKey: string;
  /** Hour 0–23 in CME tz. null → 17 (default CME session start). */
  sessionStartHour: number | null | undefined;
  /** IANA timezone of the user, e.g. "Asia/Jerusalem". When null/undefined or
   *  equal to America/Chicago, only the CT side is rendered. */
  userTimezone?: string | null;
}): string {
  const instant = getNextTradingDayStartInstant({
    dateKey: input.nextTradingDayKey,
    sessionStartHour: input.sessionStartHour,
  });
  return `${formatWallClock(instant, SESSION_WINDOW_TIMEZONE)} CT`;
}
