import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRuleScopes, parseRuleScopeParams, buildAccountRulesUrl } from "./rule-scope-utils.ts";
import type { RuleScopeAccount } from "./rule-scope-utils.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function conn(id: string, overrides?: Partial<RuleScopeAccount["brokerConnection"]>): RuleScopeAccount["brokerConnection"] {
  return {
    id,
    platform: "tradovate",
    env: "live",
    brokerUserId: null,
    connectionStatus: "connected_readonly",
    permissionLevel: null,
    ...overrides,
  };
}

function stub(overrides: Partial<RuleScopeAccount>): RuleScopeAccount {
  return {
    id: "stub",
    label: "Stub Account",
    platform: "tradovate",
    propFirm: "MyFundedFutures",
    connectionStatus: "connected_readonly",
    brokerConnectionId: "conn-a",
    hasAccountRules: false,
    missingFromBrokerSince: null,
    requiresAutomatedActionsConsent: false,
    brokerConnection: conn("conn-a"),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("buildRuleScopes", () => {
  it("groups accounts sharing the same broker connection", () => {
    const accounts = [stub({ id: "a1" }), stub({ id: "a2" })];
    const { groups, unattached } = buildRuleScopes(accounts);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].accounts.length, 2);
    assert.equal(unattached.length, 0);
  });

  it("separates accounts without brokerConnectionId into unattached", () => {
    const accounts = [
      stub({ id: "m1", brokerConnectionId: null, brokerConnection: null }),
      stub({ id: "a1" }),
    ];
    const { groups, unattached } = buildRuleScopes(accounts);
    assert.equal(groups.length, 1);
    assert.equal(unattached.length, 1);
    assert.equal(unattached[0].id, "m1");
  });

  it("keeps same firm on different connections as separate groups", () => {
    const accounts = [
      stub({ id: "a1", brokerConnectionId: "conn-a", brokerConnection: conn("conn-a") }),
      stub({ id: "b1", brokerConnectionId: "conn-b", brokerConnection: conn("conn-b") }),
    ];
    const { groups } = buildRuleScopes(accounts);
    assert.equal(groups.length, 2);
    const connIds = groups.map((g) => g.groupKey.split("::")[1]).sort();
    assert.deepEqual(connIds, ["conn-a", "conn-b"]);
  });

  it("sorts groups alphabetically by firmLabel", () => {
    const accounts = [
      stub({ id: "z1", propFirm: "Zebra Trading", brokerConnectionId: "conn-z", brokerConnection: conn("conn-z") }),
      stub({ id: "a1", propFirm: "Alpha Futures", brokerConnectionId: "conn-a", brokerConnection: conn("conn-a") }),
    ];
    const { groups } = buildRuleScopes(accounts);
    assert.equal(groups[0].firmLabel, "Alpha Futures");
    assert.equal(groups[1].firmLabel, "Zebra Trading");
  });

  it("uses platform label as firmLabel when propFirm is null", () => {
    const accounts = [
      stub({ propFirm: null, brokerConnection: conn("conn-a", { platform: "tradovate" }) }),
    ];
    const { groups } = buildRuleScopes(accounts);
    assert.equal(groups[0].firmLabel, "Tradovate");
  });
});

// ── per-account hasAccountRules independence ──────────────────────────────────

describe("buildRuleScopes — per-account hasAccountRules is independent", () => {
  it("two accounts both without overrides: neither has Custom badge data", () => {
    const accounts = [
      stub({ id: "acc-a", hasAccountRules: false }),
      stub({ id: "acc-b", hasAccountRules: false }),
    ];
    const { groups } = buildRuleScopes(accounts);
    const accs = groups[0].accounts;
    assert.equal(accs.length, 2);
    const a = accs.find((x) => x.id === "acc-a")!;
    const b = accs.find((x) => x.id === "acc-b")!;
    assert.equal(a.hasAccountRules, false, "acc-a must not have overrides");
    assert.equal(b.hasAccountRules, false, "acc-b must not have overrides");
  });

  it("account A with override does not affect account B without override", () => {
    const accounts = [
      stub({ id: "acc-a", hasAccountRules: true }),
      stub({ id: "acc-b", hasAccountRules: false }),
    ];
    const { groups } = buildRuleScopes(accounts);
    const accs = groups[0].accounts;
    const a = accs.find((x) => x.id === "acc-a")!;
    const b = accs.find((x) => x.id === "acc-b")!;
    assert.equal(a.hasAccountRules, true, "acc-a must have its override");
    assert.equal(b.hasAccountRules, false, "acc-b must not be affected by acc-a's override");
  });

  it("account selection uses account.id, not index or firm name", () => {
    const accounts = [
      stub({ id: "acc-a", label: "Same Firm", hasAccountRules: false }),
      stub({ id: "acc-b", label: "Same Firm", hasAccountRules: true }),
    ];
    const { groups } = buildRuleScopes(accounts);
    const accs = groups[0].accounts;
    const byIdA = accs.find((x) => x.id === "acc-a")!;
    const byIdB = accs.find((x) => x.id === "acc-b")!;
    assert.ok(byIdA, "must find acc-a by id");
    assert.ok(byIdB, "must find acc-b by id");
    assert.equal(byIdA.hasAccountRules, false);
    assert.equal(byIdB.hasAccountRules, true);
  });

  it("switching between accounts exposes each account's own hasAccountRules flag", () => {
    const accounts = [
      stub({ id: "acc-1", hasAccountRules: true }),
      stub({ id: "acc-2", hasAccountRules: false }),
      stub({ id: "acc-3", hasAccountRules: true }),
    ];
    const { groups } = buildRuleScopes(accounts);
    const accs = groups[0].accounts;
    const expected: Record<string, boolean> = { "acc-1": true, "acc-2": false, "acc-3": true };
    for (const [id, want] of Object.entries(expected)) {
      const found = accs.find((x) => x.id === id)!;
      assert.equal(found.hasAccountRules, want, `acc ${id}: expected hasAccountRules=${want}`);
    }
  });
});

// ── parseRuleScopeParams ──────────────────────────────────────────────────────

describe("parseRuleScopeParams", () => {
  it("no params → default scope, null accountId", () => {
    const result = parseRuleScopeParams({});
    assert.equal(result.scope, "default");
    assert.equal(result.accountId, null);
  });

  it("scope=account + id → account scope with accountId", () => {
    const result = parseRuleScopeParams({ scope: "account", id: "acc-123" });
    assert.equal(result.scope, "account");
    assert.equal(result.accountId, "acc-123");
  });

  it("scope=account without id → falls back to default", () => {
    const result = parseRuleScopeParams({ scope: "account" });
    assert.equal(result.scope, "default");
    assert.equal(result.accountId, null);
  });

  it("scope=default ignores id", () => {
    const result = parseRuleScopeParams({ scope: "default", id: "acc-123" });
    assert.equal(result.scope, "default");
    assert.equal(result.accountId, null);
  });

  it("unknown scope → default", () => {
    const result = parseRuleScopeParams({ scope: "something_else", id: "acc-123" });
    assert.equal(result.scope, "default");
    assert.equal(result.accountId, null);
  });
});

// ── buildAccountRulesUrl ──────────────────────────────────────────────────────

describe("buildAccountRulesUrl", () => {
  it("points to /rules, not /accounts/[id]/edit", () => {
    const url = buildAccountRulesUrl("acc-123");
    assert.ok(url.startsWith("/rules"), "must route to the Trading Plan page");
    assert.ok(!url.includes("/edit"), "must not point to the broker connection edit page");
    assert.ok(!url.match(/\/accounts\/[^/]+\/edit/), "must not use the accounts edit route");
  });

  it("includes scope=account query param", () => {
    const url = buildAccountRulesUrl("acc-123");
    assert.ok(url.includes("scope=account"), "must select account scope in the Trading Plan page");
  });

  it("includes the account id as a query param", () => {
    const url = buildAccountRulesUrl("acc-123");
    assert.ok(url.includes("id=acc-123"), "must pass the account id so the sidebar selects it");
  });

  it("embeds the correct account id", () => {
    const id = "demo7433035";
    const url = buildAccountRulesUrl(id);
    assert.equal(url, `/rules?scope=account&id=${id}`);
  });

  it("different account ids produce different URLs", () => {
    assert.notEqual(buildAccountRulesUrl("acc-a"), buildAccountRulesUrl("acc-b"));
  });

  it("round-trips through parseRuleScopeParams", () => {
    const id = "acc-xyz";
    const url = new URL(buildAccountRulesUrl(id), "http://x");
    const result = parseRuleScopeParams({
      scope: url.searchParams.get("scope") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
    });
    assert.equal(result.scope, "account");
    assert.equal(result.accountId, id);
  });
});
