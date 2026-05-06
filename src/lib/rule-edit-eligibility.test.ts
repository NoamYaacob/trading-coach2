import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRuleEditEligibility,
  DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES,
} from "./rule-edit-eligibility.ts";

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
  // Use a time that is outside any session so time isn't the blocker.
  const outsideSession = tzDate(2026, 5, 6, 6, 0, "America/New_York");

  it("blocks when account is stopped", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: "America/New_York",
      isAccountStopped: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "account_stopped");
  });

  it("blocks when rule breach today", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: "America/New_York",
      hasRuleBreachToday: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "rule_breach_today");
  });

  it("blocks when open position", () => {
    const result = deriveRuleEditEligibility({
      now: outsideSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: "America/New_York",
      hasOpenPosition: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "open_position");
  });

  it("account_stopped takes priority over time-based locks", () => {
    // 08:45 ET is inside the 60-min buffer before the 09:00 session start
    const inBuffer = tzDate(2026, 5, 6, 8, 45, "America/New_York");
    const result = deriveRuleEditEligibility({
      now: inBuffer,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: "America/New_York",
      isAccountStopped: true,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "account_stopped");
  });
});

// ── NY session (America/New_York, 09:00–16:00) ────────────────────────────────

describe("deriveRuleEditEligibility — NY session", () => {
  const TZ = "America/New_York";
  const BUFFER = DEFAULT_RULE_EDIT_LOCK_BUFFER_MINUTES;

  // Session stored as integer hours: sessionStartHour=9 means 09:00 ET.
  // With 60-min buffer: lock starts at 08:00 ET.
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

  it("08:00 NY → locked (exactly at buffer boundary)", () => {
    // With 60-min buffer: buffer starts at 09:00 - 60min = 08:00
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

  it("12:00 NY → locked (mid-session)", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
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

  it("within_session sets nextAllowedAt to session end", () => {
    const now = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.ok(result.nextAllowedAt !== null, "nextAllowedAt should be set");
    // nextAllowedAt should be at 16:00 ET
    const expectedEnd = tzDate(2026, 5, 6, 16, 0, TZ);
    assert.equal(result.nextAllowedAt!.getTime(), expectedEnd.getTime());
  });
});

// ── London session (Europe/London, 08:00–12:00) ───────────────────────────────

describe("deriveRuleEditEligibility — London session", () => {
  const TZ = "Europe/London";

  it("06:59 London → allowed", () => {
    const now = tzDate(2026, 5, 6, 6, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 8,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("07:01 London → locked (within 60-min buffer before 08:00)", () => {
    const now = tzDate(2026, 5, 6, 7, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 8,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  it("10:00 London → locked (within session)", () => {
    const now = tzDate(2026, 5, 6, 10, 0, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 8,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_session");
  });

  it("12:01 London → allowed (session ended)", () => {
    const now = tzDate(2026, 5, 6, 12, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 8,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── Asia session (Asia/Tokyo, 09:00–12:00) ────────────────────────────────────

describe("deriveRuleEditEligibility — Asia session", () => {
  const TZ = "Asia/Tokyo";

  it("07:59 Tokyo → allowed (outside buffer)", () => {
    const now = tzDate(2026, 5, 6, 7, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });

  it("08:01 Tokyo → locked (within buffer)", () => {
    const now = tzDate(2026, 5, 6, 8, 1, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
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

// ── Midnight-crossing session ─────────────────────────────────────────────────

describe("deriveRuleEditEligibility — midnight-crossing session", () => {
  // Session: 22:00–06:00 UTC (overnight, e.g. futures session)
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
  it("respects a 30-minute buffer", () => {
    // Session 09:00–16:00 ET, buffer 30 min → buffer starts at 08:30
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

  it("allows editing 31 minutes before session with 30-minute buffer", () => {
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

  it("zero buffer: only blocks during active session", () => {
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

// ── DST safety ────────────────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — DST-safe dates", () => {
  // US DST spring forward: 2026-03-08 at 02:00 ET → clocks jump to 03:00
  it("NY session around US DST spring-forward: buffer still correct", () => {
    const TZ = "America/New_York";
    // 08:30 ET on DST day — in buffer for 09:00 session
    const now = tzDate(2026, 3, 8, 8, 30, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });

  // UK DST spring forward: 2026-03-29 at 01:00 UTC → 02:00 BST
  it("London session around UK DST spring-forward: 06:59 BST → allowed", () => {
    const TZ = "Europe/London";
    const now = tzDate(2026, 3, 29, 6, 59, TZ);
    const result = deriveRuleEditEligibility({
      now,
      sessionStartHour: 8,
      sessionEndHour: 12,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, true);
  });
});

// ── No server-local timezone dependency ───────────────────────────────────────

describe("deriveRuleEditEligibility — no server-local timezone dependency", () => {
  it("same result regardless of when test runs (uses explicit now)", () => {
    // Deterministic: all inputs are explicitly supplied
    const nowA = new Date("2026-05-06T12:00:00Z");
    const nowB = new Date("2026-05-06T12:00:00Z");
    const input = {
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: "America/New_York",
    };
    const a = deriveRuleEditEligibility({ ...input, now: nowA });
    const b = deriveRuleEditEligibility({ ...input, now: nowB });
    assert.equal(a.canEditNow, b.canEditNow);
    assert.equal(a.reason, b.reason);
  });

  it("falls back to CME timezone when sessionTimezone is not provided", () => {
    // Session 09:00–16:00 CME (America/Chicago). At 08:05 CME we're in buffer.
    const nowCME = tzDate(2026, 5, 6, 8, 5, "America/Chicago");
    const result = deriveRuleEditEligibility({
      now: nowCME,
      sessionStartHour: 9,
      sessionEndHour: 16,
      // No sessionTimezone → defaults to CME
    });
    assert.equal(result.canEditNow, false);
    assert.equal(result.reason, "within_buffer");
  });
});

// ── Removal while locked ──────────────────────────────────────────────────────

describe("deriveRuleEditEligibility — removal while locked returns structured result", () => {
  it("locking reason is non-null and canEditNow is false during session", () => {
    const TZ = "America/New_York";
    const midSession = tzDate(2026, 5, 6, 12, 0, TZ);
    const result = deriveRuleEditEligibility({
      now: midSession,
      sessionStartHour: 9,
      sessionEndHour: 16,
      sessionTimezone: TZ,
    });
    assert.equal(result.canEditNow, false);
    assert.ok(result.reason !== "can_edit" && result.reason !== "no_session_configured");
    assert.ok(result.nextAllowedAt !== null, "nextAllowedAt should be set for time-based lock");
  });
});
