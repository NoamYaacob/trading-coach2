import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCommandCenterGroups } from "./group-utils.ts";
import type { CommandCenterAccount } from "./types.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stubAccount(overrides: Partial<CommandCenterAccount>): CommandCenterAccount {
  return {
    id: "stub",
    label: "Stub Account",
    platform: "tradovate",
    platformLabel: "Tradovate",
    propFirm: null,
    firmKey: "myfundedfutures",
    firmLabel: "MyFundedFutures",
    accountType: "evaluation",
    accountTypeLabel: "Evaluation",
    connectionStatus: "connected_live",
    connectionStatusLabel: "Connected",
    status: "allowed",
    enforcementMode: "broker_readonly",
    ruleSource: "account",
    rulesLabel: "Account rules",
    balance: null,
    openPnl: null,
    dailyPnl: null,
    maxDailyLoss: null,
    remainingDailyLoss: null,
    dailyLossUsedPct: null,
    tradesCount: null,
    tradesMayIncludePreConnection: false,
    tradeCountSource: "verified",
    maxTradesPerDay: null,
    tradesUsedPct: null,
    consecutiveLosses: null,
    stopAfterLosses: null,
    lastSyncAt: null,
    fillsSyncedAt: null,
    balanceLimitedWarning: false,
    balanceUnavailableForBudget: false,
    propFirmSetupNeeded: false,
    propFirmLimited: false,
    setupNeededReason: null,
    breachReason: null,
    brokerConnectionId: null,
    brokerLockStatus: null,
    lastInterventionTrigger: null,
    lastInterventionAt: null,
    hasOpenIntervention: false,
    flattenStatus: null,
    protectionStatus: "protected",
    pendingProtectionStatus: null,
    pendingProtectionEffectiveDate: null,
    missingFromBrokerSince: null,
    isLockedForToday: false,
    requiresAutomatedActionsConsent: false,
    ...overrides,
  };
}

const NO_SINK_KEYS = new Set<string>();

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("buildCommandCenterGroups", () => {
  it("merges accounts that share the same firm and broker connection", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "a2", brokerConnectionId: "conn-a" }),
    ];
    const groups = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].accounts.length, 2);
    assert.equal(groups[0].brokerConnectionId, "conn-a");
  });

  it("keeps accounts from the same prop firm on different broker connections in separate groups", () => {
    const accounts = [
      stubAccount({ id: "a1", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "a2", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "b1", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-b" }),
    ];
    const groups = buildCommandCenterGroups(accounts, NO_SINK_KEYS);

    assert.equal(groups.length, 2, "expected two groups, one per broker connection");

    const connIds = groups.map((g) => g.brokerConnectionId).sort();
    assert.deepEqual(connIds, ["conn-a", "conn-b"]);

    const connAGroup = groups.find((g) => g.brokerConnectionId === "conn-a");
    const connBGroup = groups.find((g) => g.brokerConnectionId === "conn-b");
    assert.ok(connAGroup, "conn-a group missing");
    assert.ok(connBGroup, "conn-b group missing");
    assert.equal(connAGroup.accounts.length, 2);
    assert.equal(connBGroup.accounts.length, 1);

    // Both groups still carry the same display firmLabel
    assert.equal(connAGroup.firmLabel, "MyFundedFutures");
    assert.equal(connBGroup.firmLabel, "MyFundedFutures");
  });

  it("keeps accounts from different prop firms separate even on the same connection", () => {
    const accounts = [
      stubAccount({ id: "a1", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "b1", firmKey: "lucid trading", firmLabel: "Lucid Trading", brokerConnectionId: "conn-a" }),
    ];
    const groups = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(groups.length, 2);
    const labels = groups.map((g) => g.firmLabel).sort();
    assert.deepEqual(labels, ["Lucid Trading", "MyFundedFutures"]);
  });

  it("sinks personal/manual firm keys to the bottom of the sorted list", () => {
    const sinkKeys = new Set(["__personal_broker__"]);
    const accounts = [
      stubAccount({ id: "p1", firmKey: "__personal_broker__", firmLabel: "Personal accounts", brokerConnectionId: null }),
      stubAccount({ id: "a1", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-a" }),
    ];
    const groups = buildCommandCenterGroups(accounts, sinkKeys);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].firmLabel, "MyFundedFutures", "prop firm should sort before personal");
    assert.equal(groups[1].firmLabel, "Personal accounts");
  });

  it("aggregates daily P&L across accounts in the same group", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", dailyPnl: 543 }),
      stubAccount({ id: "a2", brokerConnectionId: "conn-a", dailyPnl: -1050 }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.totalDailyPnl, -507);
    assert.equal(group.hasPnlData, true);
  });

  it("tracks the most recent lastSyncAt across accounts in the group", () => {
    const earlier = new Date("2026-05-04T14:00:00Z");
    const later = new Date("2026-05-04T14:20:00Z");
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", lastSyncAt: earlier }),
      stubAccount({ id: "a2", brokerConnectionId: "conn-a", lastSyncAt: later }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.deepEqual(group.lastSyncAt, later);
  });

  // ── Unavailable accounts must not pollute group totals ──────────────────
  // When an account is "unavailable" the broker no longer returns it, so any
  // cached balance/P&L/loss-budget is stale by definition. The row is kept
  // in the group (so the user sees it) but its numbers are excluded from
  // aggregates.

  it("excludes unavailable accounts from totalDailyPnl and totalRiskRemaining", () => {
    const accounts = [
      stubAccount({
        id: "live",
        brokerConnectionId: "conn-a",
        status: "allowed",
        dailyPnl: -200,
        remainingDailyLoss: 800,
      }),
      stubAccount({
        id: "gone",
        brokerConnectionId: "conn-a",
        status: "unavailable",
        dailyPnl: -1500, // stale — must NOT be summed
        remainingDailyLoss: 0, // stale — must NOT be summed
        missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.accounts.length, 2, "row is kept for visibility");
    assert.equal(group.totalDailyPnl, -200, "stale -1500 must be excluded");
    assert.equal(group.totalRiskRemaining, 800, "stale risk slot must be excluded");
    assert.equal(group.counts.allowed, 1);
    assert.equal(group.counts.unavailable, 1);
  });

  it("a group with only unavailable accounts has hasPnlData=false", () => {
    const accounts = [
      stubAccount({
        id: "gone",
        brokerConnectionId: "conn-a",
        status: "unavailable",
        dailyPnl: -300,
        remainingDailyLoss: 500,
        missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.hasPnlData, false);
    assert.equal(group.hasRiskData, false);
    assert.equal(group.totalDailyPnl, 0);
    assert.equal(group.totalRiskRemaining, 0);
  });
});

// ── Group header display: tradable count ──────────────────────────────────────
// Verifies that counts.allowed is the value driving the "N tradable" label in
// the firm group header. These tests cover the data layer; the view renders
// counts.allowed as "{n} tradable" (singular, no plural needed for the word
// "tradable" itself) and "{n} account(s)" for the account count.

describe("group header tradable count (counts.allowed)", () => {
  it("single allowed account → counts.allowed = 1 ('1 tradable')", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", status: "allowed" }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.accounts.length, 1);
    assert.equal(group.counts.allowed, 1, "1 account = 1 tradable");
  });

  it("two allowed accounts → counts.allowed = 2 ('2 tradable')", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", status: "allowed" }),
      stubAccount({ id: "a2", brokerConnectionId: "conn-a", status: "allowed" }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.accounts.length, 2);
    assert.equal(group.counts.allowed, 2, "2 accounts = 2 tradable");
  });

  it("locked account does not count as tradable", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", status: "allowed" }),
      stubAccount({ id: "a2", brokerConnectionId: "conn-a", status: "locked" }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.accounts.length, 2);
    assert.equal(group.counts.allowed, 1, "only allowed accounts are tradable");
    assert.equal(group.counts.locked, 1);
  });

  it("no allowed accounts → counts.allowed = 0 (header shows no tradable label)", () => {
    const accounts = [
      stubAccount({ id: "a1", brokerConnectionId: "conn-a", status: "locked" }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.counts.allowed, 0, "0 tradable — header must not show tradable label");
  });

  it("account pluralization: 1 account vs 2 accounts (separate from tradable)", () => {
    const one = buildCommandCenterGroups(
      [stubAccount({ id: "a1", brokerConnectionId: "conn-a" })],
      NO_SINK_KEYS,
    );
    const two = buildCommandCenterGroups(
      [
        stubAccount({ id: "b1", brokerConnectionId: "conn-b" }),
        stubAccount({ id: "b2", brokerConnectionId: "conn-b" }),
      ],
      NO_SINK_KEYS,
    );
    assert.equal(one[0].accounts.length, 1, "singular: 1 account");
    assert.equal(two[0].accounts.length, 2, "plural: 2 accounts");
  });
});
