/**
 * Tests for getBrokerDisconnectWindow.
 *
 * Source of truth: America/Chicago (CT).
 * Allowed window: Mon–Fri 14:00–18:00 CT.
 *
 * DST calendar facts used below (2024):
 *   US CDT starts:    March 10  (UTC-5 from then until Nov 3)
 *   Israel IDT starts: March 29  (UTC+3 from then until Oct 27)
 *   Israel IDT ends:  October 27 (back to IST = UTC+2)
 *   US CDT ends:      November 3  (back to CST = UTC-6)
 *
 * This creates two gap periods where US and Israel DST offsets differ:
 *   Spring gap  Mar 10–28: US CDT (UTC-5), Israel IST (UTC+2) → IL offset = UTC+7h → window = 21:00–01:00 IL
 *   Fall gap    Oct 27–Nov 2: US CDT (UTC-5), Israel IST (UTC+2) → same offset → window = 21:00–01:00 IL
 *
 * Normal (both on same DST regime, offset always 8 h):
 *   Summer: US CDT (UTC-5) + Israel IDT (UTC+3) → window = 22:00–02:00 IL
 *   Winter: US CST (UTC-6) + Israel IST (UTC+2) → window = 22:00–02:00 IL
 *
 * Note: "Israel DST but US not" cannot occur — Israel's DST always starts
 * after US DST in spring, and ends before US DST ends in fall.
 * The requirement's "Israel DST but US not" test is covered by the fall-gap
 * scenario (same direction: US CDT, Israel already on IST after falling back).
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { getBrokerDisconnectWindow } from "./broker-disconnect-window.ts";

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Hour (0-23) of a UTC Date when viewed in a given IANA timezone. */
function hourInTz(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
}

/** "HH:MM" of a UTC Date in a given IANA timezone. */
function hhmmInTz(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return `${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

/** YYYY-MM-DD of a UTC Date in a given IANA timezone. */
function dateKeyInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

const IL = "Asia/Jerusalem";
const CT = "America/Chicago";

// ─── Blocking logic ───────────────────────────────────────────────────────────

describe("getBrokerDisconnectWindow — blocking logic (winter dates, CST)", () => {
  // Jan 15, 2024 = Monday, US CST (UTC-6), Israel IST (UTC+2)

  test("Mon 15:00 CT — in window → not blocked", () => {
    // 15:00 CST = UTC+6 → 21:00 UTC
    const now = new Date("2024-01-15T21:00:00Z");
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
  });

  test("Mon 13:59 CT — one minute before window → blocked, window later today", () => {
    // 13:59 CST = 19:59 UTC
    const now = new Date("2024-01-15T19:59:00Z");
    const { isBlocked, nextWindowStart } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
    // Window starts Mon 14:00 CST = 20:00 UTC — same calendar day in CT
    assert.equal(dateKeyInTz(nextWindowStart, CT), "2024-01-15");
    assert.equal(hourInTz(nextWindowStart, CT), 14);
  });

  test("Mon 18:01 CT — one minute after window → blocked, window tomorrow", () => {
    // 18:01 CST = 00:01 UTC next day
    const now = new Date("2024-01-16T00:01:00Z");
    const { isBlocked, nextWindowStart } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
    // Next window: Tuesday Jan 16
    assert.equal(dateKeyInTz(nextWindowStart, CT), "2024-01-16");
    assert.equal(hourInTz(nextWindowStart, CT), 14);
  });

  test("Mon 14:00 CT exactly — boundary is inclusive → not blocked", () => {
    // 14:00 CST = 20:00 UTC
    const now = new Date("2024-01-15T20:00:00Z");
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
  });

  test("Mon 18:00 CT exactly — boundary is exclusive (past window) → blocked", () => {
    // 18:00 CST = 00:00 UTC next day
    const now = new Date("2024-01-16T00:00:00Z");
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
  });
});

describe("getBrokerDisconnectWindow — weekend and Friday skip", () => {
  // Jan 19, 2024 = Friday; Jan 20 = Saturday; Jan 21 = Sunday; Jan 22 = Monday

  test("Friday 15:00 CT — in window → not blocked", () => {
    // 15:00 CST = 21:00 UTC
    const now = new Date("2024-01-19T21:00:00Z");
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
  });

  test("Friday 19:00 CT — past window → blocked, next window is Monday", () => {
    // 19:00 CST = 01:00 UTC Saturday
    const now = new Date("2024-01-20T01:00:00Z");
    const { isBlocked, nextWindowStart } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
    assert.equal(dateKeyInTz(nextWindowStart, CT), "2024-01-22"); // Monday
    assert.equal(hourInTz(nextWindowStart, CT), 14);
  });

  test("Saturday 12:00 CT → blocked, next window is Monday", () => {
    const now = new Date("2024-01-20T18:00:00Z"); // 12:00 CST
    const { isBlocked, nextWindowStart } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
    assert.equal(dateKeyInTz(nextWindowStart, CT), "2024-01-22");
  });

  test("Sunday 12:00 CT → blocked, next window is Monday", () => {
    const now = new Date("2024-01-21T18:00:00Z"); // 12:00 CST
    const { isBlocked, nextWindowStart } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true);
    assert.equal(dateKeyInTz(nextWindowStart, CT), "2024-01-22");
  });
});

// ─── DST mismatch — Israel display window ─────────────────────────────────────

describe("getBrokerDisconnectWindow — Israel display window across DST scenarios", () => {
  /**
   * Winter (Jan 15, 2024, Monday):
   *   US CST (UTC-6), Israel IST (UTC+2) — offset between CT and IL = 8 h
   *   14:00 CST = 20:00 UTC = 22:00 IST
   *   18:00 CST = 00:00 UTC Jan 16 = 02:00 IST Jan 16
   */
  test("winter: both on standard time — IL window 22:00–02:00", () => {
    const now = new Date("2024-01-15T21:00:00Z"); // 15:00 CST, in window
    const { isBlocked, nextWindowStart, nextWindowEnd } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
    assert.equal(hhmmInTz(nextWindowStart, IL), "22:00", "window start in Israel");
    assert.equal(hhmmInTz(nextWindowEnd, IL), "02:00", "window end in Israel (crosses midnight)");
  });

  /**
   * Summer (July 15, 2024, Monday):
   *   US CDT (UTC-5), Israel IDT (UTC+3) — offset = 8 h
   *   14:00 CDT = 19:00 UTC = 22:00 IDT
   *   18:00 CDT = 23:00 UTC = 02:00 IDT Jul 16
   */
  test("summer: both on DST — IL window 22:00–02:00", () => {
    const now = new Date("2024-07-15T20:00:00Z"); // 15:00 CDT, in window
    const { isBlocked, nextWindowStart, nextWindowEnd } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
    assert.equal(hhmmInTz(nextWindowStart, IL), "22:00", "window start in Israel");
    assert.equal(hhmmInTz(nextWindowEnd, IL), "02:00", "window end in Israel (crosses midnight)");
  });

  /**
   * Spring gap (March 15, 2024, Friday):
   *   US switched to CDT on Mar 10; Israel still on IST (switches Mar 29).
   *   US CDT (UTC-5), Israel IST (UTC+2) — offset = 7 h (not 8!)
   *   14:00 CDT = 19:00 UTC = 21:00 IST
   *   18:00 CDT = 23:00 UTC = 01:00 IST Mar 16
   *
   *   This is "US DST but Israel not yet" — the mismatch period.
   */
  test("spring gap (US CDT, Israel IST): IL window shifts to 21:00–01:00", () => {
    const now = new Date("2024-03-15T20:00:00Z"); // 15:00 CDT, in window
    const { isBlocked, nextWindowStart, nextWindowEnd } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
    assert.equal(hhmmInTz(nextWindowStart, IL), "21:00", "window start in Israel (1 h earlier vs summer/winter)");
    assert.equal(hhmmInTz(nextWindowEnd, IL), "01:00", "window end in Israel");
  });

  /**
   * Fall gap (Oct 30, 2024, Wednesday):
   *   Israel fell back to IST on Oct 27; US still on CDT (falls back Nov 3).
   *   US CDT (UTC-5), Israel IST (UTC+2) — offset = 7 h
   *   Same window shift as spring gap: 21:00–01:00 IST
   *
   *   Requirement labels this "a date where Israel is DST but US is not";
   *   in practice the only mismatch periods are both US-CDT-Israel-IST (offset 7).
   *   The computation is still DST-aware via Intl, ensuring correctness for any
   *   future DST schedule change.
   */
  test("fall gap (Israel IST, US still CDT): IL window shifts to 21:00–01:00", () => {
    const now = new Date("2024-10-30T20:00:00Z"); // 15:00 CDT, in window
    const { isBlocked, nextWindowStart, nextWindowEnd } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
    assert.equal(hhmmInTz(nextWindowStart, IL), "21:00");
    assert.equal(hhmmInTz(nextWindowEnd, IL), "01:00");
  });

  test("winter and summer windows are identical (both offset = 8 h)", () => {
    const winter = getBrokerDisconnectWindow(new Date("2024-01-15T21:00:00Z"));
    const summer = getBrokerDisconnectWindow(new Date("2024-07-15T20:00:00Z"));
    assert.equal(hhmmInTz(winter.nextWindowStart, IL), hhmmInTz(summer.nextWindowStart, IL));
    assert.equal(hhmmInTz(winter.nextWindowEnd, IL), hhmmInTz(summer.nextWindowEnd, IL));
  });

  test("spring and fall gap windows are identical (both offset = 7 h)", () => {
    const spring = getBrokerDisconnectWindow(new Date("2024-03-15T20:00:00Z"));
    const fall   = getBrokerDisconnectWindow(new Date("2024-10-30T20:00:00Z"));
    assert.equal(hhmmInTz(spring.nextWindowStart, IL), hhmmInTz(fall.nextWindowStart, IL));
    assert.equal(hhmmInTz(spring.nextWindowEnd, IL), hhmmInTz(fall.nextWindowEnd, IL));
  });

  test("gap window differs from normal window (offset is 7 h, not 8 h)", () => {
    const gapStart  = hhmmInTz(getBrokerDisconnectWindow(new Date("2024-03-15T20:00:00Z")).nextWindowStart, IL);
    const normStart = hhmmInTz(getBrokerDisconnectWindow(new Date("2024-01-15T21:00:00Z")).nextWindowStart, IL);
    assert.notEqual(gapStart, normStart, "DST gap must shift the Israel window by 1 hour");
  });
});

// ─── Protected session independence ──────────────────────────────────────────

describe("protected session independence", () => {
  /**
   * getBrokerDisconnectWindow() takes no session config. The user's
   * sessionStartHour / sessionEndHour / protectionLockCutoffMinutes must have
   * zero influence on when disconnect is allowed. This test documents the
   * invariant: calling the function twice with the same `now` gives identical
   * results regardless of any external state.
   */
  test("result is pure — same `now` always returns identical output", () => {
    const now = new Date("2024-01-15T16:00:00Z"); // 10:00 CST, blocked
    const a = getBrokerDisconnectWindow(now);
    const b = getBrokerDisconnectWindow(now);
    assert.equal(a.isBlocked, b.isBlocked);
    assert.equal(a.nextWindowStart.getTime(), b.nextWindowStart.getTime());
    assert.equal(a.nextWindowEnd.getTime(), b.nextWindowEnd.getTime());
  });

  test("protected session active hours (09:00–18:00) do NOT make disconnect available", () => {
    // Simulate: user's session is 09:00–18:00 Israel time. It is 11:00 IST = 09:00 CT
    // (winter). That is OUTSIDE the 14:00–18:00 CT maintenance window, so disconnect
    // must be BLOCKED even though the user's session says "active monitoring".
    // (IST 11:00 = CST 09:00 = UTC 15:00)
    const now = new Date("2024-01-15T15:00:00Z"); // 09:00 CST
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true, "09:00 CT is before the 14:00 CT window — must be blocked");
  });

  test("protected session inactive hours do NOT unblock disconnect if outside window", () => {
    // Simulate: user's session ends at 18:00 Israel time = 08:00 CT (winter).
    // Even though the protected session is 'over', 08:00 CT is still outside
    // the 14:00–18:00 CT maintenance window.
    // (IST 10:00 = CST 08:00 = UTC 14:00... wait, IST=UTC+2, so 10:00 IST = 08:00 UTC.
    //  CST=UTC-6, so 08:00 UTC = 02:00 CST)
    // Use 08:00 CST = 14:00 UTC
    const now = new Date("2024-01-15T14:00:00Z"); // 08:00 CST
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, true, "08:00 CT is before the 14:00 CT window — must be blocked");
  });

  test("disconnect allowed at 15:00 CT regardless of what the session window is", () => {
    // No matter what the user's session hours are configured to be, if it is
    // 15:00 CT on a weekday, disconnect must be allowed.
    const now = new Date("2024-01-15T21:00:00Z"); // 15:00 CST
    const { isBlocked } = getBrokerDisconnectWindow(now);
    assert.equal(isBlocked, false);
  });
});
