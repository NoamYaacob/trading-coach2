import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getCmeSessionStartForKey,
  getCmeActiveTradingEnd,
  getCmeSessionForInstant,
  getTradovateReportWindowForCmeSession,
  isCmeMaintenanceWindow,
  isCmeMarketOpen,
  getCurrentCmeTradingDayKey,
} from "./cme-session.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse a UTC ISO string into a Date. */
function utc(iso: string): Date {
  return new Date(iso);
}

/**
 * Convert an America/Chicago wall-clock string ("2026-05-08T17:00:00") to a
 * UTC Date. Uses Intl to resolve the correct DST offset.
 *
 * This is test-only scaffolding — production code must never hand-roll timezone
 * offsets. Tests use this to express expectations in the exchange's local time.
 */
function ct(localIso: string): Date {
  const [datePart, timePart] = localIso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min, s = 0] = timePart.split(":").map(Number);

  // Two-pass: guess UTC, read back CT offset, correct.
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, s));
  function ctOffset(at: Date): number {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(at);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
    const hr = get("hour") % 24;
    const tzMs = Date.UTC(get("year"), get("month") - 1, get("day"), hr, get("minute"), get("second"));
    return Math.round((tzMs - at.getTime()) / 60_000);
  }
  const off1 = ctOffset(guess);
  const adj = new Date(guess.getTime() - off1 * 60_000);
  const off2 = ctOffset(adj);
  return new Date(guess.getTime() - off2 * 60_000);
}

// ── getCmeSessionStartForKey ──────────────────────────────────────────────────

describe("getCmeSessionStartForKey", () => {
  it("2026-05-07 → 17:00 CT May 7 (CDT = UTC-5) → 22:00 UTC May 7", () => {
    const result = getCmeSessionStartForKey("2026-05-07");
    assert.equal(result.toISOString(), "2026-05-07T22:00:00.000Z");
  });

  it("2026-01-05 → 17:00 CT Jan 5 (CST = UTC-6) → 23:00 UTC Jan 5", () => {
    const result = getCmeSessionStartForKey("2026-01-05");
    assert.equal(result.toISOString(), "2026-01-05T23:00:00.000Z");
  });
});

// ── getCmeActiveTradingEnd ────────────────────────────────────────────────────

describe("getCmeActiveTradingEnd", () => {
  it("2026-05-07 → 16:00 CT May 8 (CDT) → 21:00 UTC May 8", () => {
    const result = getCmeActiveTradingEnd("2026-05-07");
    assert.equal(result.toISOString(), "2026-05-08T21:00:00.000Z");
  });

  it("2026-12-31 → 16:00 CT Jan 1 2027 (CST) → 22:00 UTC Jan 1 2027", () => {
    const result = getCmeActiveTradingEnd("2026-12-31");
    assert.equal(result.toISOString(), "2027-01-01T22:00:00.000Z");
  });
});

// ── getCurrentCmeTradingDayKey ────────────────────────────────────────────────

describe("getCurrentCmeTradingDayKey — session key changes at 17:00 CT, not midnight", () => {
  // May 8, 2026 is a Friday. CDT = UTC-5.
  // 17:00 CT May 7 = 22:00 UTC May 7 (session key "2026-05-07")
  // 17:00 CT May 8 = 22:00 UTC May 8 (session key "2026-05-08")

  it("10:00 CT May 8 belongs to session opened 17:00 CT May 7", () => {
    const result = getCurrentCmeTradingDayKey(ct("2026-05-08T10:00:00"));
    assert.equal(result, "2026-05-07");
  });

  it("16:59 CT May 8 still belongs to session opened 17:00 CT May 7", () => {
    const result = getCurrentCmeTradingDayKey(ct("2026-05-08T16:59:00"));
    assert.equal(result, "2026-05-07");
  });

  it("17:00 CT May 8 opens session key 2026-05-08", () => {
    const result = getCurrentCmeTradingDayKey(ct("2026-05-08T17:00:00"));
    assert.equal(result, "2026-05-08");
  });

  it("18:00 CT May 8 belongs to session 2026-05-08", () => {
    const result = getCurrentCmeTradingDayKey(ct("2026-05-08T18:00:00"));
    assert.equal(result, "2026-05-08");
  });
});

// ── getCmeSessionForInstant — session boundary fields ─────────────────────────

describe("getCmeSessionForInstant — active trading window", () => {
  it("10:00 CT May 8: in active trading [May 7 17:00 CT, May 8 16:00 CT)", () => {
    const info = getCmeSessionForInstant(ct("2026-05-08T10:00:00"));
    assert.equal(info.tradingDayKey, "2026-05-07");
    assert.equal(info.sessionStart.toISOString(), "2026-05-07T22:00:00.000Z");
    assert.equal(info.activeTradingEnd.toISOString(), "2026-05-08T21:00:00.000Z");
    assert.equal(info.isActiveTradingOpen, true);
    assert.equal(info.isMaintenanceWindow, false);
  });

  it("3:59 PM CT (15:59) May 8: still in active trading", () => {
    const info = getCmeSessionForInstant(ct("2026-05-08T15:59:00"));
    assert.equal(info.tradingDayKey, "2026-05-07");
    assert.equal(info.isActiveTradingOpen, true);
    assert.equal(info.isMaintenanceWindow, false);
  });
});

describe("getCmeSessionForInstant — 4:00 PM to 4:59 PM CT: maintenance break (Thursday)", () => {
  // May 7 2026 is Thursday. Maintenance = Mon–Thu 16:00–17:00 CT.
  // Friday 16:00+ is permanent weekend close, not maintenance.
  it("4:00 PM CT (16:00) May 7: maintenance begins", () => {
    const info = getCmeSessionForInstant(ct("2026-05-07T16:00:00"));
    assert.equal(info.isActiveTradingOpen, false);
    assert.equal(info.isMaintenanceWindow, true);
  });

  it("4:30 PM CT (16:30) May 7: still in maintenance", () => {
    const info = getCmeSessionForInstant(ct("2026-05-07T16:30:00"));
    assert.equal(info.isActiveTradingOpen, false);
    assert.equal(info.isMaintenanceWindow, true);
  });

  it("4:59 PM CT (16:59) May 7: still in maintenance", () => {
    const info = getCmeSessionForInstant(ct("2026-05-07T16:59:00"));
    assert.equal(info.isActiveTradingOpen, false);
    assert.equal(info.isMaintenanceWindow, true);
  });
});

describe("getCmeSessionForInstant — 5:00 PM CT: new session opens (Thursday)", () => {
  // May 7 2026 is Thursday. Friday's 17:00 CT does NOT open a session (CME is weekend-closed).
  it("5:00 PM CT May 7 (Thu): new session 2026-05-07 opens, maintenance ends", () => {
    const info = getCmeSessionForInstant(ct("2026-05-07T17:00:00"));
    assert.equal(info.tradingDayKey, "2026-05-07");
    assert.equal(info.isActiveTradingOpen, true);
    assert.equal(info.isMaintenanceWindow, false);
  });
});

// ── Weekend ───────────────────────────────────────────────────────────────────

describe("getCmeSessionForInstant — weekend", () => {
  // May 9 2026 is Saturday

  it("Saturday 10:00 CT: market closed, not maintenance", () => {
    const info = getCmeSessionForInstant(ct("2026-05-09T10:00:00"));
    assert.equal(info.isActiveTradingOpen, false);
    assert.equal(info.isMaintenanceWindow, false);
  });

  it("Sunday 12:00 CT (before 17:00 open): closed, not maintenance", () => {
    const info = getCmeSessionForInstant(ct("2026-05-10T12:00:00"));
    assert.equal(info.isActiveTradingOpen, false);
    assert.equal(info.isMaintenanceWindow, false);
  });

  it("Sunday 17:00 CT: market opens", () => {
    const info = getCmeSessionForInstant(ct("2026-05-10T17:00:00"));
    assert.equal(info.isActiveTradingOpen, true);
    assert.equal(info.isMaintenanceWindow, false);
  });
});

// ── isCmeMarketOpen / isCmeMaintenanceWindow stand-alone ─────────────────────

describe("isCmeMarketOpen", () => {
  it("weekday active session: true", () => {
    assert.equal(isCmeMarketOpen(ct("2026-05-08T10:00:00")), true);
  });

  it("maintenance break: false", () => {
    assert.equal(isCmeMarketOpen(ct("2026-05-08T16:30:00")), false);
  });

  it("Saturday: false", () => {
    assert.equal(isCmeMarketOpen(ct("2026-05-09T10:00:00")), false);
  });

  it("Sunday 12:00 CT (before 17:00): false", () => {
    assert.equal(isCmeMarketOpen(ct("2026-05-10T12:00:00")), false);
  });

  it("Sunday at 17:00 CT: true", () => {
    assert.equal(isCmeMarketOpen(ct("2026-05-10T17:00:00")), true);
  });
});

describe("isCmeMaintenanceWindow", () => {
  // May 7 2026 is Thursday. Maintenance applies Mon–Thu only.
  it("16:00 CT May 7 (Thursday): true", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-07T16:00:00")), true);
  });

  it("16:59 CT May 7 (Thursday): still maintenance", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-07T16:59:00")), true);
  });

  it("17:00 CT May 7 (Thursday): no longer maintenance (new session open)", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-07T17:00:00")), false);
  });

  it("Friday 16:30 CT: not maintenance (permanent weekend close, not daily break)", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-08T16:30:00")), false);
  });

  it("Saturday: not maintenance (weekend close)", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-09T10:00:00")), false);
  });

  it("Sunday 12:00 CT: not maintenance", () => {
    assert.equal(isCmeMaintenanceWindow(ct("2026-05-10T12:00:00")), false);
  });
});

// ── getTradovateReportWindowForCmeSession ─────────────────────────────────────

describe("getTradovateReportWindowForCmeSession", () => {
  it("session 2026-05-07 → report window 05/07/2026 17:00:00 → 05/08/2026 16:59:59", () => {
    const w = getTradovateReportWindowForCmeSession("2026-05-07");
    assert.equal(w.startDate, "05/07/2026");
    assert.equal(w.startTime, "17:00:00");
    assert.equal(w.endDate, "05/08/2026");
    assert.equal(w.endTime, "16:59:59");
  });

  it("session 2026-12-31 → report window crosses year boundary", () => {
    const w = getTradovateReportWindowForCmeSession("2026-12-31");
    assert.equal(w.startDate, "12/31/2026");
    assert.equal(w.startTime, "17:00:00");
    assert.equal(w.endDate, "01/01/2027");
    assert.equal(w.endTime, "16:59:59");
  });

  it("report window spans exactly one CME session (not full calendar day)", () => {
    // Old code used 00:00:00–23:59:59, which captured prior-session morning trades.
    // Correct window is 17:00:00 → 16:59:59 (23h 59m 59s), not midnight-to-midnight.
    const w = getTradovateReportWindowForCmeSession("2026-05-07");
    const sessionStart = getCmeSessionStartForKey("2026-05-07");
    const activeTradingEnd = getCmeActiveTradingEnd("2026-05-07");
    // The report window start/end match the CME session boundaries.
    const windowStartIso = ct(`${w.startDate.slice(6)}-${w.startDate.slice(0, 2)}-${w.startDate.slice(3, 5)}T${w.startTime}`).toISOString();
    assert.equal(windowStartIso, sessionStart.toISOString());
    // endDate 16:59:59 CT is inside the active-trading window (before 16:00 cutoff is endDate 16:00).
    // The 59-second margin avoids the exact boundary; activeTradingEnd is 16:00 CT.
    const endCt = ct(`2026-05-08T16:59:59`);
    assert.ok(endCt.getTime() < activeTradingEnd.getTime() + 3600_000, "endTime within maintenance window");
    assert.ok(endCt.getTime() > activeTradingEnd.getTime() - 3600_000, "endTime close to activeTradingEnd");
  });
});

// ── Dashboard stale-session guard (regression for DEMO7433035) ────────────────

describe("CME day key stability across midnight UTC", () => {
  // A trade made at e.g. 22:30 UTC on May 7 is 17:30 CT May 7 → session key "2026-05-07".
  // At 00:30 UTC on May 8 (19:30 CT May 7), still session key "2026-05-07".
  // UTC midnight does NOT change the CME session key.

  it("22:30 UTC May 7 → session key 2026-05-07", () => {
    assert.equal(getCurrentCmeTradingDayKey(utc("2026-05-07T22:30:00.000Z")), "2026-05-07");
  });

  it("00:30 UTC May 8 (still 19:30 CT May 7) → session key 2026-05-07", () => {
    assert.equal(getCurrentCmeTradingDayKey(utc("2026-05-08T00:30:00.000Z")), "2026-05-07");
  });

  it("21:59 UTC May 8 (still 16:59 CT May 8) → session key 2026-05-07", () => {
    assert.equal(getCurrentCmeTradingDayKey(utc("2026-05-08T21:59:00.000Z")), "2026-05-07");
  });

  it("22:00 UTC May 8 (17:00 CT May 8) → session key 2026-05-08 (new session)", () => {
    assert.equal(getCurrentCmeTradingDayKey(utc("2026-05-08T22:00:00.000Z")), "2026-05-08");
  });
});
