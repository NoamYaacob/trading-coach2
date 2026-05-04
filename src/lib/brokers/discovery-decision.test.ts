import test from "node:test";
import assert from "node:assert/strict";

import {
  decideReconciliation,
  type DiscoveredAccount,
  type LocalAccountForReconciliation,
} from "./discovery-decision.ts";

const CONN = "conn_1";
const OTHER_CONN = "conn_2";

function discovered(id: string, name = `Account ${id}`): DiscoveredAccount {
  return { externalAccountId: id, name, accountType: "evaluation", active: true };
}

function local(
  id: string,
  externalAccountId: string | null,
  overrides: Partial<LocalAccountForReconciliation> = {},
): LocalAccountForReconciliation {
  return {
    id,
    externalAccountId,
    brokerConnectionId: CONN,
    protectionStatus: "protected",
    missingFromBrokerSince: null,
    ...overrides,
  };
}

// ─── New account discovery ────────────────────────────────────────────────

test("newly discovered broker account becomes pending_decision", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001"), discovered("1002")],
    localAccounts: [local("la1", "1001")],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.id, "la1");
  assert.equal(d.newAccounts.length, 1);
  assert.equal(d.newAccounts[0]!.externalAccountId, "1002");
  assert.equal(d.missing.length, 0);
});

// ─── Missing detection ────────────────────────────────────────────────────

test("missing broker account is flagged, not deleted", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")],
    localAccounts: [local("la1", "1001"), local("la2", "1002")],
  });
  assert.equal(d.missing.length, 1);
  assert.equal(d.missing[0]!.id, "la2");
  assert.equal(d.missing[0]!.alreadyMissing, false);
});

test("already-missing accounts keep their original timestamp", () => {
  const earlierMissingAt = new Date("2026-05-01T00:00:00Z");
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")],
    localAccounts: [
      local("la1", "1001"),
      local("la2", "1002", { missingFromBrokerSince: earlierMissingAt }),
    ],
  });
  assert.equal(d.missing.length, 1);
  assert.equal(d.missing[0]!.id, "la2");
  assert.equal(d.missing[0]!.alreadyMissing, true);
});

test("archived accounts are NOT flagged as missing", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [],
    localAccounts: [local("la1", "1001", { protectionStatus: "archived" })],
  });
  assert.equal(d.missing.length, 0);
});

test("ignored accounts ARE flagged as missing if no longer in broker list", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [],
    localAccounts: [local("la1", "1001", { protectionStatus: "ignored" })],
  });
  assert.equal(d.missing.length, 1);
});

test("accounts on a different BrokerConnection are not flagged missing", () => {
  // Same user has two BrokerConnections. Only the rows on this connection
  // should be reconciled — other-connection accounts are out of scope.
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [],
    localAccounts: [local("la1", "1001", { brokerConnectionId: OTHER_CONN })],
  });
  assert.equal(d.missing.length, 0);
});

// ─── Re-appeared accounts ─────────────────────────────────────────────────

test("previously-missing account that re-appears is matched + clearMissing", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")],
    localAccounts: [
      local("la1", "1001", { missingFromBrokerSince: new Date("2026-05-01") }),
    ],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.id, "la1");
  assert.equal(d.matched[0]!.clearMissing, true);
});

test("matched account that wasn't missing has clearMissing=false", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")],
    localAccounts: [local("la1", "1001")],
  });
  assert.equal(d.matched[0]!.clearMissing, false);
});

// ─── Edge cases ───────────────────────────────────────────────────────────

test("empty broker list with no local accounts: no decisions", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [],
    localAccounts: [],
  });
  assert.equal(d.matched.length, 0);
  assert.equal(d.newAccounts.length, 0);
  assert.equal(d.missing.length, 0);
});

test("local row without externalAccountId is skipped (manual-only row)", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [],
    localAccounts: [local("la1", null)],
  });
  assert.equal(d.missing.length, 0);
});

test("pending_decision rows are matched on subsequent syncs (not duplicated)", () => {
  // After a discovery on day 1 created la1 as pending_decision, a sync on day
  // 2 should match it — not create a second pending_decision row.
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")],
    localAccounts: [local("la1", "1001", { protectionStatus: "pending_decision" })],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.newAccounts.length, 0);
});
