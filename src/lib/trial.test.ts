/**
 * Unit tests for the trial helper (src/lib/trial.ts).
 *
 * Pure-function tests — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getTrialDates, isTrialActive } from "./trial.ts";

const DAY_MS = 86_400_000;

describe("getTrialDates", () => {
  it("ends 7 days after the start date", () => {
    const start = new Date("2026-05-01T12:00:00.000Z");
    const { trialStartedAt, trialEndsAt } = getTrialDates(start);
    assert.equal(trialStartedAt.getTime(), start.getTime());
    const days = Math.round((trialEndsAt.getTime() - trialStartedAt.getTime()) / DAY_MS);
    assert.equal(days, 7);
  });

  it("defaults the start to roughly now", () => {
    const before = Date.now();
    const { trialStartedAt } = getTrialDates();
    const after = Date.now();
    assert.ok(
      trialStartedAt.getTime() >= before && trialStartedAt.getTime() <= after,
      "trialStartedAt should default to the current time",
    );
  });

  it("does not mutate the passed-in start date", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    getTrialDates(start);
    assert.equal(start.toISOString(), "2026-05-01T00:00:00.000Z");
  });

  it("trialEndsAt is always after trialStartedAt", () => {
    const { trialStartedAt, trialEndsAt } = getTrialDates();
    assert.ok(trialEndsAt.getTime() > trialStartedAt.getTime());
  });
});

describe("isTrialActive", () => {
  it("is true for a future trialEndsAt", () => {
    assert.equal(isTrialActive(new Date(Date.now() + DAY_MS)), true);
  });

  it("is false for a past trialEndsAt", () => {
    assert.equal(isTrialActive(new Date(Date.now() - DAY_MS)), false);
  });

  it("is false for null or undefined", () => {
    assert.equal(isTrialActive(null), false);
    assert.equal(isTrialActive(undefined), false);
  });
});
