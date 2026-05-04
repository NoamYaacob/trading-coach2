import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRuleScopes } from "./rule-scope-utils.ts";
import type { RuleScopeAccount } from "./rule-scope-utils.ts";

// ── Helpers ────────────────────────────────────────────────────────────────────

function conn(id: string, overrides?: Partial<RuleScopeAccount["brokerConnection"]>): RuleScopeAccount["brokerConnection"] {
  return {
    id,
    platform: "tradovate",
    env: "live",
    brokerUserId: null,
    connectionStatus: "connected_readonly",
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
