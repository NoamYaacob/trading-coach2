import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAccountRulesBanner,
  canSaveAccountRulesNow,
  FIRST_TIME_SETUP_BANNER,
  LOCKED_BANNER,
  REVIEW_INHERITED_HINT,
} from "./account-rules-form-logic.ts";

// ─── canSaveAccountRulesNow ───────────────────────────────────────────────────

test("new account (no existing rules) can save immediately even when locked", () => {
  assert.equal(canSaveAccountRulesNow(false, true), true);
});

test("new account (no existing rules) can save immediately when not locked", () => {
  assert.equal(canSaveAccountRulesNow(false, false), true);
});

test("existing account with rules defers save when locked", () => {
  assert.equal(canSaveAccountRulesNow(true, true), false);
});

test("existing account with rules can save immediately when not locked", () => {
  assert.equal(canSaveAccountRulesNow(true, false), true);
});

test("first-time exception cannot be used to bypass lock on an account that already has rules", () => {
  // hasExistingRules=true — lock must be respected regardless of any first-time claim
  assert.equal(canSaveAccountRulesNow(true, true), false);
});

test("pending_decision / newly-added account (no existing rules) first setup applies immediately", () => {
  // pending_decision accounts have no account-specific rules yet → first-time path
  const hasExistingRules = false;
  const isLocked = true;
  assert.equal(canSaveAccountRulesNow(hasExistingRules, isLocked), true);
});

// ─── computeAccountRulesBanner ────────────────────────────────────────────────

test("form not shown: banner is none regardless of lock or rules state", () => {
  assert.equal(computeAccountRulesBanner(false, true, false).kind, "none");
  assert.equal(computeAccountRulesBanner(true, true, false).kind, "none");
});

test("first-time setup: shows first_time banner, not locked banner", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.equal(banner.kind, "first_time");
});

test("first-time setup: banner message says First-time setup and immediate", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.ok(banner.kind === "first_time");
  assert.ok(banner.message.includes("First-time setup"));
  assert.ok(banner.message.includes("immediately"));
  assert.equal(banner.message, FIRST_TIME_SETUP_BANNER);
});

test("first-time setup: no lock banner even when isLocked=true", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.notEqual(banner.kind, "locked");
});

test("existing rules, locked: shows locked banner", () => {
  const banner = computeAccountRulesBanner(true, true, true);
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, LOCKED_BANNER);
});

test("existing rules, not locked: no banner", () => {
  const banner = computeAccountRulesBanner(true, false, true);
  assert.equal(banner.kind, "none");
});

test("deferred banner still appears for real rule changes (existing rules + locked)", () => {
  const banner = computeAccountRulesBanner(true, true, true);
  assert.equal(banner.kind, "locked");
  assert.ok(banner.message.includes("locked"));
  assert.ok(banner.message.includes("edit window") || banner.message.includes("trading session"));
});

test("locked banner uses server lockMessage when provided", () => {
  const banner = computeAccountRulesBanner(true, true, true, "Changes apply at May 8, 2026, 5:00 PM CT");
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, "Changes apply at May 8, 2026, 5:00 PM CT");
});

test("locked banner falls back to LOCKED_BANNER when lockMessage is null", () => {
  const banner = computeAccountRulesBanner(true, true, true, null);
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, LOCKED_BANNER);
});

test("first-time save never shows lock message even when lockMessage is provided", () => {
  const banner = computeAccountRulesBanner(false, true, true, "Locked until session end");
  assert.equal(banner.kind, "first_time");
  assert.equal(banner.message, FIRST_TIME_SETUP_BANNER);
  assert.ok(!banner.message.includes("Locked"), "first-time banner must not contain lock copy");
});

// ─── constants ────────────────────────────────────────────────────────────────

test("REVIEW_INHERITED_HINT mentions reviewing limits", () => {
  assert.ok(REVIEW_INHERITED_HINT.toLowerCase().includes("review"));
  assert.ok(REVIEW_INHERITED_HINT.toLowerCase().includes("inherited") || REVIEW_INHERITED_HINT.toLowerCase().includes("limit"));
});
