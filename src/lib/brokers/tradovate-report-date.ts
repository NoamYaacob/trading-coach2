/**
 * Pure date helpers for scoping Tradovate Performance Report requests to
 * the correct CME Globex session window.
 *
 * CME sessions run 17:00 CT → 17:00 CT the next calendar day. Using the
 * full calendar day (00:00–23:59 CT) for the session key date would include
 * the morning hours (00:00–16:59 CT) that belong to the PREVIOUS session,
 * inflating the trade count with carryover trades from the prior day.
 *
 * The correct report window is:
 *   startDate = tradingDayKey, startTime = "17:00:00"
 *   endDate   = nextCalendarDay(tradingDayKey), endTime = "16:59:59"
 */

/** Converts a YYYY-MM-DD key to MM/DD/YYYY, the format Tradovate's reports endpoint expects. */
export function formatDateMMDDYYYY(tradingDayKey: string): string {
  const [y, m, d] = tradingDayKey.split("-");
  return `${m}/${d}/${y}`;
}

/** Returns the calendar day after a YYYY-MM-DD key, as a YYYY-MM-DD string. */
export function nextCalendarDay(tradingDayKey: string): string {
  const [y, m, d] = tradingDayKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  return `${ny}-${nm}-${nd}`;
}
