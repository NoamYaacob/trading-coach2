/**
 * Tests for dry-run-violation-summary-helpers.ts and the summary route.
 *
 * Source-scan guards verify the route never performs DB writes.
 * Pure-logic tests exercise buildViolationSummary directly (no Prisma, no network).
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildViolationSummary,
  type ViolationRow,
} from "./dry-run-violation-summary-helpers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROUTE_SRC = readFileSync(
  resolve(
    __dirname,
    "../../app/api/debug/tradovate-listener/dry-run-summary/route.ts",
  ),
  "utf8",
);
const HELPERS_SRC = readFileSync(
  join(__dirname, "dry-run-violation-summary-helpers.ts"),
  "utf8",
);

// ── Source-scan: route must be read-only ──────────────────────────────────────

describe("source-scan: summary route has no DB writes", () => {
  it("never calls prisma create", () => {
    assert.ok(!ROUTE_SRC.includes(".create("), "must not call .create()");
  });

  it("never calls prisma upsert", () => {
    assert.ok(!ROUTE_SRC.includes(".upsert("), "must not call .upsert()");
  });

  it("never calls prisma update", () => {
    assert.ok(!ROUTE_SRC.includes(".update("), "must not call .update()");
  });

  it("never calls prisma delete", () => {
    assert.ok(!ROUTE_SRC.includes(".delete("), "must not call .delete()");
  });

  it("filters dryRun=true in the DB query", () => {
    assert.ok(
      ROUTE_SRC.includes("dryRun: true"),
      "query must be scoped to dryRun=true rows only",
    );
  });

  it("response includes the dry-run safety note", () => {
    assert.ok(
      ROUTE_SRC.includes("no enforcement action was taken"),
      "response must carry the safety note",
    );
  });

  it("requires x-cron-secret", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"), "must check x-cron-secret header");
    assert.ok(ROUTE_SRC.includes("forbidden"), "must return 403 on bad secret");
  });
});

describe("source-scan: helpers have no side effects", () => {
  it("no @/lib/db import", () => {
    assert.ok(!HELPERS_SRC.includes("@/lib/db"), "helpers must not import Prisma");
  });

  it("no next/server import", () => {
    assert.ok(!HELPERS_SRC.includes("next/server"), "helpers must not import Next.js");
  });
});

// ── Test fixture ──────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ViolationRow> = {}): ViolationRow {
  return {
    accountId: "acct_A",
    accountLabel: "DEMO7433035",
    externalAccountId: "47669364",
    env: "demo",
    ruleType: "trade_limit",
    tradingDay: "2026-05-15",
    thresholdAmount: null,
    thresholdCount: 1,
    observedAmount: null,
    observedCount: 2,
    dryRun: true,
    actionWouldHaveTaken: "internal_lock",
    createdAt: new Date("2026-05-15T14:00:00Z"),
    updatedAt: new Date("2026-05-15T15:00:00Z"),
    ...overrides,
  };
}

// ── Empty input ───────────────────────────────────────────────────────────────

describe("empty input", () => {
  it("returns zero totals and empty arrays", () => {
    const summary = buildViolationSummary([]);
    assert.equal(summary.totalViolations, 0);
    assert.equal(summary.byTradingDay.length, 0);
    assert.equal(summary.byAccountAndRule.length, 0);
    assert.equal(summary.byRuleType.length, 0);
  });
});

// ── Single violation ──────────────────────────────────────────────────────────

describe("single violation row", () => {
  it("totalViolations is 1", () => {
    const summary = buildViolationSummary([makeRow()]);
    assert.equal(summary.totalViolations, 1);
  });

  it("byTradingDay has one entry with correct fields", () => {
    const summary = buildViolationSummary([makeRow()]);
    assert.equal(summary.byTradingDay.length, 1);
    const day = summary.byTradingDay[0];
    assert.equal(day.tradingDay, "2026-05-15");
    assert.equal(day.violationCount, 1);
    assert.deepEqual(day.ruleTypes, ["trade_limit"]);
    assert.deepEqual(day.accounts, ["DEMO7433035"]);
  });

  it("byAccountAndRule has one entry with correct fields", () => {
    const summary = buildViolationSummary([makeRow()]);
    assert.equal(summary.byAccountAndRule.length, 1);
    const entry = summary.byAccountAndRule[0];
    assert.equal(entry.accountId, "acct_A");
    assert.equal(entry.label, "DEMO7433035");
    assert.equal(entry.ruleType, "trade_limit");
    assert.equal(entry.daysWithViolation, 1);
    assert.deepEqual(entry.tradingDays, ["2026-05-15"]);
    assert.equal(entry.threshold, 1);
    assert.equal(entry.latestObservedCount, 2);
    assert.equal(entry.latestObservedAmount, null);
    assert.equal(entry.dryRun, true);
    assert.equal(entry.actionWouldHaveTaken, "internal_lock");
    assert.deepEqual(entry.firstSeenAt, new Date("2026-05-15T14:00:00Z"));
    assert.deepEqual(entry.lastUpdatedAt, new Date("2026-05-15T15:00:00Z"));
  });

  it("byRuleType has one entry with correct fields", () => {
    const summary = buildViolationSummary([makeRow()]);
    assert.equal(summary.byRuleType.length, 1);
    const rule = summary.byRuleType[0];
    assert.equal(rule.ruleType, "trade_limit");
    assert.equal(rule.violationCount, 1);
    assert.deepEqual(rule.tradingDays, ["2026-05-15"]);
    assert.deepEqual(rule.affectedAccounts, ["DEMO7433035"]);
  });
});

// ── Same account+rule across multiple days ────────────────────────────────────

describe("same account+rule across multiple trading days", () => {
  const rows = [
    makeRow({ tradingDay: "2026-05-13", createdAt: new Date("2026-05-13T14:00:00Z"), updatedAt: new Date("2026-05-13T15:00:00Z"), observedCount: 2 }),
    makeRow({ tradingDay: "2026-05-14", createdAt: new Date("2026-05-14T14:00:00Z"), updatedAt: new Date("2026-05-14T15:00:00Z"), observedCount: 3 }),
    makeRow({ tradingDay: "2026-05-15", createdAt: new Date("2026-05-15T14:00:00Z"), updatedAt: new Date("2026-05-15T15:00:00Z"), observedCount: 1 }),
  ];

  it("byTradingDay has one entry per day, sorted desc", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byTradingDay.length, 3);
    assert.equal(summary.byTradingDay[0].tradingDay, "2026-05-15");
    assert.equal(summary.byTradingDay[1].tradingDay, "2026-05-14");
    assert.equal(summary.byTradingDay[2].tradingDay, "2026-05-13");
  });

  it("byAccountAndRule merges all days into one entry", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byAccountAndRule.length, 1);
    const entry = summary.byAccountAndRule[0];
    assert.equal(entry.daysWithViolation, 3);
    assert.equal(entry.tradingDays.length, 3);
    assert.ok(entry.tradingDays.includes("2026-05-13"));
    assert.ok(entry.tradingDays.includes("2026-05-14"));
    assert.ok(entry.tradingDays.includes("2026-05-15"));
  });

  it("latestObservedCount comes from the most recently updated row", () => {
    const summary = buildViolationSummary(rows);
    // 2026-05-15 has the latest updatedAt, observedCount=1
    assert.equal(summary.byAccountAndRule[0].latestObservedCount, 1);
  });

  it("firstSeenAt is the earliest createdAt", () => {
    const summary = buildViolationSummary(rows);
    assert.deepEqual(
      summary.byAccountAndRule[0].firstSeenAt,
      new Date("2026-05-13T14:00:00Z"),
    );
  });

  it("byRuleType aggregates all three days", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byRuleType[0].violationCount, 3);
    assert.equal(summary.byRuleType[0].tradingDays.length, 3);
  });
});

// ── Multiple rules on the same day ────────────────────────────────────────────

describe("multiple rules on the same trading day", () => {
  const rows = [
    makeRow({ ruleType: "trade_limit", observedCount: 2 }),
    makeRow({ ruleType: "daily_loss_limit", thresholdCount: null, thresholdAmount: 500, observedAmount: -600, observedCount: null }),
    makeRow({ ruleType: "max_loss_streak", thresholdCount: 3, observedCount: 4, observedAmount: null }),
  ];

  it("byTradingDay shows all three rule types for the day", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byTradingDay.length, 1);
    assert.equal(summary.byTradingDay[0].ruleTypes.length, 3);
    assert.ok(summary.byTradingDay[0].ruleTypes.includes("trade_limit"));
    assert.ok(summary.byTradingDay[0].ruleTypes.includes("daily_loss_limit"));
    assert.ok(summary.byTradingDay[0].ruleTypes.includes("max_loss_streak"));
  });

  it("byAccountAndRule has one entry per rule type", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byAccountAndRule.length, 3);
    const ruleTypes = summary.byAccountAndRule.map((e) => e.ruleType);
    assert.ok(ruleTypes.includes("trade_limit"));
    assert.ok(ruleTypes.includes("daily_loss_limit"));
    assert.ok(ruleTypes.includes("max_loss_streak"));
  });

  it("byRuleType has one entry per rule type, sorted by violationCount desc", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byRuleType.length, 3);
    // All have count=1, order is by count (ties may be in any order)
    const ruleTypes = summary.byRuleType.map((r) => r.ruleType);
    assert.ok(ruleTypes.includes("trade_limit"));
    assert.ok(ruleTypes.includes("daily_loss_limit"));
    assert.ok(ruleTypes.includes("max_loss_streak"));
  });

  it("daily_loss_limit entry uses thresholdAmount", () => {
    const summary = buildViolationSummary(rows);
    const lossEntry = summary.byAccountAndRule.find((e) => e.ruleType === "daily_loss_limit");
    assert.ok(lossEntry, "daily_loss_limit entry must exist");
    assert.equal(lossEntry.threshold, 500);
    assert.equal(lossEntry.latestObservedAmount, -600);
    assert.equal(lossEntry.latestObservedCount, null);
  });
});

// ── Multiple accounts same day ────────────────────────────────────────────────

describe("multiple accounts on the same day", () => {
  const rows = [
    makeRow({ accountId: "acct_A", accountLabel: "DEMO_A" }),
    makeRow({ accountId: "acct_B", accountLabel: "DEMO_B" }),
  ];

  it("byTradingDay lists both accounts", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byTradingDay[0].accounts.length, 2);
    assert.ok(summary.byTradingDay[0].accounts.includes("DEMO_A"));
    assert.ok(summary.byTradingDay[0].accounts.includes("DEMO_B"));
  });

  it("byAccountAndRule has a separate entry per account", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byAccountAndRule.length, 2);
    const ids = summary.byAccountAndRule.map((e) => e.accountId);
    assert.ok(ids.includes("acct_A"));
    assert.ok(ids.includes("acct_B"));
  });

  it("byRuleType lists both accounts as affected", () => {
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byRuleType[0].affectedAccounts.length, 2);
  });
});

// ── Dedup: same account+rule+day row counted once ────────────────────────────

describe("dedup: same account+rule+day is one row", () => {
  it("a single row per dedupKey is counted as 1 violation not 2", () => {
    // The DB enforces unique dedupKey, so there will only ever be one row
    // per account+rule+day. Confirm the helpers don't double-count.
    const row = makeRow();
    const summary = buildViolationSummary([row]);
    assert.equal(summary.totalViolations, 1);
    assert.equal(summary.byAccountAndRule[0].daysWithViolation, 1);
  });
});

// ── byTradingDay ordering ─────────────────────────────────────────────────────

describe("byTradingDay is sorted newest first", () => {
  it("most recent trading day appears first", () => {
    const rows = [
      makeRow({ tradingDay: "2026-05-10" }),
      makeRow({ tradingDay: "2026-05-15" }),
      makeRow({ tradingDay: "2026-05-12" }),
    ];
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byTradingDay[0].tradingDay, "2026-05-15");
    assert.equal(summary.byTradingDay[2].tradingDay, "2026-05-10");
  });
});

// ── byAccountAndRule ordering ─────────────────────────────────────────────────

describe("byAccountAndRule is sorted by lastUpdatedAt desc", () => {
  it("most recently updated entry appears first", () => {
    const rows = [
      makeRow({ accountId: "acct_A", ruleType: "trade_limit", updatedAt: new Date("2026-05-15T10:00:00Z") }),
      makeRow({ accountId: "acct_A", ruleType: "max_loss_streak", thresholdCount: 3, observedCount: 4, updatedAt: new Date("2026-05-15T12:00:00Z") }),
    ];
    const summary = buildViolationSummary(rows);
    assert.equal(summary.byAccountAndRule[0].ruleType, "max_loss_streak");
  });
});

// ── accountLabel fallback ─────────────────────────────────────────────────────

describe("accountLabel fallback", () => {
  it("falls back to accountId when label is null", () => {
    const row = makeRow({ accountLabel: null });
    const summary = buildViolationSummary([row]);
    assert.equal(summary.byTradingDay[0].accounts[0], "acct_A");
    assert.equal(summary.byRuleType[0].affectedAccounts[0], "acct_A");
  });
});
