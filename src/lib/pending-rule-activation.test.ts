import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CME_SESSION_START_HOUR,
  formatPendingRuleActivation,
  getNextTradingDayStartInstant,
} from "./pending-rule-activation.ts";

// ── getNextTradingDayStartInstant ─────────────────────────────────────────────

describe("getNextTradingDayStartInstant", () => {
  it("CME default (17:00 CT) on a CDT date — returns the right UTC instant", () => {
    // 2026-05-07 17:00 America/Chicago is May 7 22:00 UTC during CDT (UTC-5).
    const at = getNextTradingDayStartInstant({
      dateKey: "2026-05-07",
      sessionStartHour: null,
    });
    assert.equal(at.toISOString(), "2026-05-07T22:00:00.000Z");
  });

  it("Custom session start hour is honoured (in CT, not user-local)", () => {
    // 09:00 America/Chicago on 2026-05-07 is 14:00 UTC during CDT.
    const at = getNextTradingDayStartInstant({
      dateKey: "2026-05-07",
      sessionStartHour: 9,
    });
    assert.equal(at.toISOString(), "2026-05-07T14:00:00.000Z");
  });

  it("Handles a CST (winter) date correctly", () => {
    // 2026-01-15 17:00 America/Chicago is Jan 15 23:00 UTC during CST (UTC-6).
    const at = getNextTradingDayStartInstant({
      dateKey: "2026-01-15",
      sessionStartHour: null,
    });
    assert.equal(at.toISOString(), "2026-01-15T23:00:00.000Z");
  });

  it("Out-of-range hours are clamped (defensive)", () => {
    const at = getNextTradingDayStartInstant({
      dateKey: "2026-05-07",
      sessionStartHour: 30,
    });
    // Clamped to 23:00 CT → 04:00 UTC next day
    assert.equal(at.toISOString(), "2026-05-08T04:00:00.000Z");
  });

  it("Throws on malformed dateKey", () => {
    assert.throws(() =>
      getNextTradingDayStartInstant({ dateKey: "not-a-date", sessionStartHour: null }),
    );
  });

  it("DEFAULT_CME_SESSION_START_HOUR is 17 (CME Globex daily session open)", () => {
    assert.equal(DEFAULT_CME_SESSION_START_HOUR, 17);
  });
});

// ── formatPendingRuleActivation ───────────────────────────────────────────────

describe("formatPendingRuleActivation — CT only (no user tz, or user is CT)", () => {
  it("CME default → 'May 7, 2026, 5:00 PM CT'", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: null,
    });
    assert.equal(text, "May 7, 2026, 5:00 PM CT");
  });

  it("uses America/Chicago tz explicitly — server timezone does not affect output", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: null,
    });
    // The output must always render the CT side, regardless of whether the
    // server runs in UTC, Asia, or anywhere else.
    assert.ok(
      text.includes("CT"),
      `expected ' CT' in output, got: ${text}`,
    );
    assert.ok(text.includes("5:00 PM"));
  });

  it("user timezone equal to America/Chicago → still only shows CT side (no duplication)", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: "America/Chicago",
    });
    assert.equal(text, "May 7, 2026, 5:00 PM CT");
    assert.ok(!text.includes(" / "), `must not duplicate when tz === CT, got: ${text}`);
  });
});

describe("formatPendingRuleActivation — with user timezone", () => {
  it("Asia/Jerusalem during CDT → shows 'Israel time' on the next calendar day", () => {
    // 2026-05-07 17:00 CDT = 2026-05-08 01:00 IDT (UTC+3)
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: "Asia/Jerusalem",
    });
    assert.equal(text, "May 7, 2026, 5:00 PM CT / May 8, 2026, 1:00 AM Israel time");
  });

  it("America/New_York → shows 'New York time' (one hour ahead during CDT)", () => {
    // 2026-05-07 17:00 CDT = 2026-05-07 18:00 EDT
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: "America/New_York",
    });
    assert.equal(text, "May 7, 2026, 5:00 PM CT / May 7, 2026, 6:00 PM New York time");
  });

  it("Unknown timezone falls back to 'local time' instead of leaking the IANA string", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: "America/Phoenix",
    });
    assert.ok(text.includes(" / "));
    assert.ok(
      text.endsWith("local time"),
      `expected fallback 'local time', got: ${text}`,
    );
    assert.ok(
      !text.includes("America/Phoenix"),
      `IANA string must not appear in user-facing copy, got: ${text}`,
    );
  });

  it("Custom session start hour is reflected in BOTH the CT side and the user side", () => {
    // 09:00 America/Chicago on 2026-05-07 = 17:00 Asia/Jerusalem (during DST)
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: 9,
      userTimezone: "Asia/Jerusalem",
    });
    assert.ok(text.includes("9:00 AM CT"));
    assert.ok(text.includes("Israel time"));
  });
});

// ── Regression guards ─────────────────────────────────────────────────────────

describe("formatPendingRuleActivation — regression: never returns date-only / IANA strings", () => {
  it("never returns a bare date like '2026-05-07'", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: null,
    });
    // The old copy was 'apply on 2026-05-07' — the new copy includes wall
    // clock + tz suffix.
    assert.ok(!/^\d{4}-\d{2}-\d{2}$/.test(text.trim()));
    assert.ok(!text.includes("2026-05-07"), `raw date key must not appear, got: ${text}`);
  });

  it("output always contains 'CT' (futures traders read CME wall clock)", () => {
    const variants = [
      { userTimezone: null },
      { userTimezone: "America/Chicago" },
      { userTimezone: "Asia/Jerusalem" },
      { userTimezone: "Europe/London" },
    ];
    for (const v of variants) {
      const text = formatPendingRuleActivation({
        nextTradingDayKey: "2026-05-07",
        sessionStartHour: null,
        ...v,
      });
      assert.ok(
        text.includes(" CT"),
        `expected ' CT' for tz=${v.userTimezone ?? "null"}, got: ${text}`,
      );
    }
  });

  it("output for non-CT user always contains a slash separator", () => {
    const text = formatPendingRuleActivation({
      nextTradingDayKey: "2026-05-07",
      sessionStartHour: null,
      userTimezone: "Asia/Jerusalem",
    });
    assert.ok(text.includes(" / "));
  });
});
