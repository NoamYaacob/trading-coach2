import test from "node:test";
import assert from "node:assert/strict";

import { computeAccountDisconnectState } from "./broker-disconnect-window.ts";
import type { DisconnectWindowState } from "./broker-disconnect-window.ts";

const BLOCKED: DisconnectWindowState = {
  isBlocked: true,
  nextWindowStart: new Date("2026-05-05T19:00:00Z"), // 14:00 CT next day
  nextWindowEnd: new Date("2026-05-05T23:00:00Z"),   // 18:00 CT next day
};

const OPEN: DisconnectWindowState = {
  isBlocked: false,
  nextWindowStart: new Date("2026-05-04T19:00:00Z"), // 14:00 CT today
  nextWindowEnd: new Date("2026-05-04T23:00:00Z"),   // 18:00 CT today
};

// ─── Active protected accounts ────────────────────────────────────────────────

test("active protected account is blocked outside disconnect window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "protected" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, true);
  assert.equal(result.isUnavailable, false);
});

test("active monitor_only account is blocked outside disconnect window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "monitor_only" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, true);
  assert.equal(result.isUnavailable, false);
});

test("active protected account is allowed during disconnect window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "protected" },
    OPEN,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, false);
});

// ─── Unavailable accounts (missingFromBrokerSince) ───────────────────────────

test("unavailable account is removable immediately outside disconnect window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: new Date("2026-05-01T00:00:00Z"), protectionStatus: "protected" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, true);
});

test("missingFromBrokerSince bypasses the disconnect lock", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: new Date("2026-04-28T10:00:00Z"), protectionStatus: "monitor_only" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, true);
});

test("unavailable account stays isUnavailable=true even during open window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: new Date("2026-05-01T00:00:00Z"), protectionStatus: "protected" },
    OPEN,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, true);
});

test("UI: unavailable accounts do not show the 'Available today: ...' window label (isBlocked=false)", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: new Date("2026-05-01T00:00:00Z"), protectionStatus: "protected" },
    BLOCKED,
  );
  // The blocked-state UI (including the availability label) is only shown when isBlocked=true
  assert.equal(result.isBlocked, false);
});

// ─── Ignored accounts ─────────────────────────────────────────────────────────

test("ignored accounts are not blocked by the disconnect window", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "ignored" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, false);
});

// ─── Archived accounts ────────────────────────────────────────────────────────

test("archived accounts bypass the disconnect window restriction", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "archived" },
    BLOCKED,
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.isUnavailable, false);
});

// ─── null missingFromBrokerSince means available ──────────────────────────────

test("null missingFromBrokerSince is not treated as unavailable", () => {
  const result = computeAccountDisconnectState(
    { missingFromBrokerSince: null, protectionStatus: "protected" },
    BLOCKED,
  );
  assert.equal(result.isUnavailable, false);
});
