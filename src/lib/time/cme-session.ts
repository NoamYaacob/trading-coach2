/**
 * Centralized CME Globex session boundary helpers.
 *
 * CME Equity-Index Futures (ES, NQ, YM, RTY) schedule:
 *   Session open:    17:00 CT (Sun through Thu)
 *   Active trading:  17:00 CT → 16:00 CT next calendar day
 *   Maintenance:     16:00–17:00 CT (Mon–Thu daily; Fri 16:00 closes for the weekend)
 *   Weekend:         closed (Fri 16:00 CT → Sun 17:00 CT)
 *
 * Session key: YYYY-MM-DD CT calendar date when the session opened at 17:00 CT.
 *
 * All CME session math must go through this module — do not scatter ad-hoc UTC
 * midnight bounds or hand-rolled CT offsets across the codebase.
 */

import {
  deriveCmeTradingDayKey,
  deriveCmeTradingDaySessionStart,
  fromTzParts,
} from "../trading-day.ts";
import { getMarketStatus } from "../market-hours.ts";
import { formatDateMMDDYYYY, nextCalendarDay } from "../brokers/tradovate-report-date.ts";

const CME_TZ = "America/Chicago";

// Re-export under stable, intent-clear names so callers can import from one place.
export { deriveCmeTradingDayKey as getCurrentCmeTradingDayKey };
export { deriveCmeTradingDaySessionStart as getCmeSessionStart };

export type CmeSessionInfo = {
  /** YYYY-MM-DD CT calendar date when the session opened at 17:00 CT. */
  tradingDayKey: string;
  /** UTC instant of session open (17:00 CT on the tradingDayKey date). */
  sessionStart: Date;
  /** UTC instant of active-trading end (16:00 CT on the following calendar day). */
  activeTradingEnd: Date;
  /** True when `now` is in the active-trading window [sessionStart, activeTradingEnd). */
  isActiveTradingOpen: boolean;
  /**
   * True when `now` is in the daily maintenance break [activeTradingEnd, activeTradingEnd+1h).
   * False during the weekend (Fri 16:00–Sun 17:00 CT), which is a market close, not maintenance.
   */
  isMaintenanceWindow: boolean;
};

export type TradovateReportWindow = {
  /** MM/DD/YYYY — session key date. */
  startDate: string;
  /** "17:00:00" — CME session open. */
  startTime: string;
  /** MM/DD/YYYY — following calendar day. */
  endDate: string;
  /** "16:59:59" — just before the next session open. */
  endTime: string;
};

/**
 * Returns the UTC Date of the 17:00 CT open for a YYYY-MM-DD trading day key.
 * Use this when you have a stored session key and need the actual start timestamp.
 */
export function getCmeSessionStartForKey(tradingDayKey: string): Date {
  const [y, m, d] = tradingDayKey.split("-").map(Number);
  return fromTzParts(y, m, d, 17, 0, CME_TZ);
}

/**
 * Returns the UTC Date of active-trading end (16:00 CT) for a YYYY-MM-DD trading day key.
 * This is the next calendar day at 16:00 CT, after which the maintenance break begins.
 */
export function getCmeActiveTradingEnd(tradingDayKey: string): Date {
  const next = nextCalendarDay(tradingDayKey);
  const [y, m, d] = next.split("-").map(Number);
  return fromTzParts(y, m, d, 16, 0, CME_TZ);
}

/**
 * True when `now` is in the daily 1-hour maintenance break (16:00–17:00 CT, Mon–Thu).
 * Returns false during the weekend close (Fri 16:00–Sun 17:00 CT) and on Saturdays.
 *
 * Implementation: directly checks the CME schedule — Mon–Thu, 16:00–17:00 CT.
 * Friday 16:00+ is permanent weekend start (not maintenance); Sunday before 17:00 is
 * the tail end of the weekend close (also not maintenance).
 */
export function isCmeMaintenanceWindow(now?: Date): boolean {
  const instant = now ?? new Date();
  if (isCmeMarketOpen(instant)) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CME_TZ,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).filter(p => p.type !== "literal").map(p => [p.type, p.value]),
  );
  const weekday = parts.weekday;
  if (!["Monday", "Tuesday", "Wednesday", "Thursday"].includes(weekday)) return false;
  const h = Number(parts.hour) % 24;
  const mins = h * 60 + Number(parts.minute);
  return mins >= 960 && mins < 1020; // 16:00–17:00 CT
}

/**
 * True when the CME Globex market is currently open for trading.
 * Accounts for weekends, the daily 16:00–17:00 CT maintenance break,
 * and Saturday fully closed.
 */
export function isCmeMarketOpen(now?: Date): boolean {
  return getMarketStatus("FUTURES", null, now ?? new Date()).marketOpen;
}

/**
 * Returns the full CME session info for the given instant (defaults to now).
 * Single call-site for all session boundary data.
 */
export function getCmeSessionForInstant(now?: Date): CmeSessionInfo {
  const instant = now ?? new Date();
  const tradingDayKey = deriveCmeTradingDayKey(instant);
  const sessionStart = deriveCmeTradingDaySessionStart(instant);
  const activeTradingEnd = getCmeActiveTradingEnd(tradingDayKey);
  return {
    tradingDayKey,
    sessionStart,
    activeTradingEnd,
    isActiveTradingOpen: isCmeMarketOpen(instant),
    isMaintenanceWindow: isCmeMaintenanceWindow(instant),
  };
}

/**
 * Returns the Tradovate Performance Report request window for a CME session.
 * Ensures the report covers exactly one session (17:00 CT → 16:59:59 CT next day)
 * and never bleeds into the prior session's morning hours (00:00–16:59 CT).
 */
export function getTradovateReportWindowForCmeSession(tradingDayKey: string): TradovateReportWindow {
  return {
    startDate: formatDateMMDDYYYY(tradingDayKey),
    startTime: "17:00:00",
    endDate: formatDateMMDDYYYY(nextCalendarDay(tradingDayKey)),
    endTime: "16:59:59",
  };
}
