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
    protectionStatus: "protected",
    pendingProtectionStatus: null,
    pendingProtectionEffectiveDate: null,
    missingFromBrokerSince: null,
    isLockedForToday: false,
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
});
