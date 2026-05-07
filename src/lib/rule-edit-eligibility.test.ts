import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRuleEditEligibility,
  buildRuleEditLockMessage,
  DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES,
} from "./rule-edit-eligibility.ts";
import {
  computeAccountRulesBanner,
} from "../app/rules/_components/account-rules-form-logic.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a Date in a given IANA timezone at the specified local clock time.
 * Uses two-pass Intl trick (same as fromTzParts in trading-day.ts).
 */
function tzDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
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
  const parts = fmt.formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const tzAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offset1 = Math.round((tzAsUtcMs - guess.getTime()) / 60_000);
  const adjusted = new Date(guess.getTime() - offset1 * 60_000);

  const parts2 = fmt.formatToParts(adjusted);
  const get2 = (type: string) => Number(parts2.find((p) => p.type === type)?.value ?? "0");
  const tzAsUtcMs2 = Date.UTC(get2("year"), get2("month") - 1, get2("day"), get2("hour") % 24, get2("minute"), get2("second"));
  const offset2 = Math.round((tzAsUtcMs2 - adjusted.getTime()) / 60_000);
  if (offset2 === offset1) return adjusted;
  return new Date(guess.getTime() - offset2 * 60_000);
}

// ── No session configured ─────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — no session configured", () => {
  it("allows editing when no session hours are set", () => {
    const result = deriveRuleEditEligibility({
      now: new Date("2026-05-06T10:00:00Z"),
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "no_session_configured");
    assert.equal(result.nextAllowedAt, null);
  });
});

// ── State-based blocks (override time window) ─────────────────────────────────

describe("deriveRuleEditEligibility — state-based blocks", () => {
  const outsideSession = tzDate(2026, 5, 6, 6, 0, "America/New_York");

  it("blocks when account is stopped", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
      isAccountStopped: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "account_stopped");
  });

  it("blocks when rule breach today", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
      hasRuleBreachToday: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "rule_breach_today");
  });

  it("blocks when open position", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
      hasOpenPosition: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "open_position");
  });

  it("account_stopped takes priority over time-based locks", () => {
    const inBuffer = tzDate(2026, 5, 6, 8, 45, "America/New_York");
    const result = deriveRuleEditEligibility({
      now: inBuffer,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
      isAccountStopped: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "account_stopped");
  });
});

// ── NY session with minute precision (09:30–16:00 ET) ─────────────────────────
// Buffer = 60 min → lock starts at 08:30 ET

describe("deriveRuleEditEligibility — NY session 09:30–16:00 ET (minute precision)", () => {
  const TZ = "America/New_York";

  it("08:29 ET → allowed (1 minute before buffer start)", () => {
    const now = tzDate(2026, 5, 6, 8, 29, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "can_edit");
  });

  it("08:30 ET → locked (at buffer boundary)", () => {
    const now = tzDate(2026, 5, 6, 8, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("09:29 ET → locked (within buffer, 1 min before session start)", () => {
    const now = tzDate(2026, 5, 6, 9, 29, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("09:30 ET → locked (at session start, within_session)", () => {
    const now = tzDate(2026, 5, 6, 9, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("15:59 ET → locked (1 min before session end)", () => {
    const now = tzDate(2026, 5, 6, 15, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("16:00 ET → allowed (at session end)", () => {
    const now = tzDate(2026, 5, 6, 16, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "can_edit");
  });

  it("nextAllowedAt equals 16:00 ET on the session day", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.ok(result.nextAllowedAt !== null);
    const expectedEnd = tzDate(2026, 5, 6, 16, 0, TZ);
    assert.equal(result.nextAllowedAt!.getTime(), expectedEnd.getTime());
  });

  it("lockStartsAt equals 08:30 ET", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.ok(result.lockStartsAt !== null);
    const expectedLockStart = tzDate(2026, 5, 6, 8, 30, TZ);
    assert.equal(result.lockStartsAt!.getTime(), expectedLockStart.getTime());
  });
});

// ── NY session with legacy integer hours (09:00–16:00) ───────────────────────
// Existing tests migrated to keep backward compat verified

describe("deriveRuleEditEligibility — NY session legacy integer hours (backward compat)", () => {
  const TZ = "America/New_York";
  const BUFFER = DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES;

  it("07:59 NY → allowed (outside 60-min buffer before 09:00)", () => {
    const now = tzDate(2026, 5, 6, 7, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "can_edit");
  });

  it("08:00 NY → locked (exactly at buffer boundary with 60-min buffer)", () => {
    const now = tzDate(2026, 5, 6, 8, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("08:30 NY → locked (within buffer)", () => {
    const now = tzDate(2026, 5, 6, 8, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("09:30 NY → locked (within session)", () => {
    const now = tzDate(2026, 5, 6, 9, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("16:01 NY → allowed (session just ended)", () => {
    const now = tzDate(2026, 5, 6, 16, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "can_edit");
  });

  it("within_session sets nextAllowedAt to session end (16:00 ET)", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.ok(result.nextAllowedAt !== null, "nextAllowedAt should be set");
    const expectedEnd = tzDate(2026, 5, 6, 16, 0, TZ);
    assert.equal(result.nextAllowedAt!.getTime(), expectedEnd.getTime());
  });

  it("integer-hour rules produce the same result as equivalent HH:mm strings", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const withHours = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    const withTimes = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(withHours.canEditNow, withTimes.canEditNow);
    assert.equal(withHours.reason, withTimes.reason);
    assert.equal(withHours.nextAllowedAt?.getTime(), withTimes.nextAllowedAt?.getTime());
  });
});

// ── London session (Europe/London, 08:00–12:00) ───────────────────────────────

describe("deriveRuleEditEligibility — London session 08:00–12:00", () => {
  const TZ = "Europe/London";

  it("06:59 London → allowed (before buffer)", () => {
    const now = tzDate(2026, 5, 6, 6, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("07:00 London → locked (at buffer boundary, 60 min before 08:00)", () => {
    const now = tzDate(2026, 5, 6, 7, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("07:01 London → locked (within buffer)", () => {
    const now = tzDate(2026, 5, 6, 7, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("10:00 London → locked (within session)", () => {
    const now = tzDate(2026, 5, 6, 10, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("11:59 London → locked (1 min before end)", () => {
    const now = tzDate(2026, 5, 6, 11, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("12:00 London → allowed (session ended)", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── Asia session (Asia/Tokyo, 09:00–12:00) ────────────────────────────────────

describe("deriveRuleEditEligibility — Asia session 09:00–12:00 Tokyo", () => {
  const TZ = "Asia/Tokyo";

  it("07:59 Tokyo → allowed (outside 60-min buffer)", () => {
    const now = tzDate(2026, 5, 6, 7, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("08:00 Tokyo → locked (at buffer boundary)", () => {
    const now = tzDate(2026, 5, 6, 8, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("08:01 Tokyo → locked (within buffer)", () => {
    const now = tzDate(2026, 5, 6, 8, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("11:59 Tokyo → locked (within session)", () => {
    const now = tzDate(2026, 5, 6, 11, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("12:00 Tokyo → allowed (session ended)", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("12:01 Tokyo → allowed", () => {
    const now = tzDate(2026, 5, 6, 12, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── Custom cross-midnight session 22:00–02:00 ─────────────────────────────────

describe("deriveRuleEditEligibility — custom 22:00–02:00 cross-midnight (UTC)", () => {
  const TZ = "UTC";

  it("20:59 → allowed (before buffer)", () => {
    const now = new Date("2026-05-06T20:59:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("21:00 → locked (at buffer boundary, 60 min before 22:00)", () => {
    const now = new Date("2026-05-06T21:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("21:01 → locked (within buffer)", () => {
    const now = new Date("2026-05-06T21:01:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("23:00 → locked (within session, after session start)", () => {
    const now = new Date("2026-05-06T23:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("03:00 next day → locked (after midnight, within session until 02:00)", () => {
    const now = new Date("2026-05-07T01:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("02:00 next day → allowed (session ended)", () => {
    const now = new Date("2026-05-07T02:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("nextAllowedAt for cross-midnight is 02:00 the next day", () => {
    const now = new Date("2026-05-06T23:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "22:00",
      sessionEndTime: "02:00",
      sessionTimezone: TZ,
    });
    assert.ok(result.nextAllowedAt !== null);
    assert.equal(result.nextAllowedAt!.toISOString(), "2026-05-07T02:00:00.000Z");
  });
});

// ── Legacy cross-midnight (integer hours) ─────────────────────────────────────

describe("deriveRuleEditEligibility — midnight-crossing session (legacy integer hours)", () => {
  const TZ = "UTC";

  it("20:59 → allowed (before buffer)", () => {
    const now = new Date("2026-05-06T20:59:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 22,
      sessionEndHour: 6,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("21:01 → locked (within buffer)", () => {
    const now = new Date("2026-05-06T21:01:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 22,
      sessionEndHour: 6,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("23:00 → locked (within session, after midnight crossing start)", () => {
    const now = new Date("2026-05-06T23:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 22,
      sessionEndHour: 6,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("03:00 → locked (after midnight, still within session)", () => {
    const now = new Date("2026-05-07T03:00:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 22,
      sessionEndHour: 6,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("06:01 → allowed (session ended)", () => {
    const now = new Date("2026-05-07T06:01:00Z");
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 22,
      sessionEndHour: 6,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── Custom lock buffer ────────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — custom lock buffer", () => {
  it("respects a 30-minute buffer (minute-precise start)", () => {
    const TZ = "America/New_York";
    const inBuffer = tzDate(2026, 5, 6, 9, 5, TZ);
    const result = deriveRuleEditEligibility({
      now: inBuffer,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
      lockBufferMinutes: 30,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("allows editing 31 minutes before session with 30-minute buffer", () => {
    const TZ = "America/New_York";
    const outsideBuffer = tzDate(2026, 5, 6, 8, 59, TZ);
    const result = deriveRuleEditEligibility({
      now: outsideBuffer,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
      lockBufferMinutes: 30,
    });
    assert.equal(result.canEditNow, true);
  });

  it("zero buffer: only blocks during active session", () => {
    const TZ = "America/New_York";
    const justBeforeSession = tzDate(2026, 5, 6, 9, 29, TZ);
    const result = deriveRuleEditEligibility({
      now: justBeforeSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
      lockBufferMinutes: 0,
    });
    assert.equal(result.canEditNow, true);
  });

  it("zero buffer: blocks at session start", () => {
    const TZ = "America/New_York";
    const atSession = tzDate(2026, 5, 6, 9, 30, TZ);
    const result = deriveRuleEditEligibility({
      now: atSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
      lockBufferMinutes: 0,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("respects a 30-minute buffer (legacy integer hours)", () => {
    const TZ = "America/New_York";
    const inBuffer = tzDate(2026, 5, 6, 8, 35, TZ);
    const result = deriveRuleEditEligibility({
      now: inBuffer,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
      lockBufferMinutes: 30,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("allows editing 31 minutes before session with 30-minute buffer (legacy)", () => {
    const TZ = "America/New_York";
    const outsideBuffer = tzDate(2026, 5, 6, 8, 29, TZ);
    const result = deriveRuleEditEligibility({
      now: outsideBuffer,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
      lockBufferMinutes: 30,
    });
    assert.equal(result.canEditNow, true);
  });

  it("zero buffer: only blocks during active session (legacy)", () => {
    const TZ = "America/New_York";
    const justBeforeSession = tzDate(2026, 5, 6, 8, 59, TZ);
    const result = deriveRuleEditEligibility({
      now: justBeforeSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
      lockBufferMinutes: 0,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── DST safety — New York ─────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — DST New York spring-forward 2026-03-08", () => {
  const TZ = "America/New_York";
  // US DST spring forward: 2026-03-08, clocks jump 02:00 → 03:00

  it("08:30 ET on spring-forward day → locked (buffer for 09:30 session)", () => {
    const now = tzDate(2026, 3, 8, 8, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("16:00 ET on spring-forward day → allowed (session ended)", () => {
    const now = tzDate(2026, 3, 8, 16, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

describe("deriveRuleEditEligibility — DST New York fall-back 2026-11-01", () => {
  const TZ = "America/New_York";
  // US DST fall back: 2026-11-01, clocks fall 02:00 → 01:00

  it("08:29 ET on fall-back day → allowed (before buffer)", () => {
    const now = tzDate(2026, 11, 1, 8, 29, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "can_edit");
  });

  it("08:30 ET on fall-back day → locked (at buffer boundary)", () => {
    const now = tzDate(2026, 11, 1, 8, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("09:30 ET on fall-back day → locked (session started at wall-clock 09:30)", () => {
    const now = tzDate(2026, 11, 1, 9, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });
});

// ── DST safety — London ───────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — DST London spring-forward 2026-03-29", () => {
  const TZ = "Europe/London";
  // UK DST spring forward: 2026-03-29 at 01:00 UTC → clocks jump to 02:00 BST

  it("06:59 BST on spring-forward day → allowed", () => {
    const now = tzDate(2026, 3, 29, 6, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("07:00 BST on spring-forward day → locked (buffer boundary)", () => {
    const now = tzDate(2026, 3, 29, 7, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("12:00 BST on spring-forward day → allowed (session ended)", () => {
    const now = tzDate(2026, 3, 29, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

describe("deriveRuleEditEligibility — DST London fall-back 2026-10-25", () => {
  const TZ = "Europe/London";
  // UK DST fall back: 2026-10-25 at 02:00 BST → clocks fall back to 01:00 GMT

  it("06:59 GMT on fall-back day → allowed", () => {
    const now = tzDate(2026, 10, 25, 6, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("07:00 GMT on fall-back day → locked (buffer boundary)", () => {
    const now = tzDate(2026, 10, 25, 7, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("12:00 GMT on fall-back day → allowed", () => {
    const now = tzDate(2026, 10, 25, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartTime: "08:00",
      sessionEndTime: "12:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── Israel local time display alongside session timezone ──────────────────────

describe("buildRuleEditLockMessage — Israel local display", () => {
  const TZ = "America/New_York";
  const USER_TZ = "Asia/Jerusalem";

  it("within_session shows next edit window in both ET and Israel time", () => {
    // NY session, 16:00 ET = 23:00 Israel time (UTC+3 in summer)
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const eligibility = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    const msg = buildRuleEditLockMessage(eligibility, TZ, USER_TZ);
    // Message should contain both "ET" and "Israel time"
    assert.ok(msg.includes("ET"), `Expected 'ET' in: ${msg}`);
    assert.ok(msg.includes("Israel time"), `Expected 'Israel time' in: ${msg}`);
    assert.ok(msg.includes("4:00 PM"), `Expected '4:00 PM' in: ${msg}`);
  });

  it("same timezone: shows single time (no duplication)", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const eligibility = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    const msg = buildRuleEditLockMessage(eligibility, TZ, TZ);
    // Single timezone, no "/" separator
    const slashCount = (msg.match(/\//g) ?? []).length;
    assert.equal(slashCount, 0, `Expected no '/' but got: ${msg}`);
  });

  it("within_buffer message says locked during active trading session", () => {
    const now = tzDate(2026, 5, 6, 8, 45, TZ);
    const eligibility = deriveRuleEditEligibility({
      now,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    const msg = buildRuleEditLockMessage(eligibility, TZ, USER_TZ);
    assert.ok(
      msg.toLowerCase().includes("locked during"),
      `Expected 'locked during' in: ${msg}`,
    );
  });
});

// ── Backward compat: old integer-hour rules ───────────────────────────────────

describe("deriveRuleEditEligibility — old integer-hour rules (backward compat)", () => {
  it("integer hours still produce correct lock when both sessionStartTime and sessionEndTime absent", () => {
    const TZ = "America/New_York";
    const inSession = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now: inSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("sessionStartTime overrides sessionStartHour when both are provided", () => {
    const TZ = "America/New_York";
    // 09:15 ET: would be within session for integer 09:00 start but in buffer for 09:30 start
    const at0915 = tzDate(2026, 5, 6, 9, 15, TZ);
    const withHour = deriveRuleEditEligibility({
      now: at0915,
      sessionStartHour: 9,      // 09:00 → at 09:15 we'd be within_session
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    const withTime = deriveRuleEditEligibility({
      now: at0915,
      sessionStartHour: 9,
      sessionStartTime: "09:30", // 09:30 → at 09:15 we'd still be within_buffer
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(withHour.reason, "within_session");
    assert.equal(withTime.reason, "within_buffer");
  });

  it("no session configured (null hours, null times) → can_edit", () => {
    const result = deriveRuleEditEligibility({
      now: new Date("2026-05-06T12:00:00Z"),
      sessionStartHour: null,
      sessionEndHour: null,
      sessionStartTime: null,
      sessionEndTime: null,
    });
    assert.equal(result.canEditNow, true);
    assert.equal(result.reason, "no_session_configured");
  });
});

// ── No server-local timezone dependency ───────────────────────────────────────

describe("deriveRuleEditEligibility — no server-local timezone dependency", () => {
  it("same result regardless of when test runs (uses explicit now)", () => {
    const nowA = new Date("2026-05-06T12:00:00Z");
    const nowB = new Date("2026-05-06T12:00:00Z");
    const input = {
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
    };
    const a = deriveRuleEditEligibility({ ...input, now: nowA });
    const b = deriveRuleEditEligibility({ ...input, now: nowB });
    assert.equal(a.canEditNow, b.canEditNow);
    assert.equal(a.reason, b.reason);
  });

  it("falls back to CME timezone when sessionTimezone is not provided", () => {
    const nowCME = tzDate(2026, 5, 6, 8, 35, "America/Chicago");
    const result = deriveRuleEditEligibility({
      now: nowCME,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      // No sessionTimezone → defaults to CME (America/Chicago)
    });
    // 08:35 CME, buffer for 09:30 CME session (lock at 08:30) → within_buffer
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });
});

// ── Remove account-specific rules feedback ────────────────────────────────────

describe("computeAccountRulesBanner — remove account-specific rules feedback", () => {
  it("returns no banner when form is not shown", () => {
    const banner = computeAccountRulesBanner(true, false, false, null);
    assert.equal(banner.kind, "none");
  });

  it("returns no banner when unlocked with existing rules", () => {
    const banner = computeAccountRulesBanner(true, false, true, null);
    assert.equal(banner.kind, "none");
  });

  it("returns locked banner with lock message when locked and has existing rules", () => {
    const lockMsg = "Rule changes are locked during your active trading session. Next edit window: 4:00 PM ET.";
    const banner = computeAccountRulesBanner(true, true, true, lockMsg);
    assert.equal(banner.kind, "locked");
    assert.equal(banner.kind === "locked" && banner.message, lockMsg);
  });

  it("locked banner falls back to default copy when no lockMessage provided", () => {
    const banner = computeAccountRulesBanner(true, true, true, null);
    assert.equal(banner.kind, "locked");
    assert.ok(
      banner.kind === "locked" && banner.message.includes("locked"),
      `Expected 'locked' in: ${banner.kind === "locked" ? banner.message : ""}`,
    );
  });

  it("first-time setup bypasses lock and shows first-time banner", () => {
    const banner = computeAccountRulesBanner(false, true, true, "locked message");
    assert.equal(banner.kind, "first_time");
  });
});

// ── Removal while locked returns structured result ────────────────────────────

describe("deriveRuleEditEligibility — removal while locked returns structured result", () => {
  it("locking reason is non-null and canEditNow is false during session", () => {
    const TZ = "America/New_York";
    const midSession = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now: midSession,
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.ok(result.reason !== "can_edit" && result.reason !== "no_session_configured");
    assert.ok(result.nextAllowedAt !== null, "nextAllowedAt should be set for time-based lock");
    assert.ok(result.lockStartsAt !== null, "lockStartsAt should be set for time-based lock");
  });
});
