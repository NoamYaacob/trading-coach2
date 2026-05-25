/**
 * Phase 2A dry-run rule evaluator tests.
 *
 * Pure-function tests only (evaluateDryRunRules). DB persistence is not tested
 * here to keep the suite dependency-free.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateDryRunRules,
  type DryRunRuleInput,
} from "./dry-run-rule-evaluator.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Source-scan safety guards ─────────────────────────────────────────────────

const EVALUATOR_SRC = readFileSync(
  join(__dirname, "dry-run-rule-evaluator.ts"),
  "utf8",
);
// DB layer is scanned separately — pure evaluator must have no DB imports.
const EVALUATOR_DB_SRC = readFileSync(
  join(__dirname, "dry-run-rule-evaluator-db.ts"),
  "utf8",
);

describe("source-scan safety guards — pure evaluator", () => {
  it("never sets dryRun=false", () => {
    assert.ok(!EVALUATOR_SRC.includes("dryRun: false"), "must not contain dryRun: false");
    assert.ok(!EVALUATOR_SRC.includes("dryRun=false"), "must not contain dryRun=false");
  });

  it("never writes riskState", () => {
    assert.ok(!EVALUATOR_SRC.includes("riskState:"), "must not assign riskState");
  });

  it("never calls flatten or order action functions", () => {
    assert.ok(!EVALUATOR_SRC.includes("liquidateposition"), "must not contain liquidateposition");
    assert.ok(!EVALUATOR_SRC.includes("cancelOrder"), "must not contain cancelOrder");
    assert.ok(!EVALUATOR_SRC.includes("cancelorders"), "must not contain cancelorders");
  });

  it("never creates GuardianIntervention", () => {
    assert.ok(!EVALUATOR_SRC.includes("guardianIntervention.create"), "must not create GuardianIntervention");
    assert.ok(!EVALUATOR_SRC.includes("GuardianIntervention"), "must not reference GuardianIntervention");
  });

  it("never touches broker write endpoints", () => {
    assert.ok(!EVALUATOR_SRC.includes("userAccountAutoLiq"), "must not touch userAccountAutoLiq");
    assert.ok(!EVALUATOR_SRC.includes("order/place"), "must not touch order/place");
  });

  it("has no @/lib imports (pure, dependency-free)", () => {
    assert.ok(!EVALUATOR_SRC.includes("@/lib"), "pure evaluator must not import from @/lib");
  });
});

describe("source-scan safety guards — DB layer", () => {
  it("never sets dryRun=false", () => {
    assert.ok(!EVALUATOR_DB_SRC.includes("dryRun: false"), "must not contain dryRun: false");
  });

  it("never writes riskState", () => {
    assert.ok(!EVALUATOR_DB_SRC.includes("riskState:"), "must not assign riskState");
  });

  it("never calls flatten or order action functions", () => {
    assert.ok(!EVALUATOR_DB_SRC.includes("liquidateposition"), "must not contain liquidateposition");
    assert.ok(!EVALUATOR_DB_SRC.includes("cancelOrder"), "must not contain cancelOrder");
  });

  it("never creates GuardianIntervention", () => {
    assert.ok(!EVALUATOR_DB_SRC.includes("guardianIntervention.create"), "must not create GuardianIntervention");
  });

  it("never touches broker write endpoints", () => {
    assert.ok(!EVALUATOR_DB_SRC.includes("userAccountAutoLiq"), "must not touch userAccountAutoLiq");
  });
});

// ── Test fixture ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<DryRunRuleInput> = {}): DryRunRuleInput {
  return {
    accountId: "acct_test",
    userId: "user_test",
    externalAccountId: "EXT123",
    env: "demo",
    tradingDay: "2026-05-19",
    dailyPnl: 0,
    tradesCount: 0,
    tradeCountSource: "verified",
    consecutiveLosses: 0,
    maxDailyLoss: null,
    maxTradesPerDay: null,
    stopAfterLosses: null,
    dailyProfitTarget: null,
    ...overrides,
  };
}

// ── daily_loss_limit ──────────────────────────────────────────────────────────

describe("daily_loss_limit rule", () => {
  it("fires violation when dailyPnl equals exactly -maxDailyLoss", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: 500, dailyPnl: -500 }));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "daily_loss_limit");
    assert.equal(violations[0].thresholdAmount, 500);
    assert.equal(violations[0].observedAmount, -500);
    assert.equal(violations[0].actionWouldHaveTaken, "internal_lock");
  });

  it("fires violation when dailyPnl exceeds -maxDailyLoss", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: 500, dailyPnl: -600 }));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "daily_loss_limit");
  });

  it("does not fire when dailyPnl is above the limit", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: 500, dailyPnl: -499 }));
    assert.equal(violations.length, 0);
  });

  it("does not fire when dailyPnl is positive", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: 500, dailyPnl: 100 }));
    assert.equal(violations.length, 0);
  });

  it("skips evaluation when maxDailyLoss is null (not configured)", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: null, dailyPnl: -9999 }));
    assert.equal(violations.length, 0);
  });

  it("embeds dry_run in dedup key", () => {
    const { violations } = evaluateDryRunRules(makeInput({ maxDailyLoss: 500, dailyPnl: -500 }));
    assert.equal(violations[0].dedupKey, "acct_test:daily_loss_limit:2026-05-19:dry_run");
  });
});

// ── trade_limit ───────────────────────────────────────────────────────────────

describe("trade_limit rule", () => {
  // Semantics: maxTradesPerDay is the inclusive allowance. The lock fires only
  // when the count strictly EXCEEDS the cap (tradesCount > maxTradesPerDay).
  // At-cap is still within the allowance and does NOT fire a lock.

  it("does NOT fire when tradesCount === maxTradesPerDay (at-cap, within allowance)", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 5, tradeCountSource: "verified" }),
    );
    assert.equal(violations.length, 0, "at-cap is within allowance — must not lock");
  });

  it("fires violation when tradesCount exceeds maxTradesPerDay by one (cap + 1)", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 6, tradeCountSource: "verified" }),
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "trade_limit");
    assert.equal(violations[0].thresholdCount, 5);
    assert.equal(violations[0].observedCount, 6);
  });

  it("fires violation when tradesCount far exceeds maxTradesPerDay", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 7, tradeCountSource: "verified" }),
    );
    assert.equal(violations.length, 1);
  });

  it("does not fire when tradesCount is below the limit", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 4, tradeCountSource: "verified" }),
    );
    assert.equal(violations.length, 0);
  });

  it("product semantics: maxTradesPerDay=3 allows 0,1,2,3 and locks at 4", () => {
    // Concretizes the user-facing rule: "Max trades per day = 3" means 3 trades
    // are permitted. The internal lock fires only when the 4th trade is counted.
    for (const tradesCount of [0, 1, 2, 3]) {
      const { violations } = evaluateDryRunRules(
        makeInput({ maxTradesPerDay: 3, tradesCount, tradeCountSource: "verified" }),
      );
      assert.equal(violations.length, 0, `maxTradesPerDay=3, tradesCount=${tradesCount} must not lock`);
    }
    const { violations: lockedViolations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 3, tradesCount: 4, tradeCountSource: "verified" }),
    );
    assert.equal(lockedViolations.length, 1, "maxTradesPerDay=3, tradesCount=4 must lock");
    assert.equal(lockedViolations[0].ruleType, "trade_limit");
  });

  it("skips evaluation when maxTradesPerDay is null", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: null, tradesCount: 99, tradeCountSource: "verified" }),
    );
    assert.equal(violations.length, 0);
  });

  it("suppresses trade_limit when tradeCountSource is 'estimated'", () => {
    const { violations, skipped } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 10, tradeCountSource: "estimated" }),
    );
    assert.equal(violations.length, 0);
    assert.ok(skipped.some((s) => s.ruleType === "trade_limit"), "should report skip reason");
  });

  it("suppresses trade_limit when tradeCountSource is 'unavailable'", () => {
    const { violations, skipped } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 10, tradeCountSource: "unavailable" }),
    );
    assert.equal(violations.length, 0);
    assert.ok(skipped.some((s) => s.ruleType === "trade_limit"), "should report skip reason");
  });

  it("embeds dry_run in dedup key", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 6, tradeCountSource: "verified" }),
    );
    assert.equal(violations[0].dedupKey, "acct_test:trade_limit:2026-05-19:dry_run");
  });
});

// ── max_loss_streak ───────────────────────────────────────────────────────────

describe("max_loss_streak rule", () => {
  it("fires violation when consecutiveLosses reaches stopAfterLosses", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ stopAfterLosses: 3, consecutiveLosses: 3 }),
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "max_loss_streak");
    assert.equal(violations[0].thresholdCount, 3);
    assert.equal(violations[0].observedCount, 3);
  });

  it("fires when consecutiveLosses exceeds stopAfterLosses", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ stopAfterLosses: 3, consecutiveLosses: 5 }),
    );
    assert.equal(violations.length, 1);
  });

  it("does not fire when consecutiveLosses is below the limit", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ stopAfterLosses: 3, consecutiveLosses: 2 }),
    );
    assert.equal(violations.length, 0);
  });

  it("skips evaluation when stopAfterLosses is null", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ stopAfterLosses: null, consecutiveLosses: 99 }),
    );
    assert.equal(violations.length, 0);
  });

  it("embeds dry_run in dedup key", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ stopAfterLosses: 3, consecutiveLosses: 3 }),
    );
    assert.equal(violations[0].dedupKey, "acct_test:max_loss_streak:2026-05-19:dry_run");
  });
});

// ── daily_profit_target ───────────────────────────────────────────────────────

describe("daily_profit_target rule", () => {
  it("fires would_fire violation when dailyPnl reaches the target exactly", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: 800 }),
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "daily_profit_target");
    assert.equal(violations[0].thresholdAmount, 800);
    assert.equal(violations[0].observedAmount, 800);
  });

  it("fires when dailyPnl exceeds the target", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: 1200 }),
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "daily_profit_target");
  });

  it("does not fire when dailyPnl is below the target", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: 799 }),
    );
    assert.equal(violations.length, 0);
  });

  it("does not fire when dailyPnl is negative (in a loss)", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: -500 }),
    );
    assert.equal(violations.length, 0);
  });

  it("skips evaluation when dailyProfitTarget is null (not configured)", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: null, dailyPnl: 99999 }),
    );
    assert.equal(violations.length, 0);
  });

  it("embeds dry_run in dedup key", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: 800 }),
    );
    assert.equal(violations[0].dedupKey, "acct_test:daily_profit_target:2026-05-19:dry_run");
  });

  it("thresholdCount and observedCount are null (amount-based rule)", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ dailyProfitTarget: 800, dailyPnl: 800 }),
    );
    assert.equal(violations[0].thresholdCount, null);
    assert.equal(violations[0].observedCount, null);
  });

  it("fires alongside daily_loss_limit configuration without interfering", () => {
    // Loss limit not breached, profit target breached — only profit target fires.
    const { violations } = evaluateDryRunRules(
      makeInput({ maxDailyLoss: 500, dailyProfitTarget: 800, dailyPnl: 900 }),
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleType, "daily_profit_target");
  });
});

// ── Multi-rule ────────────────────────────────────────────────────────────────

describe("multiple rules at once", () => {
  it("fires all applicable violations simultaneously", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({
        maxDailyLoss: 500,
        dailyPnl: -600,
        maxTradesPerDay: 5,
        tradesCount: 6,
        tradeCountSource: "verified",
        stopAfterLosses: 3,
        consecutiveLosses: 4,
      }),
    );
    assert.equal(violations.length, 3);
    const types = violations.map((v) => v.ruleType);
    assert.ok(types.includes("daily_loss_limit"));
    assert.ok(types.includes("trade_limit"));
    assert.ok(types.includes("max_loss_streak"));
  });

  it("returns empty violations when nothing breached", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({
        maxDailyLoss: 500,
        dailyPnl: -100,
        maxTradesPerDay: 5,
        tradesCount: 2,
        tradeCountSource: "verified",
        stopAfterLosses: 3,
        consecutiveLosses: 1,
      }),
    );
    assert.equal(violations.length, 0);
  });
});

// ── Dedup key uniqueness ──────────────────────────────────────────────────────

describe("dedup key uniqueness", () => {
  it("produces distinct dedup keys for different rule types", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({
        maxDailyLoss: 500,
        dailyPnl: -600,
        stopAfterLosses: 3,
        consecutiveLosses: 3,
      }),
    );
    const keys = violations.map((v) => v.dedupKey);
    assert.equal(new Set(keys).size, keys.length, "all dedup keys must be unique");
  });

  it("produces distinct dedup keys for different accounts", () => {
    const r1 = evaluateDryRunRules(makeInput({ accountId: "acct_A", maxDailyLoss: 500, dailyPnl: -600 }));
    const r2 = evaluateDryRunRules(makeInput({ accountId: "acct_B", maxDailyLoss: 500, dailyPnl: -600 }));
    assert.notEqual(r1.violations[0].dedupKey, r2.violations[0].dedupKey);
  });

  it("produces distinct dedup keys for different trading days", () => {
    const r1 = evaluateDryRunRules(makeInput({ tradingDay: "2026-05-19", maxDailyLoss: 500, dailyPnl: -600 }));
    const r2 = evaluateDryRunRules(makeInput({ tradingDay: "2026-05-20", maxDailyLoss: 500, dailyPnl: -600 }));
    assert.notEqual(r1.violations[0].dedupKey, r2.violations[0].dedupKey);
  });
});

// ── Output shape ──────────────────────────────────────────────────────────────

describe("output shape", () => {
  it("thresholdAmount is null for count-based rules", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 6, tradeCountSource: "verified" }),
    );
    assert.equal(violations[0].thresholdAmount, null);
  });

  it("thresholdCount is null for amount-based rules", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxDailyLoss: 500, dailyPnl: -600 }),
    );
    assert.equal(violations[0].thresholdCount, null);
  });

  it("observedCount is null for amount-based rules", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxDailyLoss: 500, dailyPnl: -600 }),
    );
    assert.equal(violations[0].observedCount, null);
  });

  it("observedAmount is null for count-based rules", () => {
    const { violations } = evaluateDryRunRules(
      makeInput({ maxTradesPerDay: 5, tradesCount: 6, tradeCountSource: "verified" }),
    );
    assert.equal(violations[0].observedAmount, null);
  });
});
