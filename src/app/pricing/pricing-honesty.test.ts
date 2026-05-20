/**
 * Honesty + CTA guard for the pricing page.
 *
 * Locks the pricing copy so future edits can't introduce false guarantees,
 * break the signup/login CTAs, or leak internal implementation terms.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRICING = readFileSync(resolve(import.meta.dirname, "./page.tsx"), "utf8");

describe("pricing page — CTAs", () => {
  it("links signed-out visitors to signup and login", () => {
    assert.ok(PRICING.includes('href="/signup"'), "must have a /signup CTA");
    assert.ok(PRICING.includes('href="/login"'), "must have a /login CTA");
  });

  it("links signed-in visitors to the dashboard", () => {
    assert.ok(PRICING.includes('href="/dashboard"'), "signed-in visitors must get a /dashboard CTA");
  });

  it("points pricing questions to the FAQ", () => {
    assert.ok(PRICING.includes('href="/faq"'), "must link to the FAQ for pricing detail");
  });
});

describe("pricing page — trial copy", () => {
  it("states the trial is free and needs no card", () => {
    assert.ok(
      PRICING.includes("No credit card required"),
      "trial copy must state no credit card is required",
    );
  });

  it("states the price and that it is cancellable", () => {
    assert.ok(PRICING.includes("$25"), "must show the $25 price");
    assert.ok(/cancel any time/i.test(PRICING), "must state the plan is cancellable");
  });
});

describe("pricing page — no false promises", () => {
  it("makes no profit / loss-prevention / risk-free guarantee", () => {
    const lower = PRICING.toLowerCase();
    for (const phrase of [
      "guaranteed profit",
      "guarantee profit",
      "risk-free",
      "risk free",
      "prevent losses",
      "prevent all losses",
      "never lose",
      "can't lose",
      "cannot lose",
      "eliminate risk",
      "guaranteed protection",
      "guaranteed returns",
    ]) {
      assert.ok(!lower.includes(phrase), `pricing copy must not promise "${phrase}"`);
    }
  });

  it("makes no false broker-enforcement claim", () => {
    const lower = PRICING.toLowerCase();
    for (const phrase of ["broker-backed", "broker blocks", "broker will block", "tradovate rejects"]) {
      assert.ok(!lower.includes(phrase), `pricing copy must not claim "${phrase}"`);
    }
  });

  it("exposes no internal implementation terms", () => {
    for (const term of [
      "riskState",
      "subscriptionStatus",
      "hasBotAccess",
      "dry_run",
      "DryRunViolation",
      "GuardianIntervention",
      "InternalLockEvent",
    ]) {
      assert.ok(!PRICING.includes(term), `internal term "${term}" must not appear in pricing copy`);
    }
  });
});
