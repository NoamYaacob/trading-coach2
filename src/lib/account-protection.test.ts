import test from "node:test";
import assert from "node:assert/strict";

import {
  canChangeProtection,
  dateKeyInTimezone,
  deriveRuleSource,
  getProtectionLockState,
  isProtectionIncrease,
} from "./account-protection.ts";

// ─── dateKeyInTimezone ────────────────────────────────────────────────────

test("dateKeyInTimezone: UTC", () => {
  // 2026-05-04 23:30 UTC is still 2026-05-04 in UTC.
  assert.equal(dateKeyInTimezone(new Date("2026-05-04T23:30:00Z"), "UTC"), "2026-05-04");
});

test("dateKeyInTimezone: NY (UTC-4 in May)", () => {
  // 2026-05-05 03:00 UTC = 2026-05-04 23:00 NY → still May 4 in NY.
  assert.equal(
    dateKeyInTimezone(new Date("2026-05-05T03:00:00Z"), "America/New_York"),
    "2026-05-04",
  );
});

// ─── getProtectionLockState ───────────────────────────────────────────────

test("no session hours: lock is disabled", () => {
  const lock = getProtectionLockState({
    timezone: "UTC",
    sessionStartHour: null,
    sessionEndHour: null,
    now: new Date("2026-05-04T15:00:00Z"),
  });
  assert.equal(lock.hasSessionHours, false);
  assert.equal(lock.isLocked, false);
  assert.equal(lock.cutoffTime, null);
});

test("before cutoff: not locked", () => {
  // Session 9-16 CME. May 4 2026 (CDT = UTC-5).
  // 9:00 CME CDT = 14:00 UTC. Cutoff = 08:55 CME = 13:55 UTC.
  // Now = 08:00 CME = 13:00 UTC → before cutoff.
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 5,
    now: new Date("2026-05-04T13:00:00Z"),
  });
  assert.equal(lock.hasSessionHours, true);
  assert.equal(lock.isLocked, false);
  assert.ok(lock.cutoffTime instanceof Date);
  assert.equal(lock.cutoffTime!.toISOString(), "2026-05-04T13:55:00.000Z");
  assert.equal(lock.timezone, "America/Chicago");
});

test("after cutoff, inside session: locked", () => {
  // Now = 09:30 CME CDT = 14:30 UTC. Past cutoff (13:55 UTC), inside session (until 21:00 UTC).
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 5,
    now: new Date("2026-05-04T14:30:00Z"),
  });
  assert.equal(lock.isLocked, true);
  assert.equal(lock.tradingDayKey, "2026-05-04");
  assert.equal(lock.nextTradingDayKey, "2026-05-05");
});

test("after session end: unlocked, configuring next day", () => {
  // Session 9-16 CME CDT: ends at 16:00 CME = 21:00 UTC.
  // Now = 17:00 CME = 22:00 UTC → session has ended.
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 5,
    now: new Date("2026-05-04T22:00:00Z"),
  });
  assert.equal(lock.isLocked, false);
  // Now configuring the next session — May 5.
  assert.equal(lock.tradingDayKey, "2026-05-05");
});

test("custom cutoff minutes (0): cutoff = session start", () => {
  // Cutoff = 0 → locked exactly at session start (9:00 CME CDT = 14:00 UTC).
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 0,
    now: new Date("2026-05-04T14:00:00Z"),
  });
  assert.equal(lock.isLocked, true);
});

test("custom cutoff minutes (15): wider cutoff window", () => {
  // Session 9-16 CME CDT. Cutoff = 15 min → 08:45 CME = 13:45 UTC.
  // Now = 08:50 CME = 13:50 UTC → already locked.
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 15,
    now: new Date("2026-05-04T13:50:00Z"),
  });
  assert.equal(lock.isLocked, true);
  assert.equal(lock.cutoffTime!.toISOString(), "2026-05-04T13:45:00.000Z");
});

// ─── isProtectionIncrease ─────────────────────────────────────────────────

test("monitor_only → protected is an increase", () => {
  assert.equal(isProtectionIncrease("monitor_only", "protected"), true);
});

test("protected → monitor_only is NOT an increase", () => {
  assert.equal(isProtectionIncrease("protected", "monitor_only"), false);
});

test("protected → ignored is NOT an increase", () => {
  assert.equal(isProtectionIncrease("protected", "ignored"), false);
});

test("ignored → protected is an increase", () => {
  assert.equal(isProtectionIncrease("ignored", "protected"), true);
});

test("pending_decision → anything is allowed", () => {
  assert.equal(isProtectionIncrease("pending_decision", "protected"), true);
  assert.equal(isProtectionIncrease("pending_decision", "monitor_only"), true);
  assert.equal(isProtectionIncrease("pending_decision", "ignored"), true);
});

// ─── canChangeProtection ──────────────────────────────────────────────────

test("not locked: any change allowed for today", () => {
  // 08:00 CME CDT = 13:00 UTC — before cutoff (13:55 UTC).
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-05-04T13:00:00Z"),
  });
  const r = canChangeProtection("protected", "ignored", lock);
  assert.equal(r.allowed, true);
  assert.equal(r.appliesOnTradingDay, lock.tradingDayKey);
});

test("locked: protected → monitor_only blocked, applies next day", () => {
  // 09:30 CME CDT = 14:30 UTC — inside session.
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-05-04T14:30:00Z"),
  });
  assert.equal(lock.isLocked, true);
  const r = canChangeProtection("protected", "monitor_only", lock);
  assert.equal(r.allowed, false);
  assert.equal(r.appliesOnTradingDay, "2026-05-05");
});

test("locked: increasing protection still allowed today", () => {
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-05-04T14:30:00Z"),
  });
  const r = canChangeProtection("monitor_only", "protected", lock);
  assert.equal(r.allowed, true);
});

test("locked: pending_decision can be promoted to protected today", () => {
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-05-04T14:30:00Z"),
  });
  const r = canChangeProtection("pending_decision", "protected", lock);
  assert.equal(r.allowed, true);
});

// ─── deriveRuleSource ─────────────────────────────────────────────────────

test("monitor_only protection → monitor_only rule source", () => {
  assert.equal(
    deriveRuleSource({
      protectionStatus: "monitor_only",
      hasAccountRules: true,
      hasDefaultRules: true,
    }),
    "monitor_only",
  );
});

test("protected with account rules → account_specific", () => {
  assert.equal(
    deriveRuleSource({
      protectionStatus: "protected",
      hasAccountRules: true,
      hasDefaultRules: false,
    }),
    "account_specific",
  );
});

test("protected with only default rules → default_trading_plan", () => {
  assert.equal(
    deriveRuleSource({
      protectionStatus: "protected",
      hasAccountRules: false,
      hasDefaultRules: true,
    }),
    "default_trading_plan",
  );
});

test("protected without any rules → none", () => {
  assert.equal(
    deriveRuleSource({
      protectionStatus: "protected",
      hasAccountRules: false,
      hasDefaultRules: false,
    }),
    "none",
  );
});

test("ignored protection → none regardless of rules", () => {
  assert.equal(
    deriveRuleSource({
      protectionStatus: "ignored",
      hasAccountRules: true,
      hasDefaultRules: true,
    }),
    "none",
  );
});

// ─── CME timezone anchoring ───────────────────────────────────────────────

test("CME anchoring: not locked 5 min before CME session start during US/Israel DST mismatch", () => {
  // March 15 2026: US switched to CDT (UTC-5) on Mar 8; Israel still on IST (UTC+2) until ~Mar 29.
  // Session 9–16 stored as CME hours. Cutoff = 08:55 CME CDT = 13:55 UTC.
  // Now = 13:50 UTC = 08:50 CME CDT → 5 min before cutoff → NOT locked.
  // If hours were interpreted as Israel local time instead, cutoff = 08:55 IST = 06:55 UTC —
  // and 13:50 UTC would appear to be well past that cutoff (wrongly locked).
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 5,
    now: new Date("2026-03-15T13:50:00Z"),
  });
  assert.equal(lock.timezone, "America/Chicago");
  assert.equal(lock.isLocked, false);
  assert.equal(lock.cutoffTime!.toISOString(), "2026-03-15T13:55:00.000Z");
});

test("account-specific protection changes obey the same CME lock semantics", () => {
  // Inside session on May 4 2026 (CDT): locked.
  const lock = getProtectionLockState({
    sessionStartHour: 9,
    sessionEndHour: 16,
    cutoffMinutes: 5,
    now: new Date("2026-05-04T14:30:00Z"),
  });
  assert.equal(lock.isLocked, true);
  assert.equal(lock.timezone, "America/Chicago");
  // Decreasing protection blocked for today, deferred to next day.
  const decrease = canChangeProtection("protected", "monitor_only", lock);
  assert.equal(decrease.allowed, false);
  assert.equal(decrease.appliesOnTradingDay, "2026-05-05");
  // Increasing protection is always allowed immediately.
  const increase = canChangeProtection("monitor_only", "protected", lock);
  assert.equal(increase.allowed, true);
});
