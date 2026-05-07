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
      stubAccount({ id: "p1", firmKey: "__personal_broker__", firmLabel: "Tradovate · Personal", brokerConnectionId: null }),
      stubAccount({ id: "a1", firmKey: "myfundedfutures", firmLabel: "MyFundedFutures", brokerConnectionId: "conn-a" }),
    ];
    const groups = buildCommandCenterGroups(accounts, sinkKeys);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].firmLabel, "MyFundedFutures", "prop firm should sort before personal");
    assert.equal(groups[1].firmLabel, "Tradovate · Personal");
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

// ── Generic grouping rules ────────────────────────────────────────────────────
// These tests exercise the grouping contract using generic metadata only —
// no hardcoded account labels or IDs.  They mirror what deriveFirmKeyAndLabel
// produces and verify buildCommandCenterGroups handles all cases correctly.

const PERSONAL_KEY = "__personal_broker__";
const UNASSIGNED_KEY = "__unassigned__";
const STANDARD_SINK_KEYS = new Set([PERSONAL_KEY, UNASSIGNED_KEY]);

describe("generic grouping rules", () => {
  // 1. personal live + personal demo → one platform-labelled group
  it("personal-type live and demo-type accounts without prop firm group under one platform header", () => {
    const accounts = [
      stubAccount({
        id: "live-1",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        brokerConnectionId: "conn-a",
        accountType: "personal",
      }),
      stubAccount({
        id: "demo-1",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        brokerConnectionId: "conn-a",
        accountType: "demo",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 1, "live + demo → single group");
    assert.equal(groups[0].firmLabel, "Tradovate · Personal");
    assert.equal(groups[0].accounts.length, 2, "both accounts are present as separate rows");
  });

  // 2. multiple live accounts under the same connection remain separate rows
  it("multiple live accounts under the same broker connection remain separate rows in one group", () => {
    const accounts = [
      stubAccount({
        id: "live-1",
        firmKey: PERSONAL_KEY,
        firmLabel: "Personal accounts",
        brokerConnectionId: "conn-a",
        accountType: "personal",
        dailyPnl: 150,
      }),
      stubAccount({
        id: "live-2",
        firmKey: PERSONAL_KEY,
        firmLabel: "Personal accounts",
        brokerConnectionId: "conn-a",
        accountType: "personal",
        dailyPnl: -80,
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(group.accounts.length, 2, "two rows — accounts are never merged");
    // Each row retains its own identity
    const ids = group.accounts.map((a) => a.id).sort();
    assert.deepEqual(ids, ["live-1", "live-2"]);
  });

  // 3. multiple accounts from same prop firm group under the firm
  it("multiple accounts from the same prop firm are grouped under that firm", () => {
    const accounts = [
      stubAccount({ id: "eval-1", firmKey: "acmeprop", firmLabel: "AcmeProp", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "eval-2", firmKey: "acmeprop", firmLabel: "AcmeProp", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "eval-3", firmKey: "acmeprop", firmLabel: "AcmeProp", brokerConnectionId: "conn-a" }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(group.firmLabel, "AcmeProp");
    assert.equal(group.accounts.length, 3, "all three accounts in one group");
  });

  // 4. demo account under a prop firm groups with the firm, not with personal accounts
  it("demo/sim account with a prop firm is grouped under that firm, not under Personal accounts", () => {
    const accounts = [
      stubAccount({
        id: "funded-1",
        firmKey: "acmeprop",
        firmLabel: "AcmeProp",
        brokerConnectionId: "conn-a",
        accountType: "funded",
      }),
      stubAccount({
        id: "sim-1",
        firmKey: "acmeprop",
        firmLabel: "AcmeProp",
        brokerConnectionId: "conn-a",
        accountType: "demo",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(groups.length, 1, "funded + prop-firm demo → single group");
    assert.equal(groups[0].firmLabel, "AcmeProp");
    assert.equal(groups[0].accounts.length, 2);
  });

  // 5. account with unknown firm/category stays under "Unassigned firm"
  it("account with no prop firm and non-personal accountType falls into 'Unassigned firm'", () => {
    const accounts = [
      stubAccount({
        id: "mystery-1",
        firmKey: UNASSIGNED_KEY,
        firmLabel: "Unassigned firm",
        brokerConnectionId: null,
        accountType: "evaluation",
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(group.firmLabel, "Unassigned firm");
  });

  // 6. personal accounts on different broker connections within the same platform merge
  it("personal accounts on different broker connections for the same platform merge into one group", () => {
    const accounts = [
      stubAccount({
        id: "live-conn-a",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-a",
        accountType: "personal",
      }),
      stubAccount({
        id: "demo-conn-b",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-b",
        accountType: "demo",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 1, "same platform, different connections → one group");
    assert.equal(groups[0].accounts.length, 2, "both accounts remain as separate rows");
    assert.equal(groups[0].firmLabel, "Tradovate · Personal");
  });

  // 6b. personal accounts on DIFFERENT platforms remain separate
  it("personal accounts on different platforms stay in separate groups", () => {
    const accounts = [
      stubAccount({
        id: "tv-account",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-a",
      }),
      stubAccount({
        id: "tvw-account",
        firmKey: PERSONAL_KEY,
        firmLabel: "TradingView · Personal",
        platform: "tradingview",
        brokerConnectionId: "conn-b",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 2, "different platforms → separate groups");
    const platforms = groups.map((g) => g.platform).sort();
    assert.deepEqual(platforms, ["tradingview", "tradovate"]);
  });

  // 7. individual account data (P&L, trades, risk) is never merged across rows
  it("group totals are sums; individual account P&L / trade counts / losses are not blended", () => {
    const accounts = [
      stubAccount({
        id: "acct-a",
        brokerConnectionId: "conn-a",
        dailyPnl: 400,
        tradesCount: 3,
        consecutiveLosses: 1,
        remainingDailyLoss: 600,
      }),
      stubAccount({
        id: "acct-b",
        brokerConnectionId: "conn-a",
        dailyPnl: -150,
        tradesCount: 7,
        consecutiveLosses: 2,
        remainingDailyLoss: 350,
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, NO_SINK_KEYS);

    // Group aggregates
    assert.equal(group.totalDailyPnl, 250, "totalDailyPnl is the sum");
    assert.equal(group.totalRiskRemaining, 950, "totalRiskRemaining is the sum");

    // Individual rows are untouched
    const a = group.accounts.find((x) => x.id === "acct-a")!;
    const b = group.accounts.find((x) => x.id === "acct-b")!;
    assert.equal(a.dailyPnl, 400);
    assert.equal(b.dailyPnl, -150);
    assert.equal(a.tradesCount, 3);
    assert.equal(b.tradesCount, 7);
    assert.equal(a.consecutiveLosses, 1);
    assert.equal(b.consecutiveLosses, 2);
  });

  // 8. personal + demo on different connections but same platform → one merged group
  it("personal live and demo on different broker connections for the same platform merge", () => {
    const accounts = [
      stubAccount({
        id: "personal-conn-a",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-a",
        accountType: "personal",
      }),
      stubAccount({
        id: "demo-conn-b",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-b",
        accountType: "demo",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 1, "same platform → one merged group");
    assert.equal(groups[0].accounts.length, 2, "both rows preserved");
    assert.equal(groups[0].firmLabel, "Tradovate · Personal");
  });

  // 9. propFirm + funded → grouped under propFirm (propFirm wins regardless of accountType)
  it("funded account with propFirm is grouped under the prop firm, not Unassigned", () => {
    const accounts = [
      stubAccount({
        id: "eval-1",
        firmKey: "acmeprop",
        firmLabel: "AcmeProp",
        brokerConnectionId: "conn-a",
        accountType: "evaluation",
      }),
      stubAccount({
        id: "funded-1",
        firmKey: "acmeprop",
        firmLabel: "AcmeProp",
        brokerConnectionId: "conn-a",
        accountType: "funded",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, NO_SINK_KEYS);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].firmLabel, "AcmeProp");
    assert.equal(groups[0].accounts.length, 2);
  });

  // 10. funded/evaluation with no propFirm → "Unassigned firm", never "Personal accounts"
  it("funded account with no propFirm falls into 'Unassigned firm', not 'Personal accounts'", () => {
    const accounts = [
      stubAccount({
        id: "orphan-funded",
        firmKey: UNASSIGNED_KEY,
        firmLabel: "Unassigned firm",
        propFirm: null,
        brokerConnectionId: null,
        accountType: "funded",
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(group.firmLabel, "Unassigned firm");
    assert.notEqual(group.firmLabel, "Personal accounts");
  });

  // 11. unknown/future accountType with no propFirm → "Unassigned firm" (safe fallthrough)
  it("unrecognised accountType with no propFirm falls into 'Unassigned firm'", () => {
    const accounts = [
      stubAccount({
        id: "unknown-type",
        firmKey: UNASSIGNED_KEY,
        firmLabel: "Unassigned firm",
        propFirm: null,
        brokerConnectionId: null,
        accountType: "something_new",
      }),
    ];
    const [group] = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(group.firmLabel, "Unassigned firm");
    assert.notEqual(group.firmLabel, "Personal accounts");
  });
});
