import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCmeHour,
  isValidCmeHour,
  formatCmeHourLabel,
  cmeHourBoundaryNote,
} from "./cme-hour-parsing.ts";

// ─── Integer path ─────────────────────────────────────────────────────────────

test("parseCmeHour: '0' → 0", () => {
  const r = parseCmeHour("0");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 0);
});

test("parseCmeHour: '23' → 23", () => {
  const r = parseCmeHour("23");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 23);
});

test("parseCmeHour: '24' is normalised to 0 (midnight)", () => {
  const r = parseCmeHour("24");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 0);
});

test("parseCmeHour: '16' → 16 (CME daily break boundary)", () => {
  const r = parseCmeHour("16");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 16);
});

test("parseCmeHour: leading whitespace ' 9 ' → 9", () => {
  const r = parseCmeHour(" 9 ");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 9);
});

// ─── AM/PM path — must NEVER produce '2' from '12 pm' ─────────────────────────

test("parseCmeHour: '12am' → 0", () => {
  const r = parseCmeHour("12am");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 0);
});

test("parseCmeHour: '12 am' → 0", () => {
  const r = parseCmeHour("12 am");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 0);
});

test("parseCmeHour: '12:00am' → 0", () => {
  const r = parseCmeHour("12:00am");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 0);
});

test("parseCmeHour: '12pm' → 12 (regression: must NOT be 2)", () => {
  const r = parseCmeHour("12pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 12);
  if (r.ok) assert.notEqual(r.hour, 2, "regression guard: '12pm' must NOT collapse to 2");
});

test("parseCmeHour: '12 pm' → 12 (regression: must NOT be 2)", () => {
  const r = parseCmeHour("12 pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 12);
  if (r.ok) assert.notEqual(r.hour, 2, "regression guard: '12 pm' must NOT collapse to 2");
});

test("parseCmeHour: '12:00pm' → 12", () => {
  const r = parseCmeHour("12:00pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 12);
});

test("parseCmeHour: '1pm' → 13", () => {
  const r = parseCmeHour("1pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 13);
});

test("parseCmeHour: '4pm' → 16", () => {
  const r = parseCmeHour("4pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 16);
});

test("parseCmeHour: '11pm' → 23", () => {
  const r = parseCmeHour("11pm");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 23);
});

test("parseCmeHour: '1am' → 1", () => {
  const r = parseCmeHour("1am");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 1);
});

test("parseCmeHour: '11am' → 11", () => {
  const r = parseCmeHour("11am");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 11);
});

test("parseCmeHour: case-insensitive '1PM' → 13", () => {
  const r = parseCmeHour("1PM");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.hour, 13);
});

// ─── Rejected shapes ──────────────────────────────────────────────────────────

test("parseCmeHour: '123' is rejected", () => {
  const r = parseCmeHour("123");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '25' is rejected", () => {
  const r = parseCmeHour("25");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '-1' is rejected", () => {
  const r = parseCmeHour("-1");
  assert.equal(r.ok, false);
});

test("parseCmeHour: decimal '0.5' is rejected", () => {
  const r = parseCmeHour("0.5");
  assert.equal(r.ok, false);
});

test("parseCmeHour: decimal '12.5pm' is rejected", () => {
  const r = parseCmeHour("12.5pm");
  assert.equal(r.ok, false);
});

test("parseCmeHour: random text is rejected", () => {
  const r = parseCmeHour("foo");
  assert.equal(r.ok, false);
});

test("parseCmeHour: empty string is rejected with 'required' error", () => {
  const r = parseCmeHour("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /required/i);
});

test("parseCmeHour: whitespace-only is rejected", () => {
  const r = parseCmeHour("   ");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '13pm' is rejected (out of 1–12)", () => {
  const r = parseCmeHour("13pm");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '0am' is rejected (ambiguous — use 12am for midnight)", () => {
  const r = parseCmeHour("0am");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '0pm' is rejected (ambiguous)", () => {
  const r = parseCmeHour("0pm");
  assert.equal(r.ok, false);
});

test("parseCmeHour: 'pm' alone is rejected", () => {
  const r = parseCmeHour("pm");
  assert.equal(r.ok, false);
});

test("parseCmeHour: '1 p m' (extra spaces in suffix) is rejected", () => {
  const r = parseCmeHour("1 p m");
  assert.equal(r.ok, false);
});

// ─── isValidCmeHour ───────────────────────────────────────────────────────────

test("isValidCmeHour: 0..23 are valid", () => {
  for (let i = 0; i <= 23; i++) assert.equal(isValidCmeHour(i), true, `expected ${i} valid`);
});

test("isValidCmeHour: -1, 24, 123 are invalid", () => {
  assert.equal(isValidCmeHour(-1), false);
  assert.equal(isValidCmeHour(24), false);
  assert.equal(isValidCmeHour(123), false);
});

test("isValidCmeHour: non-integers are invalid", () => {
  assert.equal(isValidCmeHour(0.5), false);
  assert.equal(isValidCmeHour("12"), false);
  assert.equal(isValidCmeHour(null), false);
  assert.equal(isValidCmeHour(undefined), false);
  assert.equal(isValidCmeHour(NaN), false);
});

// ─── formatCmeHourLabel ───────────────────────────────────────────────────────

test("formatCmeHourLabel: 0 → '12:00 AM CT'", () => {
  assert.equal(formatCmeHourLabel(0), "12:00 AM CT");
});

test("formatCmeHourLabel: 12 → '12:00 PM CT'", () => {
  assert.equal(formatCmeHourLabel(12), "12:00 PM CT");
});

test("formatCmeHourLabel: 13 → '1:00 PM CT'", () => {
  assert.equal(formatCmeHourLabel(13), "1:00 PM CT");
});

test("formatCmeHourLabel: 16 → '4:00 PM CT'", () => {
  assert.equal(formatCmeHourLabel(16), "4:00 PM CT");
});

test("formatCmeHourLabel: 23 → '11:00 PM CT'", () => {
  assert.equal(formatCmeHourLabel(23), "11:00 PM CT");
});

test("formatCmeHourLabel: invalid hour → empty string", () => {
  assert.equal(formatCmeHourLabel(24), "");
  assert.equal(formatCmeHourLabel(-1), "");
});

// ─── cmeHourBoundaryNote ──────────────────────────────────────────────────────

test("cmeHourBoundaryNote: hour 16 mentions CME daily break and weekly close", () => {
  const note = cmeHourBoundaryNote(16);
  assert.ok(note);
  assert.match(note!, /4:00 PM CT/);
  assert.match(note!, /daily break/i);
  assert.match(note!, /weekly close/i);
});

test("cmeHourBoundaryNote: hour 17 mentions session reopen", () => {
  const note = cmeHourBoundaryNote(17);
  assert.ok(note);
  assert.match(note!, /5:00 PM CT/);
  assert.match(note!, /reopen/i);
});

test("cmeHourBoundaryNote: hour 9 has no boundary note", () => {
  assert.equal(cmeHourBoundaryNote(9), null);
});

test("cmeHourBoundaryNote: hour 0 has no boundary note", () => {
  assert.equal(cmeHourBoundaryNote(0), null);
});
