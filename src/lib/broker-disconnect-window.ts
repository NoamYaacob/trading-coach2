/**
 * Broker-disconnect availability window.
 *
 * Broker connections may only be disconnected during the CME futures
 * maintenance window — the daily break when accounts are not under active
 * monitoring. Source of truth is America/Chicago (CT), consistent with the
 * existing CME helpers in market-hours.ts.
 *
 * Allowed window: Mon–Fri 14:00–18:00 CT
 *   ≈ 22:00–02:00 Israel time in summer/winter (offset shifts ±1 h during
 *     the spring/fall DST-transition gap between US and Israel calendars —
 *     see tests for exact expected values per scenario).
 *
 * This has nothing to do with the user's protected session window
 * (sessionStartHour / sessionEndHour). Those are user-configurable and drive
 * P&L bucketing and protection locking; they must NOT affect disconnect timing.
 */

const DISCONNECT_TZ = "America/Chicago";
const WINDOW_START_HOUR = 14; // 14:00 CT
const WINDOW_END_HOUR = 18;   // 18:00 CT

// ─── Timezone math helpers ────────────────────────────────────────────────────

type ZonedParts = {
  weekday: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getZonedParts(date: Date): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISCONNECT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday!,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // en-CA can emit "24" at midnight
    minute: Number(parts.minute),
  };
}

/**
 * Convert a local wall-clock time in DISCONNECT_TZ back to a UTC Date.
 * Iterates up to 4 times to converge (handles DST gaps/overlaps).
 */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(targetMs);
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(guess);
    const actualMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const diff = targetMs - actualMs;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function addCalendarDays(
  z: { year: number; month: number; day: number },
  n: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(z.year, z.month - 1, z.day));
  d.setUTCDate(d.getUTCDate() + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

const WEEKDAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

function dayIndex(weekday: string): number {
  return WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number]);
}

function isWeekday(dayIdx: number): boolean {
  return dayIdx >= 1 && dayIdx <= 5;
}

/**
 * Days to add to reach the day whose window is next.
 * Returns 0 when today's window hasn't started yet.
 */
function daysToNextWindowDay(dayIdx: number, pastWindow: boolean): number {
  if (isWeekday(dayIdx) && !pastWindow) return 0; // today's window (not started yet)
  if (isWeekday(dayIdx)) {
    if (dayIdx === 5) return 3; // Friday past window → Monday
    return 1;                    // Mon–Thu past window → next day
  }
  if (dayIdx === 0) return 1;   // Sunday → Monday
  return 2;                      // Saturday → Monday
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type DisconnectWindowState = {
  /** True when broker disconnect is currently blocked (outside the maintenance window). */
  isBlocked: boolean;
  /**
   * UTC start of the upcoming or current allowed disconnect window.
   * When isBlocked=false this is the current window's start (in the past).
   * When isBlocked=true this is the next window's start (in the future or later today).
   */
  nextWindowStart: Date;
  /** UTC end of the upcoming or current allowed disconnect window. */
  nextWindowEnd: Date;
};

/**
 * Returns whether broker disconnect is currently allowed, and the UTC bounds
 * of the upcoming (or current) allowed window.
 *
 * Pass the UTC timestamps to the UI; display them in the user's local timezone
 * via Intl.DateTimeFormat — the conversion is DST-aware automatically.
 */
export function getBrokerDisconnectWindow(now: Date = new Date()): DisconnectWindowState {

  const ct = getZonedParts(now);
  const dayIdx = dayIndex(ct.weekday);
  const mins = ct.hour * 60 + ct.minute;
  const windowStartMins = WINDOW_START_HOUR * 60;
  const windowEndMins = WINDOW_END_HOUR * 60;

  const inWindowToday = isWeekday(dayIdx) && mins >= windowStartMins && mins < windowEndMins;

  if (inWindowToday) {
    return {
      isBlocked: false,
      nextWindowStart: zonedToUtc(ct.year, ct.month, ct.day, WINDOW_START_HOUR, 0),
      nextWindowEnd: zonedToUtc(ct.year, ct.month, ct.day, WINDOW_END_HOUR, 0),
    };
  }

  const pastWindow = isWeekday(dayIdx) && mins >= windowEndMins;
  const offset = daysToNextWindowDay(dayIdx, pastWindow);
  const target = addCalendarDays(ct, offset);

  return {
    isBlocked: true,
    nextWindowStart: zonedToUtc(target.year, target.month, target.day, WINDOW_START_HOUR, 0),
    nextWindowEnd: zonedToUtc(target.year, target.month, target.day, WINDOW_END_HOUR, 0),
  };
}

// ─── Per-account disconnect availability ──────────────────────────────────────

export type AccountDisconnectAvailability = {
  /** True when the disconnect window blocks this account. Always false for unavailable accounts. */
  isBlocked: boolean;
  /** True when the account is no longer active in the broker (missingFromBrokerSince is set). */
  isUnavailable: boolean;
};

/**
 * Computes disconnect availability for a single account.
 *
 * The CME maintenance-window restriction applies only to actively connected,
 * protected accounts. Unavailable, ignored, and archived accounts can be
 * removed at any time — there is no active broker connection to protect.
 */
export function computeAccountDisconnectState(
  account: { missingFromBrokerSince: Date | null; protectionStatus: string },
  windowState: DisconnectWindowState,
): AccountDisconnectAvailability {
  const isUnavailable = account.missingFromBrokerSince != null;
  const bypassWindow =
    isUnavailable ||
    account.protectionStatus === "ignored" ||
    account.protectionStatus === "archived";
  return {
    isBlocked: bypassWindow ? false : windowState.isBlocked,
    isUnavailable,
  };
}
