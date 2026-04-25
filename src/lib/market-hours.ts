// Standalone market-hours utility. No coach-brain imports.
// All exchange-timezone math uses native Intl APIs only.

export type MarketType = "FUTURES" | "US_EQUITIES" | "FOREX" | "CRYPTO";

export type MarketStatus = {
  isOpen: boolean;
  marketType: MarketType;
  /** Short label for the active session, e.g. "גלובקס", "NYSE / NASDAQ". null when closed. */
  sessionName: string | null;
  /** UTC Date when market will next open. null when already open. */
  nextOpen: Date | null;
  /** UTC Date when market will next close. null when already closed or crypto. */
  nextClose: Date | null;
  /** Resolved IANA tz for display formatting (the user's local timezone). */
  userTimezone: string;
  /** Calendar/exchange authority for this market type. */
  sourceExchange: string;
};

// ─── Private timezone helpers ─────────────────────────────────────────────────

const WEEKDAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

type ZonedParts = {
  weekday: string;
  year: number; month: number; day: number;
  hour: number; minute: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]),
  );
  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24, // en-CA can emit "24" at midnight
    minute: Number(parts.minute),
  };
}

/** Convert a local wall-clock time in `timeZone` back to a UTC Date. */
function zonedToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number,
  timeZone: string,
): Date {
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(targetMs);
  for (let i = 0; i < 4; i++) {
    const p = getZonedParts(guess, timeZone);
    const actualMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const diff = targetMs - actualMs;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

function addDays(
  zoned: { year: number; month: number; day: number },
  n: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day));
  d.setUTCDate(d.getUTCDate() + n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dayIndex(weekday: string): number {
  return WEEKDAY_ORDER.indexOf(weekday as typeof WEEKDAY_ORDER[number]);
}

// ─── CME Equity-Index Futures (ES, NQ, YM, RTY) ──────────────────────────────
//
// Exchange timezone: America/Chicago (CT)
//   Open:         Sunday 17:00 CT → Friday 16:00 CT
//   Daily break:  Mon–Fri 16:00–17:00 CT
//   Saturday:     fully closed
//
// Holiday / special-hours extension point:
//   Insert an isCmeHoliday(date, FUTURES_TZ) guard before the "Open" return.

const FUTURES_TZ = "America/Chicago";

function getFuturesStatus(now: Date): Omit<MarketStatus, "marketType" | "userTimezone" | "sourceExchange"> {
  const ct = getZonedParts(now, FUTURES_TZ);
  const dayIdx = dayIndex(ct.weekday);
  const mins = ct.hour * 60 + ct.minute;
  const CLOSE = 16 * 60; // 16:00 CT
  const OPEN  = 17 * 60; // 17:00 CT

  // Saturday: fully closed — reopen Sunday 17:00 CT
  if (dayIdx === 6) {
    const sun = addDays(ct, 1);
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(sun.year, sun.month, sun.day, 17, 0, FUTURES_TZ),
      nextClose: null,
    };
  }

  // Sunday before 17:00 CT: not open yet
  if (dayIdx === 0 && mins < OPEN) {
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(ct.year, ct.month, ct.day, 17, 0, FUTURES_TZ),
      nextClose: null,
    };
  }

  // Friday at/after 16:00 CT: permanent weekend close (next open = Sunday 17:00 CT)
  if (dayIdx === 5 && mins >= CLOSE) {
    const sun = addDays(ct, 2); // Fri + 2 = Sun
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(sun.year, sun.month, sun.day, 17, 0, FUTURES_TZ),
      nextClose: null,
    };
  }

  // Daily maintenance break: Mon–Fri 16:00–17:00 CT
  // (Friday >= 16:00 is already caught above, so this only fires Mon–Thu in practice)
  if (dayIdx !== 0 && mins >= CLOSE && mins < OPEN) {
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(ct.year, ct.month, ct.day, 17, 0, FUTURES_TZ),
      nextClose: null,
    };
  }

  // Open — compute next close
  let nextClose: Date;
  if (dayIdx === 5) {
    // Friday before 16:00: closes today
    nextClose = zonedToUtc(ct.year, ct.month, ct.day, 16, 0, FUTURES_TZ);
  } else if (dayIdx === 0 || mins >= OPEN) {
    // Sunday after 17:00, or Mon–Thu after 17:00 (post-break new session)
    // → next close is tomorrow 16:00 CT
    const tomorrow = addDays(ct, 1);
    nextClose = zonedToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 16, 0, FUTURES_TZ);
  } else {
    // Mon–Thu before 16:00: closes today at 16:00
    nextClose = zonedToUtc(ct.year, ct.month, ct.day, 16, 0, FUTURES_TZ);
  }

  return { isOpen: true, sessionName: "גלובקס", nextOpen: null, nextClose };
}

// ─── US Equities (NYSE / NASDAQ) ──────────────────────────────────────────────
//
// Exchange timezone: America/New_York (ET)
//   Pre-market:   04:00–09:30 ET  (Mon–Fri)
//   Regular:      09:30–16:00 ET  (Mon–Fri)
//   After-hours:  16:00–20:00 ET  (Mon–Fri)
//   Weekend:      closed
//
// Holiday extension point: add a isNyseHoliday(date, EQUITIES_TZ) guard.

const EQUITIES_TZ = "America/New_York";

function getEquitiesStatus(now: Date): Omit<MarketStatus, "marketType" | "userTimezone" | "sourceExchange"> {
  const et = getZonedParts(now, EQUITIES_TZ);
  const dayIdx = dayIndex(et.weekday);
  const mins = et.hour * 60 + et.minute;

  const PRE_START  = 4 * 60;        // 04:00
  const REG_START  = 9 * 60 + 30;   // 09:30
  const REG_CLOSE  = 16 * 60;       // 16:00
  const AH_END     = 20 * 60;       // 20:00

  // Weekend
  if (dayIdx === 0 || dayIdx === 6) {
    const daysToMon = dayIdx === 6 ? 2 : 1;
    const mon = addDays(et, daysToMon);
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(mon.year, mon.month, mon.day, 4, 0, EQUITIES_TZ),
      nextClose: null,
    };
  }

  // Before pre-market (midnight–04:00)
  if (mins < PRE_START) {
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(et.year, et.month, et.day, 4, 0, EQUITIES_TZ),
      nextClose: null,
    };
  }

  // Pre-market
  if (mins < REG_START) {
    return {
      isOpen: true, sessionName: "פרי-מרקט",
      nextOpen: null,
      nextClose: zonedToUtc(et.year, et.month, et.day, 9, 30, EQUITIES_TZ),
    };
  }

  // Regular hours
  if (mins < REG_CLOSE) {
    return {
      isOpen: true, sessionName: "NYSE / NASDAQ",
      nextOpen: null,
      nextClose: zonedToUtc(et.year, et.month, et.day, 16, 0, EQUITIES_TZ),
    };
  }

  // After-hours
  if (mins < AH_END) {
    return {
      isOpen: true, sessionName: "אפטר-האוורס",
      nextOpen: null,
      nextClose: zonedToUtc(et.year, et.month, et.day, 20, 0, EQUITIES_TZ),
    };
  }

  // After 20:00 ET — next session: pre-market next trading day
  if (dayIdx === 5) {
    // Friday after-hours → next Monday 04:00
    const mon = addDays(et, 3);
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(mon.year, mon.month, mon.day, 4, 0, EQUITIES_TZ),
      nextClose: null,
    };
  }
  const tomorrow = addDays(et, 1);
  return {
    isOpen: false, sessionName: null,
    nextOpen: zonedToUtc(tomorrow.year, tomorrow.month, tomorrow.day, 4, 0, EQUITIES_TZ),
    nextClose: null,
  };
}

// ─── Forex ────────────────────────────────────────────────────────────────────
//
// Reference timezone: America/New_York (ET)
//   Open:    Sunday 17:00 ET
//   Close:   Friday 17:00 ET
//   Nearly 24/5 — session labels based on UTC hour.

const FOREX_TZ = "America/New_York";

function getForexStatus(now: Date): Omit<MarketStatus, "marketType" | "userTimezone" | "sourceExchange"> {
  const et = getZonedParts(now, FOREX_TZ);
  const dayIdx = dayIndex(et.weekday);
  const mins = et.hour * 60 + et.minute;
  const FOREX_BOUNDARY = 17 * 60; // 17:00 ET open/close boundary

  // Saturday: fully closed
  if (dayIdx === 6) {
    const sun = addDays(et, 1);
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(sun.year, sun.month, sun.day, 17, 0, FOREX_TZ),
      nextClose: null,
    };
  }

  // Sunday before 17:00 ET: closed
  if (dayIdx === 0 && mins < FOREX_BOUNDARY) {
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(et.year, et.month, et.day, 17, 0, FOREX_TZ),
      nextClose: null,
    };
  }

  // Friday at/after 17:00 ET: weekend close
  if (dayIdx === 5 && mins >= FOREX_BOUNDARY) {
    const sun = addDays(et, 2);
    return {
      isOpen: false, sessionName: null,
      nextOpen: zonedToUtc(sun.year, sun.month, sun.day, 17, 0, FOREX_TZ),
      nextClose: null,
    };
  }

  // Open — derive session label from UTC hour
  const utcHour = now.getUTCHours();
  let sessionName: string;
  if (utcHour >= 22 || utcHour < 7)        sessionName = "סשן אסיה";
  else if (utcHour < 12)                    sessionName = "סשן לונדון";
  else if (utcHour < 17)                    sessionName = "סשן NY";
  else                                      sessionName = "פורקס";

  // nextClose = Friday 17:00 ET
  const daysToFri = (5 - dayIdx + 7) % 7;
  let nextClose: Date;
  if (daysToFri === 0 && mins < FOREX_BOUNDARY) {
    nextClose = zonedToUtc(et.year, et.month, et.day, 17, 0, FOREX_TZ);
  } else {
    const effectiveDays = daysToFri === 0 ? 7 : daysToFri;
    const fri = addDays(et, effectiveDays);
    nextClose = zonedToUtc(fri.year, fri.month, fri.day, 17, 0, FOREX_TZ);
  }

  return { isOpen: true, sessionName, nextOpen: null, nextClose };
}

// ─── Crypto ───────────────────────────────────────────────────────────────────

function getCryptoStatus(): Omit<MarketStatus, "marketType" | "userTimezone" | "sourceExchange"> {
  return { isOpen: true, sessionName: "24/7", nextOpen: null, nextClose: null };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Normalize the freeform primaryMarket string stored in TraderProfile. */
export function normalizeMarketType(primaryMarket: string | null | undefined): MarketType {
  if (!primaryMarket) return "FUTURES";
  const s = primaryMarket.toLowerCase().replace(/[\s_]/g, "");
  if (s.includes("future"))                 return "FUTURES";
  if (s.includes("equit") || s.includes("stock")) return "US_EQUITIES";
  if (s.includes("forex") || s.includes("fx"))    return "FOREX";
  if (s.includes("crypto") || s.includes("coin")) return "CRYPTO";
  return "FUTURES";
}

function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz }).format(new Date());
    return true;
  } catch { return false; }
}

/**
 * Returns the current market status for the given asset class and user timezone.
 * All times in nextOpen/nextClose are UTC Date objects;
 * use the userTimezone field when displaying to the user.
 */
export function getMarketStatus(
  primaryMarket: string | null,
  userTimezone: string | null,
  now: Date = new Date(),
): MarketStatus {
  const marketType = normalizeMarketType(primaryMarket);
  const resolvedTz = isValidTimeZone(userTimezone) ? userTimezone! : "UTC";

  type Core = Omit<MarketStatus, "marketType" | "userTimezone" | "sourceExchange">;
  let core: Core;
  let sourceExchange: string;
  switch (marketType) {
    case "FUTURES":
      core = getFuturesStatus(now);
      sourceExchange = "CME Globex";
      break;
    case "US_EQUITIES":
      core = getEquitiesStatus(now);
      sourceExchange = "NYSE / NASDAQ";
      break;
    case "FOREX":
      core = getForexStatus(now);
      sourceExchange = "FX Spot Market";
      break;
    case "CRYPTO":
      core = getCryptoStatus();
      sourceExchange = "Crypto Exchange";
      break;
  }

  return { ...core, marketType, userTimezone: resolvedTz, sourceExchange };
}

// ─── Intent detection ─────────────────────────────────────────────────────────

const PATTERNS_HE = [
  "יש מסחר",
  "השוק פתוח",
  "השוק סגור",
  "שוק פתוח",
  "שוק סגור",
  "אפשר לסחור",
  "מתי נפתח",
  "מתי סוגר",
  "מתי פותח",
  "גלובקס פתוח",
  "גלובקס סגור",
  "יש גלובקס",
  "המסחר פתוח",
  "המסחר סגור",
  "פיוצ'רס פתוח",
  "פיוצ'רס סגור",
  "השוק נפתח",
  "השוק נסגר",
];

const PATTERNS_EN = [
  "market open",
  "market closed",
  "is the market",
  "can i trade",
  "is trading open",
  "when does it open",
  "market hours",
  "futures open",
  "futures closed",
  "trading now",
];

/** True when the message is asking about current market open/close status. */
export function isMarketHoursQuestion(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return (
    PATTERNS_HE.some(p => lower.includes(p)) ||
    PATTERNS_EN.some(p => lower.includes(p))
  );
}
