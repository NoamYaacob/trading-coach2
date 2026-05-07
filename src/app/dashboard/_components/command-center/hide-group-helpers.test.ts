import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  applyHide,
  applyUnhide,
  buildHideRequest,
  buildUnhideRequest,
  partitionGroups,
} from "./hide-group-helpers.ts";
import type { CommandCenterAccount, CommandCenterFirmGroup } from "./types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stubAccount(overrides: Partial<CommandCenterAccount>): CommandCenterAccount {
  return {
    id: "stub",
    label: "Stub",
    platform: "tradovate",
    platformLabel: "Tradovate",
    propFirm: null,
    firmKey: "__personal_broker__",
    firmLabel: "Tradovate · Personal",
    accountType: "personal",
    accountTypeLabel: "Personal",
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

function stubGroup(
  overrides: Partial<CommandCenterFirmGroup> & { groupId: string },
): CommandCenterFirmGroup {
  const { groupId, ...rest } = overrides;
  return {
    groupId,
    firmKey: "__personal_broker__",
    firmLabel: "Tradovate · Personal",
    accounts: [stubAccount({ id: `${groupId}-a` })],
    counts: { allowed: 1, warning: 0, locked: 0, setup_needed: 0, not_connected: 0, unavailable: 0 },
    totalDailyPnl: 0,
    totalRiskRemaining: 0,
    hasPnlData: false,
    hasRiskData: false,
    platform: "tradovate",
    platformLabel: "Tradovate",
    connectionStatus: "connected_live",
    connectionStatusLabel: "Connected",
    brokerConnectionId: null,
    lastSyncAt: null,
    enforcementMode: "broker_readonly",
    ...rest,
  };
}

// ─── applyHide / applyUnhide ──────────────────────────────────────────────────

describe("applyHide / applyUnhide", () => {
  it("applyHide adds a new id and is idempotent", () => {
    const empty: string[] = [];
    const once = applyHide(empty, "g1");
    assert.deepEqual(once, ["g1"]);
    const twice = applyHide(once, "g1");
    assert.deepEqual(twice, ["g1"], "hiding the same id twice is a no-op");
  });

  it("applyUnhide removes an id and tolerates missing ids", () => {
    const both = ["g1", "g2"];
    const removed = applyUnhide(both, "g1");
    assert.deepEqual(removed, ["g2"]);
    const noop = applyUnhide(removed, "g99");
    assert.deepEqual(noop, ["g2"], "unhiding an id that wasn't hidden is a no-op");
  });

  it("applyHide does not mutate the input", () => {
    const input: readonly string[] = ["g1"];
    applyHide(input, "g2");
    assert.deepEqual(input, ["g1"], "input array is unchanged");
  });
});

// ─── partitionGroups ──────────────────────────────────────────────────────────

describe("partitionGroups", () => {
  it("requirement 1: hiding a personal group hides exactly that one rendered group", () => {
    // groupId is "__personal_broker__::<brokerConnectionId>" — see
    // group-utils.ts. Each rendered "Tradovate · Personal" card maps to one
    // groupId, so hiding by that id removes exactly that card.
    const personalLive = stubGroup({
      groupId: "__personal_broker__::live-conn",
      accounts: [stubAccount({ id: "live-row", accountType: "personal", dailyPnl: 100 })],
    });
    const propGroup = stubGroup({
      groupId: "acmeprop::conn-x",
      firmKey: "acmeprop",
      firmLabel: "AcmeProp",
    });
    const { visible, hidden } = partitionGroups(
      [personalLive, propGroup],
      new Set(["__personal_broker__::live-conn"]),
    );
    assert.equal(visible.length, 1, "only the prop firm group remains visible");
    assert.equal(visible[0].firmLabel, "AcmeProp");
    assert.equal(hidden.length, 1, "the personal group is in the hidden bucket");
    assert.equal(hidden[0].accounts.length, 1, "row preserved inside hidden group");
    assert.equal(hidden[0].accounts[0].id, "live-row");
  });

  it("multi-login safety: hiding one Tradovate login's personal group does NOT hide another login's group", () => {
    // Two distinct Tradovate authorisations — each its own BrokerConnection.
    // Both render as "Tradovate · Personal" but their groupIds carry the
    // broker connection id, so they are independent for hiding.
    const loginAGroup = stubGroup({
      groupId: "__personal_broker__::conn-login-a",
      firmLabel: "Tradovate · Personal",
      accounts: [stubAccount({ id: "login-a-account" })],
    });
    const loginBGroup = stubGroup({
      groupId: "__personal_broker__::conn-login-b",
      firmLabel: "Tradovate · Personal",
      accounts: [stubAccount({ id: "login-b-account" })],
    });
    const { visible, hidden } = partitionGroups(
      [loginAGroup, loginBGroup],
      new Set(["__personal_broker__::conn-login-a"]),
    );
    assert.equal(visible.length, 1, "login B is still visible");
    assert.equal(visible[0].groupId, "__personal_broker__::conn-login-b");
    assert.equal(visible[0].accounts[0].id, "login-b-account");
    assert.equal(hidden.length, 1, "only login A is hidden");
    assert.equal(hidden[0].groupId, "__personal_broker__::conn-login-a");
  });

  it("requirement 2: a hidden group is restored by removing its id from the set", () => {
    const group = stubGroup({ groupId: "g1" });
    const beforeRestore = partitionGroups([group], new Set(["g1"]));
    assert.equal(beforeRestore.visible.length, 0);
    assert.equal(beforeRestore.hidden.length, 1);

    const afterRestore = partitionGroups([group], new Set<string>());
    assert.equal(afterRestore.visible.length, 1);
    assert.equal(afterRestore.hidden.length, 0);
  });

  it("requirement 3: hiding does not merge or mutate accounts inside groups", () => {
    const original = stubGroup({
      groupId: "g1",
      accounts: [
        stubAccount({ id: "a", dailyPnl: 100, tradesCount: 2 }),
        stubAccount({ id: "b", dailyPnl: -75, tradesCount: 5 }),
      ],
    });
    const { hidden } = partitionGroups([original], new Set(["g1"]));
    const a = hidden[0].accounts.find((x) => x.id === "a")!;
    const b = hidden[0].accounts.find((x) => x.id === "b")!;
    assert.equal(a.dailyPnl, 100);
    assert.equal(b.dailyPnl, -75);
    assert.equal(a.tradesCount, 2);
    assert.equal(b.tradesCount, 5);
    assert.notEqual(a.id, b.id, "accounts retain their distinct IDs");
  });

  it("requirement 5: hidden group is excluded from visible list by default", () => {
    const visible = stubGroup({ groupId: "visible-g", firmLabel: "AcmeProp" });
    const hiddenG = stubGroup({ groupId: "hidden-g", firmLabel: "Tradovate · Personal" });
    const { visible: v, hidden: h } = partitionGroups(
      [visible, hiddenG],
      new Set(["hidden-g"]),
    );
    assert.equal(v.length, 1);
    assert.equal(v[0].firmLabel, "AcmeProp");
    assert.equal(h.length, 1);
    assert.equal(h[0].firmLabel, "Tradovate · Personal");
  });

  it("requirement 6: a group containing an unavailable account can still be hidden and unhidden", () => {
    const group = stubGroup({
      groupId: "broken-firm::conn-z",
      firmKey: "brokenfirm",
      firmLabel: "BrokenFirm",
      accounts: [
        stubAccount({
          id: "missing",
          status: "unavailable",
          missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
        }),
      ],
      counts: { allowed: 0, warning: 0, locked: 0, setup_needed: 0, not_connected: 0, unavailable: 1 },
    });
    const hiddenIds = applyHide([], group.groupId);
    const after = partitionGroups([group], new Set(hiddenIds));
    assert.equal(after.hidden.length, 1, "unavailable group can be hidden");
    assert.equal(after.hidden[0].accounts[0].status, "unavailable");
    const restored = partitionGroups([group], new Set(applyUnhide(hiddenIds, group.groupId)));
    assert.equal(restored.visible.length, 1, "unavailable group can be unhidden");
  });

  it("requirement 8: groupId is stable and not based on array index", () => {
    // Groups should be partitioned by their groupId regardless of array order.
    const a = stubGroup({ groupId: "alpha::conn-1", firmLabel: "Alpha" });
    const b = stubGroup({ groupId: "beta::conn-2", firmLabel: "Beta" });
    const orderA = partitionGroups([a, b], new Set(["alpha::conn-1"]));
    const orderB = partitionGroups([b, a], new Set(["alpha::conn-1"]));
    assert.equal(orderA.hidden[0].firmLabel, "Alpha");
    assert.equal(orderB.hidden[0].firmLabel, "Alpha", "same group hidden regardless of order");
    assert.equal(orderA.visible[0].firmLabel, "Beta");
    assert.equal(orderB.visible[0].firmLabel, "Beta");
  });

  it("requirement 9: no account labels or names are referenced by the partition logic", () => {
    // Hiding works purely from groupId, never from account.label.  Two groups
    // with identical labels but different groupIds must partition separately.
    const dupA = stubGroup({
      groupId: "dup::conn-a",
      firmLabel: "Same Label",
      accounts: [stubAccount({ id: "row-a", label: "DUPLICATE-LABEL-7777" })],
    });
    const dupB = stubGroup({
      groupId: "dup::conn-b",
      firmLabel: "Same Label",
      accounts: [stubAccount({ id: "row-b", label: "DUPLICATE-LABEL-7777" })],
    });
    const { visible, hidden } = partitionGroups([dupA, dupB], new Set(["dup::conn-a"]));
    assert.equal(visible.length, 1, "only the un-hidden group is visible despite same label");
    assert.equal(visible[0].groupId, "dup::conn-b");
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].groupId, "dup::conn-a");
  });
});

// ─── Filter interaction ───────────────────────────────────────────────────────

describe("filter interaction (requirement 10)", () => {
  it("status filter applied AFTER hide produces the same shape as filtering visible-only", () => {
    // Sanity check: the order of operations (hide → filter, vs filter → hide)
    // must not change the resulting visible set when status filtering is applied.
    const groups = [
      stubGroup({
        groupId: "g1",
        accounts: [
          stubAccount({ id: "a", status: "allowed" }),
          stubAccount({ id: "b", status: "warning" }),
        ],
        counts: { allowed: 1, warning: 1, locked: 0, setup_needed: 0, not_connected: 0, unavailable: 0 },
      }),
      stubGroup({
        groupId: "g2",
        accounts: [stubAccount({ id: "c", status: "allowed" })],
      }),
    ];
    // Hide g1 → only g2 visible; filter "allowed" → still g2 (1 allowed account)
    const { visible } = partitionGroups(groups, new Set(["g1"]));
    const filtered = visible
      .map((g) => ({ ...g, accounts: g.accounts.filter((a) => a.status === "allowed") }))
      .filter((g) => g.accounts.length > 0);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].groupId, "g2");
    assert.equal(filtered[0].accounts.length, 1);
  });
});

// ─── Wire contracts ───────────────────────────────────────────────────────────

describe("buildHideRequest / buildUnhideRequest", () => {
  it("hide POSTs to /api/dashboard/hidden-groups with groupId in JSON body", () => {
    const req = buildHideRequest("__personal_broker__::live-conn-x");
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/dashboard/hidden-groups");
    assert.deepEqual(req.body, { groupId: "__personal_broker__::live-conn-x" });
  });

  it("unhide DELETEs with groupId encoded in the query string", () => {
    const req = buildUnhideRequest("acmeprop::conn-1");
    assert.equal(req.method, "DELETE");
    assert.equal(
      req.url,
      "/api/dashboard/hidden-groups?groupId=acmeprop%3A%3Aconn-1",
      "groupId is URL-encoded",
    );
    assert.equal(req.body, null);
  });
});
