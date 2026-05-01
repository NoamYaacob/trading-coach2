import test from "node:test";
import assert from "node:assert/strict";

import { getLocalCalendarDayWindow, getTradingDayWindow } from "./trading-day.ts";

// All "now" values are written in UTC for clarity. Comments describe the
// equivalent local time in the relevant timezone.

test("default timezone is Asia/Jerusalem when none provided", () => {
  const w = getTradingDayWindow({ now: new Date("2026-04-26T10:00:00Z") });
  assert.equal(w.timezone, "Asia/Jerusalem");
  assert.equal(w.hasSessionHours, false);
  assert.equal(w.isOvernight, false);
});

test("invalid timezone falls back to Asia/Jerusalem", () => {
  const w = getTradingDayWindow({
    timezone: "Not/A_Real_Timezone",
    now: new Date("2026-04-26T10:00:00Z"),
  });
  assert.equal(w.timezone, "Asia/Jerusalem");
});

test("no session hours: calendar day window in user's tz", () => {
  // Asia/Jerusalem is UTC+3 in late April (IDT).
  // 10:00 UTC = 13:00 local on 2026-04-26.
  const w = getTradingDayWindow({
    timezone: "Asia/Jerusalem",
    now: new Date("2026-04-26T10:00:00Z"),
  });
  // Window start: 2026-04-26 00:00 local = 2026-04-25 21:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-25T21:00:00.000Z");
  // Window end: 24 hours later = 2026-04-26 21:00 UTC
  assert.equal(w.end.toISOString(), "2026-04-26T21:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, true);
});

test("no session hours: NY user near midnight", () => {
  // 2026-04-27 03:00 UTC = 2026-04-26 23:00 NY (UTC-4 in EDT).
  // Calendar day "today" in NY is still 2026-04-26.
  const w = getTradingDayWindow({
    timezone: "America/New_York",
    now: new Date("2026-04-27T03:00:00Z"),
  });
  // Window start: 2026-04-26 00:00 NY = 2026-04-26 04:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-26T04:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-27T04:00:00.000Z");
});

test("same-day session: now inside the session window", () => {
  // NY equity session 9-16 local. now = 14:00 NY = 18:00 UTC.
  const w = getTradingDayWindow({
    timezone: "America/New_York",
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-04-27T18:00:00Z"),
  });
  // Window: 2026-04-27 09:00 NY = 13:00 UTC -> 2026-04-27 16:00 NY = 20:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-27T13:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-27T20:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, true);
  assert.equal(w.isOvernight, false);
});

test("same-day session: now before session start uses yesterday's window", () => {
  // now = 08:00 NY = 12:00 UTC. Session is 9-16 local.
  const w = getTradingDayWindow({
    timezone: "America/New_York",
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-04-27T12:00:00Z"),
  });
  // Yesterday's session: 2026-04-26 09:00 NY = 13:00 UTC -> 2026-04-26 16:00 NY = 20:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-26T13:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-26T20:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, false);
});

test("same-day session: now after session end keeps showing today's session", () => {
  // now = 17:00 NY = 21:00 UTC. Session 9-16 ended at 16:00 NY.
  const w = getTradingDayWindow({
    timezone: "America/New_York",
    sessionStartHour: 9,
    sessionEndHour: 16,
    now: new Date("2026-04-27T21:00:00Z"),
  });
  assert.equal(w.start.toISOString(), "2026-04-27T13:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-27T20:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, false);
});

test("overnight session: now during the session", () => {
  // Session 22-05 local in Asia/Jerusalem (UTC+3 in late April).
  // now = 23:30 local on 2026-04-26 = 20:30 UTC.
  const w = getTradingDayWindow({
    timezone: "Asia/Jerusalem",
    sessionStartHour: 22,
    sessionEndHour: 5,
    now: new Date("2026-04-26T20:30:00Z"),
  });
  // Window start: 2026-04-26 22:00 local = 2026-04-26 19:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-26T19:00:00.000Z");
  // Window end: 7 hours later = 2026-04-27 02:00 UTC = 2026-04-27 05:00 local
  assert.equal(w.end.toISOString(), "2026-04-27T02:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, true);
  assert.equal(w.isOvernight, true);
});

test("overnight session: now after midnight but before session end", () => {
  // Session 22-05 local. now = 03:00 local on 2026-04-27 = 00:00 UTC.
  const w = getTradingDayWindow({
    timezone: "Asia/Jerusalem",
    sessionStartHour: 22,
    sessionEndHour: 5,
    now: new Date("2026-04-27T00:00:00Z"),
  });
  // The active session started yesterday at 22:00 local.
  // 2026-04-26 22:00 local = 2026-04-26 19:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-26T19:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-27T02:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, true);
});

test("overnight session: now in the gap between sessions uses last session", () => {
  // now = 21:00 local on 2026-04-27 = 18:00 UTC (before today's 22:00 start).
  const w = getTradingDayWindow({
    timezone: "Asia/Jerusalem",
    sessionStartHour: 22,
    sessionEndHour: 5,
    now: new Date("2026-04-27T18:00:00Z"),
  });
  // Most recent session = yesterday 22:00 local -> today 05:00 local
  assert.equal(w.start.toISOString(), "2026-04-26T19:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-27T02:00:00.000Z");
  assert.equal(w.isCurrentSessionOpen, false);
});

test("end == start is treated as overnight (24h duration)", () => {
  // Edge case: 24/7 session expressed as 0 -> 0 returns a 24h window.
  const w = getTradingDayWindow({
    timezone: "UTC",
    sessionStartHour: 0,
    sessionEndHour: 0,
    now: new Date("2026-04-27T10:00:00Z"),
  });
  assert.equal(w.isOvernight, true);
  assert.equal(w.end.getTime() - w.start.getTime(), 24 * 60 * 60_000);
});

test("non-finite session hours fall back to calendar-day mode", () => {
  const w = getTradingDayWindow({
    timezone: "America/New_York",
    sessionStartHour: NaN,
    sessionEndHour: 16,
    now: new Date("2026-04-27T18:00:00Z"),
  });
  assert.equal(w.hasSessionHours, false);
  // Calendar day in NY: 2026-04-27 04:00 UTC -> 2026-04-28 04:00 UTC
  assert.equal(w.start.toISOString(), "2026-04-27T04:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-28T04:00:00.000Z");
});

test("label formats start, end, and timezone", () => {
  const w = getTradingDayWindow({
    timezone: "Asia/Jerusalem",
    sessionStartHour: 16,
    sessionEndHour: 23,
    now: new Date("2026-04-26T17:00:00Z"),
  });
  // Session is 16:00-23:00 Asia/Jerusalem on 2026-04-26.
  assert.match(w.label, /Apr 26/);
  assert.match(w.label, /Asia\/Jerusalem/);
});

test("local calendar day includes after-session manual entries", () => {
  // 18:00 UTC = 21:00 local in Asia/Jerusalem. A manual trade logged after a
  // 09:00-16:00 session should still count in today's journal summary.
  const w = getLocalCalendarDayWindow({
    timezone: "Asia/Jerusalem",
    now: new Date("2026-04-29T18:00:00Z"),
  });

  assert.equal(w.start.toISOString(), "2026-04-28T21:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-04-29T21:00:00.000Z");
  assert.equal(w.label, "Apr 29, 2026");
});
