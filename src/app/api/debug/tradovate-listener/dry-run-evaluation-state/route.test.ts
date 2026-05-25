/**
 * Tests for the dry-run-evaluation-state diagnostic endpoint.
 *
 * Source-scan guards verify the route never performs DB writes.
 * Pure-logic tests exercise deriveAccountEvaluation and buildRuleEntry
 * directly (no Prisma, no network).
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRuleEntry,
  deriveAccountEvaluation,
  type AccountEvalInput,
} from "../../../../../lib/guardian-engine/dry-run-evaluation-state-helpers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROUTE_SRC = readFileSync(join(__dirname, "route.ts"), "utf8");
const HELPERS_SRC = readFileSync(
  resolve(__dirname, "../../../../../lib/guardian-engine/dry-run-evaluation-state-helpers.ts"),
  "utf8",
);

// ── Source-scan safety guards ─────────────────────────────────────────────────

describe("source-scan: no DB writes in route", () => {
  it("never calls prisma create", () => {
    assert.ok(!ROUTE_SRC.includes(".create("), "route must not call .create()");
  });

  it("never calls prisma upsert", () => {
    assert.ok(!ROUTE_SRC.includes(".upsert("), "route must not call .upsert()");
  });

  it("never calls prisma update", () => {
    assert.ok(!ROUTE_SRC.includes(".update("), "route must not call .update()");
  });

  it("never calls prisma delete", () => {
    assert.ok(!ROUTE_SRC.includes(".delete("), "route must not call .delete()");
  });

  it("never imports persistDryRunViolations", () => {
    assert.ok(
      !ROUTE_SRC.includes("persistDryRunViolations"),
      "route must not call the persistence helper",
    );
  });

  it("never references DryRunViolation model directly", () => {
    assert.ok(
      !ROUTE_SRC.includes("dryRunViolation."),
      "route must not write DryRunViolation rows",
    );
  });

  it("response includes dry-run safety note", () => {
    assert.ok(
      ROUTE_SRC.includes("no violations written and no enforcement action was taken"),
      "response must carry the dry-run safety note",
    );
  });
});

describe("source-scan: helpers have no DB writes", () => {
  it("helpers never call prisma create/upsert/update/delete", () => {
    assert.ok(!HELPERS_SRC.includes(".create("), "helpers must not call .create()");
    assert.ok(!HELPERS_SRC.includes(".upsert("), "helpers must not call .upsert()");
    assert.ok(!HELPERS_SRC.includes(".update("), "helpers must not call .update()");
    assert.ok(!HELPERS_SRC.includes(".delete("), "helpers must not call .delete()");
  });

  it("helpers never import from @/lib/db or prisma client directly", () => {
    assert.ok(!HELPERS_SRC.includes("@/lib/db"), "helpers must not import Prisma");
    assert.ok(!HELPERS_SRC.includes("@prisma/client"), "helpers must not import Prisma client");
  });
});

// ── Test fixture ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AccountEvalInput> = {}): AccountEvalInput {
  return {
    accountId: "acct_test",
    userId: "user_test",
    externalAccountId: "EXT123",
    env: "demo",
    isActive: true,
    missingFromBrokerSince: null,
    protectionStatus: "protected",
    sessionState: {
      sessionDate: "2026-05-15",
      dailyPnl: 0,
      tradesCount: 0,
      tradeCountSource: "verified",
      consecutiveLosses: 0,
      updatedAt: new Date(),
    },
    riskRules: {
      maxDailyLoss: null,
      maxTradesPerDay: null,
      stopAfterLosses: null,
    },
    enableLive: true,
    ...overrides,
  };
}

// ── Eligibility gates ─────────────────────────────────────────────────────────

describe("eligibility: account_inactive", () => {
  it("marks all rules skipped_insufficient_data when isActive=false", () => {
    const result = deriveAccountEvaluation(makeInput({ isActive: false }));
    assert.equal(result.evaluationEligible, false);
    assert.equal(result.wouldFire, false);
    assert.ok(result.ruleEvaluation.every((r) => r.status === "skipped_insufficient_data"));
    assert.ok(result.ruleEvaluation.every((r) => r.reason === "account_inactive"));
  });
});

describe("eligibility: missing_from_broker (MFFU)", () => {
  it("marks all rules skipped_insufficient_data when missingFromBrokerSince is set", () => {
    const result = deriveAccountEvaluation(makeInput({ missingFromBrokerSince: new Date() }));
    assert.equal(result.evaluationEligible, false);
    assert.ok(result.ruleEvaluation.every((r) => r.reason === "missing_from_broker"));
  });
});

describe("eligibility: not protected", () => {
  it("marks ineligible when protectionStatus is pending_decision", () => {
    const result = deriveAccountEvaluation(makeInput({ protectionStatus: "pending_decision" }));
    assert.equal(result.evaluationEligible, false);
    assert.ok(result.ruleEvaluation.every((r) => r.reason?.includes("protectionStatus")));
  });

  it("marks ineligible when protectionStatus is monitor_only", () => {
    const result = deriveAccountEvaluation(makeInput({ protectionStatus: "monitor_only" }));
    assert.equal(result.evaluationEligible, false);
  });
});

describe("eligibility: env gate", () => {
  it("marks all rules skipped_env_gate for live account when enableLive=false", () => {
    const result = deriveAccountEvaluation(makeInput({ env: "live", enableLive: false }));
    assert.equal(result.evaluationEligible, false);
    assert.ok(result.ruleEvaluation.every((r) => r.status === "skipped_env_gate"));
    assert.ok(
      result.ruleEvaluation.every((r) => r.reason === "TRADOVATE_LISTENER_ENABLE_LIVE=false"),
    );
  });

  it("evaluates normally for live account when enableLive=true", () => {
    const result = deriveAccountEvaluation(makeInput({ env: "live", enableLive: true }));
    assert.equal(result.evaluationEligible, true);
  });
});

describe("eligibility: no session state", () => {
  it("marks all rules skipped_insufficient_data when sessionState is null", () => {
    const result = deriveAccountEvaluation(makeInput({ sessionState: null }));
    assert.equal(result.evaluationEligible, false);
    assert.ok(result.ruleEvaluation.every((r) => r.status === "skipped_insufficient_data"));
    assert.ok(result.ruleEvaluation.every((r) => r.reason === "no_session_state"));
  });
});

describe("eligibility: no risk rules", () => {
  it("marks all rules skipped_missing_rule when riskRules is null", () => {
    const result = deriveAccountEvaluation(makeInput({ riskRules: null }));
    assert.equal(result.evaluationEligible, false);
    assert.ok(result.ruleEvaluation.every((r) => r.status === "skipped_missing_rule"));
    assert.ok(result.ruleEvaluation.every((r) => r.reason === "no_account_risk_rules"));
  });
});

// ── trade_limit rule mapping ──────────────────────────────────────────────────

describe("trade_limit: would_fire", () => {
  it("returns would_fire when maxTradesPerDay=1 and tradesCount>1 (allowance exceeded)", () => {
    // Semantics: maxTradesPerDay=1 permits 1 trade; the lock fires on the 2nd.
    // At-cap (tradesCount=1) is within the allowance and does NOT fire — see
    // dry-run-rule-evaluator.ts for the > (strict) comparison.
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: 0,
          tradesCount: 2,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: null, maxTradesPerDay: 1, stopAfterLosses: null },
      }),
    );
    assert.equal(result.evaluationEligible, true);
    const tradeRule = result.ruleEvaluation.find((r) => r.ruleType === "trade_limit");
    assert.ok(tradeRule, "trade_limit entry must exist");
    assert.equal(tradeRule.status, "would_fire");
    assert.equal(tradeRule.wouldFire, true);
    assert.equal(tradeRule.threshold, 1);
    assert.equal(tradeRule.observed, 2);
    assert.equal(result.wouldFire, true);
  });

  it("does NOT fire when maxTradesPerDay=1 and tradesCount===1 (at-cap, within allowance)", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: 0,
          tradesCount: 1,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: null, maxTradesPerDay: 1, stopAfterLosses: null },
      }),
    );
    assert.equal(result.evaluationEligible, true);
    const tradeRule = result.ruleEvaluation.find((r) => r.ruleType === "trade_limit");
    assert.ok(tradeRule, "trade_limit entry must exist");
    assert.equal(tradeRule.wouldFire, false, "at-cap is within allowance — must not fire");
    assert.notEqual(tradeRule.status, "would_fire", "status must not be would_fire at the cap");
  });
});

describe("trade_limit: skipped_unverified_trade_count", () => {
  it("returns skipped_unverified_trade_count when tradeCountSource=estimated", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: 0,
          tradesCount: 10,
          tradeCountSource: "estimated",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: null, maxTradesPerDay: 1, stopAfterLosses: null },
      }),
    );
    const tradeRule = result.ruleEvaluation.find((r) => r.ruleType === "trade_limit");
    assert.ok(tradeRule, "trade_limit entry must exist");
    assert.equal(tradeRule.status, "skipped_unverified_trade_count");
    assert.equal(tradeRule.wouldFire, false);
  });

  it("returns skipped_unverified_trade_count when tradeCountSource=unavailable", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: 0,
          tradesCount: 5,
          tradeCountSource: "unavailable",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: null, maxTradesPerDay: 1, stopAfterLosses: null },
      }),
    );
    const tradeRule = result.ruleEvaluation.find((r) => r.ruleType === "trade_limit");
    assert.equal(tradeRule?.status, "skipped_unverified_trade_count");
  });
});

// ── daily_loss_limit rule mapping ─────────────────────────────────────────────

describe("daily_loss_limit: would_fire", () => {
  it("returns would_fire when dailyPnl breaches maxDailyLoss", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: -500,
          tradesCount: 0,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: 500, maxTradesPerDay: null, stopAfterLosses: null },
      }),
    );
    const lossRule = result.ruleEvaluation.find((r) => r.ruleType === "daily_loss_limit");
    assert.equal(lossRule?.status, "would_fire");
    assert.equal(lossRule?.wouldFire, true);
  });

  it("returns below_threshold when dailyPnl is above the limit", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: -100,
          tradesCount: 0,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: 500, maxTradesPerDay: null, stopAfterLosses: null },
      }),
    );
    const lossRule = result.ruleEvaluation.find((r) => r.ruleType === "daily_loss_limit");
    assert.equal(lossRule?.status, "below_threshold");
  });
});

// ── max_loss_streak rule mapping ──────────────────────────────────────────────

describe("max_loss_streak: would_fire", () => {
  it("returns would_fire when consecutiveLosses reaches stopAfterLosses", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: 0,
          tradesCount: 0,
          tradeCountSource: "verified",
          consecutiveLosses: 3,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: null, maxTradesPerDay: null, stopAfterLosses: 3 },
      }),
    );
    const streakRule = result.ruleEvaluation.find((r) => r.ruleType === "max_loss_streak");
    assert.equal(streakRule?.status, "would_fire");
    assert.equal(streakRule?.wouldFire, true);
  });
});

// ── skipped_missing_rule for individual unconfigured rules ────────────────────

describe("skipped_missing_rule for individual unconfigured rules", () => {
  it("returns skipped_missing_rule for trade_limit when maxTradesPerDay is null", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        riskRules: { maxDailyLoss: 500, maxTradesPerDay: null, stopAfterLosses: null },
      }),
    );
    assert.equal(result.evaluationEligible, true);
    const tradeRule = result.ruleEvaluation.find((r) => r.ruleType === "trade_limit");
    assert.equal(tradeRule?.status, "skipped_missing_rule");
    assert.equal(tradeRule?.reason, "rule_not_configured");
  });
});

// ── buildRuleEntry ────────────────────────────────────────────────────────────

describe("buildRuleEntry", () => {
  it("returns skipped_missing_rule when threshold is null", () => {
    const entry = buildRuleEntry({
      ruleType: "trade_limit",
      threshold: null,
      observed: 5,
      violations: [],
      skippedMap: new Map(),
    });
    assert.equal(entry.status, "skipped_missing_rule");
    assert.equal(entry.wouldFire, false);
  });

  it("returns would_fire when rule appears in violations", () => {
    const fakeViolation = {
      ruleType: "trade_limit" as const,
      thresholdAmount: null,
      thresholdCount: 1,
      observedAmount: null,
      observedCount: 2,
      dedupKey: "key",
      actionWouldHaveTaken: "internal_lock",
    };
    const entry = buildRuleEntry({
      ruleType: "trade_limit",
      threshold: 1,
      observed: 2,
      violations: [fakeViolation],
      skippedMap: new Map(),
    });
    assert.equal(entry.status, "would_fire");
    assert.equal(entry.wouldFire, true);
  });

  it("returns skipped_unverified_trade_count for tradeCountSource skip reason", () => {
    const entry = buildRuleEntry({
      ruleType: "trade_limit",
      threshold: 1,
      observed: 5,
      violations: [],
      skippedMap: new Map([["trade_limit", "tradeCountSource=estimated"]]),
    });
    assert.equal(entry.status, "skipped_unverified_trade_count");
    assert.equal(entry.wouldFire, false);
  });

  it("returns below_threshold when rule has threshold, no violation, no skip", () => {
    const entry = buildRuleEntry({
      ruleType: "daily_loss_limit",
      threshold: 500,
      observed: -100,
      violations: [],
      skippedMap: new Map(),
    });
    assert.equal(entry.status, "below_threshold");
    assert.equal(entry.wouldFire, false);
    assert.equal(entry.threshold, 500);
    assert.equal(entry.observed, -100);
  });
});

// ── wouldFire aggregate ───────────────────────────────────────────────────────

describe("wouldFire aggregate", () => {
  it("is false when all rules are below_threshold", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: -50,
          tradesCount: 0,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: 500, maxTradesPerDay: 5, stopAfterLosses: 3 },
      }),
    );
    assert.equal(result.wouldFire, false);
  });

  it("is true when any rule would_fire", () => {
    const result = deriveAccountEvaluation(
      makeInput({
        sessionState: {
          sessionDate: "2026-05-15",
          dailyPnl: -600,
          tradesCount: 0,
          tradeCountSource: "verified",
          consecutiveLosses: 0,
          updatedAt: new Date(),
        },
        riskRules: { maxDailyLoss: 500, maxTradesPerDay: 5, stopAfterLosses: 3 },
      }),
    );
    assert.equal(result.wouldFire, true);
  });
});
