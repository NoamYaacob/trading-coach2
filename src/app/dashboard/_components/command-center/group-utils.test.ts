import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCommandCenterGroups, filterAccountsByType, filterExpiredGroups, recomputeGroupAggregates } from "./group-utils.ts";
import type { CommandCenterAccount } from "./types.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function stubAccount(overrides: Partial<CommandCenterAccount>): CommandCenterAccount {
  return {
    id: "stub",
    label: "Stub Account",
    primaryLabel: "Stub Account",
    secondaryMeta: null,
    rawLabel: "Stub Account",
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
    permissionLevel: null,
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
    listenerStatus: null,
    listenerLastEventAt: null,
    listenerLastHeartbeatAt: null,
    listenerLastCloseCode: null,
    listenerLastCloseReason: null,
    hasMaxPositionSize: false,
    rawBrokerHardLimitEnabled: false,
    balanceLimitedWarning: false,
    balanceUnavailableForBudget: false,
    propFirmSetupNeeded: false,
    propFirmLimited: false,
    setupNeededReason: null,
    breachReason: null,
    internalLockActive: false,
    lastInternalLockAt: null,
    brokerConnectionId: null,
    brokerEnv: null,
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

  // 6. SAFETY: personal accounts on different broker connections stay in separate
  //    groups, regardless of platform. Without this, two distinct Tradovate
  //    logins would silently merge into one "Tradovate · Personal" card and
  //    individual account rows would lose their broker-login provenance.
  it("personal accounts on different broker connections stay in separate groups (multi-login safety)", () => {
    const accounts = [
      stubAccount({
        id: "login-a-account",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-login-a",
        accountType: "personal",
      }),
      stubAccount({
        id: "login-b-account",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "conn-login-b",
        accountType: "personal",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 2, "two distinct logins → two distinct groups");
    const groupIds = groups.map((g) => g.groupId).sort();
    assert.deepEqual(
      groupIds,
      ["__personal_broker__::conn-login-a", "__personal_broker__::conn-login-b"],
      "groupIds include brokerConnectionId so unrelated logins are never confused",
    );
  });

  // 6b. personal live and demo on different connections also stay separate.
  //     Tradovate authorises live and demo as separate OAuth grants, so each
  //     is its own BrokerConnection. We do NOT silently merge them since
  //     there is no reliable per-Tradovate-user identifier shared across
  //     OAuth tokens to confirm "same human user". The labels are env-
  //     suffixed so the two cards are visibly distinguishable.
  it("personal live and demo (different broker connections) stay separate with env-suffixed labels", () => {
    const accounts = [
      stubAccount({
        id: "live",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "live-conn",
        brokerEnv: "live",
        accountType: "personal",
      }),
      stubAccount({
        id: "demo",
        firmKey: PERSONAL_KEY,
        firmLabel: "Tradovate · Personal",
        platform: "tradovate",
        brokerConnectionId: "demo-conn",
        brokerEnv: "demo",
        accountType: "demo",
      }),
    ];
    const groups = buildCommandCenterGroups(accounts, STANDARD_SINK_KEYS);
    assert.equal(groups.length, 2, "live + demo on separate connections → two groups");
    const groupIds = new Set(groups.map((g) => g.groupId));
    assert.equal(groupIds.size, 2, "groupIds are distinct");

    const labels = groups.map((g) => g.firmLabel).sort();
    assert.deepEqual(
      labels,
      ["Tradovate · Personal · Demo", "Tradovate · Personal · Live"],
      "personal/unassigned groups gain a · Live / · Demo suffix when env is known",
    );
  });

  // 6c. personal accounts on DIFFERENT platforms remain separate.
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

  // 8. propFirm + funded → grouped under propFirm (propFirm wins regardless of accountType)
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

// ── Env disambiguation for sink groups ────────────────────────────────────────
// Tradovate has no stable cross-environment user identifier, so live and demo
// OAuth grants for the same human render as separate cards. To make the two
// cards visibly distinct (instead of two indistinguishable "Tradovate ·
// Personal" rows) we append `· Live` / `· Demo` to the firmLabel — but only
// for sink groups (personal / unassigned). Prop firm labels are already
// distinctive and stay untouched.

describe("env disambiguation for sink groups", () => {
  it("appends · Live to a personal group whose connection env is 'live'", () => {
    const [group] = buildCommandCenterGroups(
      [
        stubAccount({
          id: "p1",
          firmKey: PERSONAL_KEY,
          firmLabel: "Tradovate · Personal",
          brokerConnectionId: "conn-a",
          brokerEnv: "live",
          accountType: "personal",
        }),
      ],
      STANDARD_SINK_KEYS,
    );
    assert.equal(group.firmLabel, "Tradovate · Personal · Live");
    assert.equal(group.brokerEnv, "live");
  });

  it("appends · Demo to a personal group whose connection env is 'demo'", () => {
    const [group] = buildCommandCenterGroups(
      [
        stubAccount({
          id: "p1",
          firmKey: PERSONAL_KEY,
          firmLabel: "Tradovate · Personal",
          brokerConnectionId: "conn-a",
          brokerEnv: "demo",
          accountType: "demo",
        }),
      ],
      STANDARD_SINK_KEYS,
    );
    assert.equal(group.firmLabel, "Tradovate · Personal · Demo");
  });

  it("does not append a suffix when env is unknown (e.g. manual or pre-multi-connection rows)", () => {
    const [group] = buildCommandCenterGroups(
      [
        stubAccount({
          id: "p1",
          firmKey: PERSONAL_KEY,
          firmLabel: "Tradovate · Personal",
          brokerConnectionId: null,
          brokerEnv: null,
          accountType: "personal",
        }),
      ],
      STANDARD_SINK_KEYS,
    );
    assert.equal(group.firmLabel, "Tradovate · Personal");
    assert.equal(group.brokerEnv, null);
  });

  it("does not append a suffix to prop firm labels regardless of env", () => {
    const [group] = buildCommandCenterGroups(
      [
        stubAccount({
          id: "f1",
          firmKey: "myfundedfutures",
          firmLabel: "MyFundedFutures",
          brokerConnectionId: "conn-a",
          brokerEnv: "live",
          accountType: "funded",
        }),
      ],
      STANDARD_SINK_KEYS,
    );
    assert.equal(group.firmLabel, "MyFundedFutures");
  });

  it("ignores unknown env values (defensive — no suffix if Tradovate ever returns something new)", () => {
    const [group] = buildCommandCenterGroups(
      [
        stubAccount({
          id: "p1",
          firmKey: PERSONAL_KEY,
          firmLabel: "Tradovate · Personal",
          brokerConnectionId: "conn-a",
          brokerEnv: "sandbox",
          accountType: "personal",
        }),
      ],
      STANDARD_SINK_KEYS,
    );
    assert.equal(group.firmLabel, "Tradovate · Personal");
  });
});

// ── recomputeGroupAggregates — filtered group header totals ───────────────────
// When a status filter hides some rows, the group header must reflect only
// the accounts currently visible, not the full unfiltered group.
// Tests 15-20 from the spec.

describe("recomputeGroupAggregates", () => {
  // Test 15: Unavailable filter hides locked account, group header must not include its P&L/budget
  it("filtering to unavailable excludes locked-account P&L and budget from header", () => {
    const lockedAccount = stubAccount({
      id: "locked",
      brokerConnectionId: "conn-a",
      status: "locked",
      dailyPnl: -1001,
      remainingDailyLoss: 0,
    });
    const unavailableAccount = stubAccount({
      id: "unavail",
      brokerConnectionId: "conn-a",
      status: "unavailable",
      dailyPnl: -500, // stale — must be excluded (unavailable rule)
      remainingDailyLoss: 200, // stale
    });
    const [group] = buildCommandCenterGroups([lockedAccount, unavailableAccount], NO_SINK_KEYS);

    // Only the unavailable row is visible after filtering
    const filtered = recomputeGroupAggregates(group, [unavailableAccount]);

    // Test 15: locked account's -$1,001 must not appear in the unavailable-filtered header
    assert.equal(filtered.totalDailyPnl, 0, "locked account P&L must be excluded from filter view");
    assert.equal(filtered.hasPnlData, false, "unavailable account P&L is stale and excluded");
    assert.equal(filtered.totalRiskRemaining, 0);
    assert.equal(filtered.hasRiskData, false);
  });

  // Test 16: Filtering to Locked reflects only locked row's data
  it("filtering to locked shows only the locked row's P&L and budget", () => {
    const lockedAccount = stubAccount({
      id: "locked",
      brokerConnectionId: "conn-a",
      status: "locked",
      dailyPnl: -1001,
      remainingDailyLoss: 0,
    });
    const unavailableAccount = stubAccount({
      id: "unavail",
      brokerConnectionId: "conn-a",
      status: "unavailable",
      dailyPnl: -500,
      remainingDailyLoss: 200,
    });
    const [group] = buildCommandCenterGroups([lockedAccount, unavailableAccount], NO_SINK_KEYS);

    const filtered = recomputeGroupAggregates(group, [lockedAccount]);

    assert.equal(filtered.totalDailyPnl, -1001);
    assert.equal(filtered.hasPnlData, true);
    assert.equal(filtered.totalRiskRemaining, 0);
  });

  // Test 17: Group header account count equals visible rows
  it("group header accounts length equals the visible rows after filtering", () => {
    const a = stubAccount({ id: "a", brokerConnectionId: "conn-a", status: "allowed" });
    const b = stubAccount({ id: "b", brokerConnectionId: "conn-a", status: "locked" });
    const [group] = buildCommandCenterGroups([a, b], NO_SINK_KEYS);

    const filtered = recomputeGroupAggregates(group, [b]);

    assert.equal(filtered.accounts.length, 1, "header must count only the visible locked row");
    assert.equal(filtered.counts.locked, 1);
    assert.equal(filtered.counts.allowed, 0);
  });

  // Test 18: Group header shows P&L placeholder (hasPnlData=false) for unavailable-only filter
  it("shows P&L placeholder for unavailable-only visible accounts", () => {
    const unavailableAccount = stubAccount({
      id: "unavail",
      brokerConnectionId: "conn-a",
      status: "unavailable",
      dailyPnl: -300,
      remainingDailyLoss: 500,
    });
    const [group] = buildCommandCenterGroups([unavailableAccount], NO_SINK_KEYS);

    const filtered = recomputeGroupAggregates(group, [unavailableAccount]);

    assert.equal(filtered.hasPnlData, false, "unavailable P&L is stale — header shows '—'");
    assert.equal(filtered.hasRiskData, false, "unavailable budget is stale — header shows '—'");
  });

  // Test 20: "All" filter path — when statusFilter = "all", recompute is not called;
  // original group totals (which equal a full recompute) remain accurate.
  it("full group passed unchanged matches a fresh recompute (all-filter parity)", () => {
    const a = stubAccount({ id: "a", brokerConnectionId: "conn-a", status: "allowed", dailyPnl: 400, remainingDailyLoss: 600 });
    const b = stubAccount({ id: "b", brokerConnectionId: "conn-a", status: "locked", dailyPnl: -200, remainingDailyLoss: 0 });
    const [group] = buildCommandCenterGroups([a, b], NO_SINK_KEYS);

    const recomputed = recomputeGroupAggregates(group, [a, b]);

    assert.equal(recomputed.totalDailyPnl, group.totalDailyPnl, "full recompute matches original");
    assert.equal(recomputed.totalRiskRemaining, group.totalRiskRemaining, "full recompute matches original");
    assert.equal(recomputed.hasPnlData, group.hasPnlData);
  });

  // Mixed: allowed + unavailable — only allowed contributes to totals
  it("in a mixed visible set, only non-unavailable accounts contribute to totals", () => {
    const a = stubAccount({ id: "a", brokerConnectionId: "conn-a", status: "allowed", dailyPnl: 100, remainingDailyLoss: 900 });
    const u = stubAccount({ id: "u", brokerConnectionId: "conn-a", status: "unavailable", dailyPnl: -999, remainingDailyLoss: 0 });
    const [group] = buildCommandCenterGroups([a, u], NO_SINK_KEYS);

    const filtered = recomputeGroupAggregates(group, [a, u]);

    assert.equal(filtered.totalDailyPnl, 100, "unavailable stale P&L excluded");
    assert.equal(filtered.totalRiskRemaining, 900);
  });
});

// ── Account type filter — filterAccountsByType ────────────────────────────────
// Tests 1-10 from the "Add dashboard filtering by account type" spec.

describe("filterAccountsByType", () => {
  // Test 1: TYPE_FILTERS option labels contract — no raw enum values exposed in the UI.
  // These are the exact user-facing strings the TYPE select must show.
  it("TYPE_FILTERS option labels use display strings, not raw enum values (test 1 + 9)", () => {
    const EXPECTED_OPTIONS = [
      { value: "all", label: "All types" },
      { value: "evaluation", label: "Evaluation" },
      { value: "funded", label: "Funded" },
      { value: "personal", label: "Live / Personal" },
      { value: "demo", label: "Demo" },
    ];
    const labels = EXPECTED_OPTIONS.map((o) => o.label);
    assert.ok(labels.includes("All types"), "must have 'All types'");
    assert.ok(labels.includes("Evaluation"), "must have 'Evaluation'");
    assert.ok(labels.includes("Funded"), "must have 'Funded'");
    assert.ok(labels.includes("Live / Personal"), "must use 'Live / Personal', not raw 'personal'");
    assert.ok(labels.includes("Demo"), "must have 'Demo'");
    // Test 9: raw enum values are not used as labels
    assert.ok(!labels.includes("personal"), "must not show raw 'personal'");
    assert.ok(!labels.includes("demo"), "must not show raw 'demo'");
    assert.ok(!labels.includes("evaluation"), "must not show raw 'evaluation'");
    assert.ok(!labels.includes("funded"), "must not show raw 'funded'");
  });

  // Test 2: Type = Evaluation shows only evaluation accounts
  it("'evaluation' filter returns only evaluation accounts (test 2)", () => {
    const accounts = [
      stubAccount({ id: "e1", accountType: "evaluation" }),
      stubAccount({ id: "f1", accountType: "funded" }),
      stubAccount({ id: "p1", accountType: "personal" }),
      stubAccount({ id: "d1", accountType: "demo" }),
    ];
    const result = filterAccountsByType(accounts, "evaluation");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e1");
    assert.ok(result.every((a) => a.accountType === "evaluation"));
  });

  // Test 3: Type = Demo shows only demo accounts
  it("'demo' filter returns only demo accounts (test 3)", () => {
    const accounts = [
      stubAccount({ id: "e1", accountType: "evaluation" }),
      stubAccount({ id: "d1", accountType: "demo" }),
      stubAccount({ id: "d2", accountType: "demo" }),
    ];
    const result = filterAccountsByType(accounts, "demo");
    assert.equal(result.length, 2);
    assert.ok(result.every((a) => a.accountType === "demo"));
  });

  // Test 4: Type = Live / Personal shows only personal accounts (value = "personal")
  it("'personal' filter returns only personal-type accounts (test 4)", () => {
    const accounts = [
      stubAccount({ id: "p1", accountType: "personal" }),
      stubAccount({ id: "p2", accountType: "personal" }),
      stubAccount({ id: "f1", accountType: "funded" }),
    ];
    const result = filterAccountsByType(accounts, "personal");
    assert.equal(result.length, 2);
    assert.ok(result.every((a) => a.accountType === "personal"));
  });

  it("'all' filter returns all accounts unchanged", () => {
    const accounts = [
      stubAccount({ id: "e1", accountType: "evaluation" }),
      stubAccount({ id: "f1", accountType: "funded" }),
      stubAccount({ id: "p1", accountType: "personal" }),
    ];
    const result = filterAccountsByType(accounts, "all");
    assert.equal(result.length, 3);
    assert.equal(result, accounts, "same reference when no filtering needed");
  });

  it("returns empty array when no accounts match the type filter", () => {
    const accounts = [
      stubAccount({ id: "e1", accountType: "evaluation" }),
      stubAccount({ id: "f1", accountType: "funded" }),
    ];
    const result = filterAccountsByType(accounts, "demo");
    assert.equal(result.length, 0);
  });

  // Test 5: Type filter combines with status filter
  // Simulates the compound filtering in filteredGroups memo:
  // first status filter, then type filter on the resulting subset.
  it("type filter compounds with status filter — only matching rows survive both (test 5)", () => {
    const accounts = [
      stubAccount({ id: "eval-allowed", accountType: "evaluation", status: "allowed" }),
      stubAccount({ id: "eval-locked", accountType: "evaluation", status: "locked" }),
      stubAccount({ id: "funded-allowed", accountType: "funded", status: "allowed" }),
      stubAccount({ id: "funded-locked", accountType: "funded", status: "locked" }),
    ];
    // statusFilter = "locked", typeFilter = "evaluation"
    const afterStatus = accounts.filter((a) => a.status === "locked");
    const afterType = filterAccountsByType(afterStatus, "evaluation");
    assert.equal(afterType.length, 1);
    assert.equal(afterType[0].id, "eval-locked");
  });

  // Test 6: Type filter combines with firm filter
  // Firm filter operates at the group level (drops whole groups); type filter
  // then narrows within the remaining groups.
  it("type filter within a firm-filtered group yields only matching accounts (test 6)", () => {
    const mffAccounts = [
      stubAccount({ id: "mff-eval", firmKey: "myfundedfutures", accountType: "evaluation", brokerConnectionId: "conn-a" }),
      stubAccount({ id: "mff-funded", firmKey: "myfundedfutures", accountType: "funded", brokerConnectionId: "conn-a" }),
    ];
    const apexAccounts = [
      stubAccount({ id: "apex-eval", firmKey: "apextraderfunding", accountType: "evaluation", brokerConnectionId: "conn-b" }),
    ];
    const groups = buildCommandCenterGroups([...mffAccounts, ...apexAccounts], NO_SINK_KEYS);

    // Simulate: firmFilter = "myfundedfutures", typeFilter = "funded"
    const firmFiltered = groups.filter((g) => g.firmKey === "myfundedfutures");
    const result = firmFiltered.map((g) => filterAccountsByType(g.accounts, "funded")).flat();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "mff-funded");
  });

  // Test 7: Group aggregates recompute from visible accounts after type filtering
  it("group aggregates reflect only the type-filtered accounts (test 7)", () => {
    const evalAccount = stubAccount({
      id: "eval",
      brokerConnectionId: "conn-a",
      accountType: "evaluation",
      status: "allowed",
      dailyPnl: -500,
      remainingDailyLoss: 500,
    });
    const fundedAccount = stubAccount({
      id: "funded",
      brokerConnectionId: "conn-a",
      accountType: "funded",
      status: "allowed",
      dailyPnl: 200,
      remainingDailyLoss: 800,
    });
    const [group] = buildCommandCenterGroups([evalAccount, fundedAccount], NO_SINK_KEYS);
    assert.equal(group.totalDailyPnl, -300, "original group sums both accounts");

    const typeFiltered = filterAccountsByType(group.accounts, "evaluation");
    const recomputed = recomputeGroupAggregates(group, typeFiltered);

    assert.equal(recomputed.accounts.length, 1, "only evaluation account visible");
    assert.equal(recomputed.totalDailyPnl, -500, "P&L from funded account excluded");
    assert.equal(recomputed.totalRiskRemaining, 500, "risk budget from funded account excluded");
  });

  // Test 8: Unavailable + type filter: locked account P&L must not bleed into group header
  it("unavailable filter + type filter does not include locked-account P&L in group header (test 8)", () => {
    const lockedEval = stubAccount({
      id: "locked-eval",
      brokerConnectionId: "conn-a",
      accountType: "evaluation",
      status: "locked",
      dailyPnl: -1200,
      remainingDailyLoss: 0,
    });
    const unavailFunded = stubAccount({
      id: "unavail-funded",
      brokerConnectionId: "conn-a",
      accountType: "funded",
      status: "unavailable",
      dailyPnl: -300, // stale — excluded by unavailable rule
      remainingDailyLoss: 100,
    });
    const [group] = buildCommandCenterGroups([lockedEval, unavailFunded], NO_SINK_KEYS);

    // statusFilter = "unavailable", typeFilter = "funded"
    const afterStatus = group.accounts.filter((a) => a.status === "unavailable");
    const afterType = filterAccountsByType(afterStatus, "funded");
    const recomputed = recomputeGroupAggregates(group, afterType);

    // locked eval P&L (-$1,200) must NOT appear; unavail funded P&L is stale (excluded by rule)
    assert.equal(recomputed.totalDailyPnl, 0, "locked P&L excluded; unavailable P&L is stale");
    assert.equal(recomputed.hasPnlData, false, "no data for unavailable-filtered group");
    assert.equal(recomputed.accounts.length, 1, "only the unavailable funded row is visible");
  });
});

// ── filterExpiredGroups — expired-connection banner gate ──────────────────────
// The banner fires only when:
//   (a) the group's connection is expired/error,
//   (b) at least one account has missingFromBrokerSince === null (not confirmed
//       gone from broker), AND
//   (c) no other group already has a healthy connection for the same brokerEnv.
//
// Condition (c) addresses the production bug: MFFU accounts with
// connectionStatus="expired" and missingFromBrokerSince=null (no sync has run
// since the old BC expired to confirm they're gone) still get status:
// "not_connected" in the Dashboard, passing the old (a)+(b) check. But when
// the user already has an active Demo connection, the old expired Demo group
// is irrelevant — the banner is noise. Settings shows the reconnect option
// there if the user truly needs it.

describe("filterExpiredGroups — expired connection banner gate", () => {

  // ── 1. All accounts have missingFromBrokerSince set → no banner ──────────────
  it("suppresses banner when all expired-group accounts have missingFromBrokerSince set", () => {
    const gone = stubAccount({
      id: "mffu-old-1",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "old-demo-bc",
      brokerEnv: "demo",
      connectionStatus: "expired",
      status: "unavailable",
      missingFromBrokerSince: new Date("2026-04-01T12:00:00Z"),
    });
    const [expiredGroup] = buildCommandCenterGroups([gone], NO_SINK_KEYS);
    assert.equal(expiredGroup.connectionStatus, "expired");

    const result = filterExpiredGroups([expiredGroup]);
    assert.equal(result.length, 0, "all-unavailable → no banner");
  });

  // ── 2. Multiple unavailable MFFU accounts → no banner ────────────────────────
  it("suppresses banner when multiple unavailable accounts share the expired group", () => {
    const makeUnavail = (id: string) =>
      stubAccount({
        id,
        firmKey: "myfundedfutures",
        firmLabel: "MyFundedFutures",
        brokerConnectionId: "old-demo-bc",
        brokerEnv: "demo",
        connectionStatus: "expired",
        status: "unavailable",
        missingFromBrokerSince: new Date("2026-04-01T12:00:00Z"),
      });

    const groups = buildCommandCenterGroups(
      [makeUnavail("m1"), makeUnavail("m2"), makeUnavail("m3")],
      NO_SINK_KEYS,
    );
    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 0, "three unavailable → banner suppressed");
  });

  // ── 3. Isolated expired group with recoverable accounts, no healthy same-env → banner ──
  // Expired group with missingFromBrokerSince=null accounts, no healthy connection
  // for the same env: reconnecting would restore sync. Banner MUST show.
  it("shows banner for isolated expired group with recoverable account (no healthy same-env)", () => {
    const expiredActive = stubAccount({
      id: "live-acct",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "expired-bc",
      brokerEnv: "live",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });
    const [group] = buildCommandCenterGroups([expiredActive], NO_SINK_KEYS);

    const result = filterExpiredGroups([group]);
    assert.equal(result.length, 1, "recoverable account + no healthy same-env → banner fires");
    assert.equal(result[0].brokerConnectionId, "expired-bc");
  });

  // ── 4. Expired Demo group + healthy Demo group → no banner ────────────────────
  // This is the key fix for the production bug. MFFU accounts with
  // missingFromBrokerSince=null (not "unavailable") are on an old expired Demo BC.
  // The user has a new active Demo BC (DEMO7433035). Banner must be suppressed
  // because the old grant is no longer the active one for that env.
  it("suppresses banner for expired Demo group when a healthy Demo group already exists", () => {
    const STANDARD_SINK_KEYS = new Set(["__personal_broker__", "__unassigned__"]);

    const activeDemo = stubAccount({
      id: "DEMO7433035",
      firmKey: "__personal_broker__",
      firmLabel: "Tradovate · Personal",
      brokerConnectionId: "active-demo-bc",
      brokerEnv: "demo",
      accountType: "demo",
      connectionStatus: "connected_readonly",
      status: "allowed",
      missingFromBrokerSince: null,
    });
    // Old MFFU account: missingFromBrokerSince is null (no sync confirmed it gone),
    // so status is "not_connected" — not "unavailable". The old (b)-only check
    // would incorrectly show the banner; the new (c) check suppresses it.
    const oldMFFF = stubAccount({
      id: "MFFU-133936249",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "old-expired-demo-bc",
      brokerEnv: "demo",
      accountType: "evaluation",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });

    const groups = buildCommandCenterGroups([activeDemo, oldMFFF], STANDARD_SINK_KEYS);
    assert.equal(groups.length, 2);

    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 0,
      "healthy Demo group suppresses expired Demo group even when MFFU has missingFromBrokerSince=null");
  });

  // ── 5. Expired Demo + healthy Demo, MFFU unavailable → no banner ─────────────
  // Same as scenario 4 but MFFU accounts DO have missingFromBrokerSince set.
  // Both conditions (b) and (c) independently suppress the banner.
  it("suppresses expired Demo banner when MFFU accounts are unavailable AND healthy Demo exists", () => {
    const STANDARD_SINK_KEYS = new Set(["__personal_broker__", "__unassigned__"]);

    const activeDemo = stubAccount({
      id: "DEMO7433035",
      firmKey: "__personal_broker__",
      firmLabel: "Tradovate · Personal",
      brokerConnectionId: "active-demo-bc",
      brokerEnv: "demo",
      connectionStatus: "connected_readonly",
      status: "allowed",
      missingFromBrokerSince: null,
    });
    const unavailMFFF = stubAccount({
      id: "MFFU-old",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "old-expired-demo-bc",
      brokerEnv: "demo",
      connectionStatus: "expired",
      status: "unavailable",
      missingFromBrokerSince: new Date("2026-04-15T12:00:00Z"),
    });

    const groups = buildCommandCenterGroups([activeDemo, unavailMFFF], STANDARD_SINK_KEYS);
    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 0, "no banner: MFFU unavailable + healthy Demo exists");
  });

  // ── 6. Expired Live group NOT suppressed by healthy Demo group ────────────────
  // The healthy Demo connection has a different brokerEnv. An expired Live
  // connection without a healthy Live alternative must still show the banner.
  it("expired live group is NOT suppressed by healthy demo group (different env)", () => {
    const STANDARD_SINK_KEYS = new Set(["__personal_broker__"]);

    const activeDemo = stubAccount({
      id: "demo-acct",
      firmKey: "__personal_broker__",
      firmLabel: "Tradovate · Personal",
      brokerConnectionId: "active-demo-bc",
      brokerEnv: "demo",
      accountType: "demo",
      connectionStatus: "connected_readonly",
      status: "allowed",
      missingFromBrokerSince: null,
    });
    const expiredLive = stubAccount({
      id: "live-acct",
      firmKey: "__personal_broker__",
      firmLabel: "Tradovate · Personal",
      brokerConnectionId: "expired-live-bc",
      brokerEnv: "live",
      accountType: "personal",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });

    const groups = buildCommandCenterGroups([activeDemo, expiredLive], STANDARD_SINK_KEYS);
    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 1, "expired live banner must show (no healthy live connection)");
    assert.equal(result[0].brokerEnv, "live");
  });

  // ── 7. connection_error treated the same as expired ───────────────────────────
  it("shows banner for isolated connection_error group with recoverable account", () => {
    const errorAcct = stubAccount({
      id: "error-acct",
      brokerConnectionId: "error-bc",
      brokerEnv: "live",
      connectionStatus: "connection_error",
      status: "not_connected",
      missingFromBrokerSince: null,
    });
    const [group] = buildCommandCenterGroups([errorAcct], NO_SINK_KEYS);
    const result = filterExpiredGroups([group]);
    assert.equal(result.length, 1, "connection_error with recoverable account → banner fires");
  });

  it("suppresses banner for connection_error group whose accounts are all unavailable", () => {
    const gone = stubAccount({
      id: "error-gone",
      brokerConnectionId: "error-bc",
      brokerEnv: "live",
      connectionStatus: "connection_error",
      status: "unavailable",
      missingFromBrokerSince: new Date("2026-04-01T12:00:00Z"),
    });
    const [group] = buildCommandCenterGroups([gone], NO_SINK_KEYS);
    const result = filterExpiredGroups([group]);
    assert.equal(result.length, 0, "all-unavailable connection_error → banner suppressed");
  });

  // ── 8. Healthy group is never included in expiredGroups ───────────────────────
  it("does not include healthy (connected_live / connected_readonly) groups in expired list", () => {
    const healthy = stubAccount({
      id: "live-1",
      brokerConnectionId: "active-bc",
      connectionStatus: "connected_live",
      status: "allowed",
      missingFromBrokerSince: null,
    });
    const [group] = buildCommandCenterGroups([healthy], NO_SINK_KEYS);
    const result = filterExpiredGroups([group]);
    assert.equal(result.length, 0, "healthy group must never appear in expiredGroups");
  });

  // ── 9. Mixed unavailable + recoverable, no healthy same-env → banner fires ────
  it("shows banner when at least one account is recoverable and no healthy same-env exists", () => {
    const gone = stubAccount({
      id: "gone",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "expired-bc",
      brokerEnv: "live",
      connectionStatus: "expired",
      status: "unavailable",
      missingFromBrokerSince: new Date("2026-04-01T12:00:00Z"),
    });
    const recoverable = stubAccount({
      id: "recoverable",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "expired-bc",
      brokerEnv: "live",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });
    const groups = buildCommandCenterGroups([gone, recoverable], NO_SINK_KEYS);
    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 1, "recoverable account + no healthy live conn → banner fires");
  });

  // ── 10. Production v2: both MFFU accounts have missingFromBrokerSince=null ────
  // The exact scenario from the second production report:
  //   - MFFUEVBLDR133936249 and MFFUEVBLDR133936250 show "Archived / inactive"
  //     in Settings (missingFromBrokerSince set there) but a second set of MFFU
  //     accounts (or the same ones before a sync) with missingFromBrokerSince=null
  //     still had status: "not_connected" in Dashboard, triggering the banner.
  //   - The user has a healthy Demo connection (DEMO7433035).
  //   - Banner must NOT fire.
  it("production scenario: active Demo + expired MFFU group (missingFromBrokerSince=null) → no banner", () => {
    const STANDARD_SINK_KEYS = new Set(["__personal_broker__", "__unassigned__"]);

    const activeDemo = stubAccount({
      id: "DEMO7433035",
      firmKey: "__personal_broker__",
      firmLabel: "Tradovate · Personal",
      brokerConnectionId: "active-demo-bc",
      brokerEnv: "demo",
      accountType: "demo",
      connectionStatus: "connected_readonly",
      status: "allowed",
      missingFromBrokerSince: null,
    });

    const mffu1 = stubAccount({
      id: "MFFUEVBLDR133936249",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "old-expired-demo-bc",
      brokerEnv: "demo",
      accountType: "evaluation",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });

    const mffu2 = stubAccount({
      id: "MFFUEVBLDR133936250",
      firmKey: "myfundedfutures",
      firmLabel: "MyFundedFutures",
      brokerConnectionId: "old-expired-demo-bc",
      brokerEnv: "demo",
      accountType: "evaluation",
      connectionStatus: "expired",
      status: "not_connected",
      missingFromBrokerSince: null,
    });

    const groups = buildCommandCenterGroups([activeDemo, mffu1, mffu2], STANDARD_SINK_KEYS);
    assert.equal(groups.length, 2, "personal demo group + MFFU group");

    const result = filterExpiredGroups(groups);
    assert.equal(result.length, 0,
      "expired MFFU group suppressed: healthy Demo connection already exists for same env");
  });
});
