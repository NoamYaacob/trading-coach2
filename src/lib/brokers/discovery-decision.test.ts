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

// ─── Inactive accounts (the production bug) ───────────────────────────────
// Many prop firms keep a reset/blown account in /account/list with active=false
// rather than deleting it. The dashboard MUST flag those as missing — otherwise
// they keep rendering stale balance / loss budget / "Allowed" badge.

test("account in /account/list with active=false is flagged as missing", () => {
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [{ externalAccountId: "1001", name: "MFFUEVBLDR1", accountType: "evaluation", active: false }],
    localAccounts: [local("la1", "1001")],
  });
  // Match still happens (so we keep brokerConnectionId fresh), BUT
  // the missing list also includes la1.
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.id, "la1");
  assert.equal(d.matched[0]!.clearMissing, false, "must NOT clear missing for inactive account");
  assert.equal(d.missing.length, 1);
  assert.equal(d.missing[0]!.id, "la1");
});

test("inactive account already flagged stays alreadyMissing=true", () => {
  const earlier = new Date("2026-05-01T00:00:00Z");
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [{ externalAccountId: "1001", name: "X", accountType: "evaluation", active: false }],
    localAccounts: [local("la1", "1001", { missingFromBrokerSince: earlier })],
  });
  assert.equal(d.missing.length, 1);
  assert.equal(d.missing[0]!.alreadyMissing, true);
});

test("re-activated account (was missing → now active=true) clears missing flag", () => {
  const earlier = new Date("2026-05-01T00:00:00Z");
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001")], // active: true (default)
    localAccounts: [local("la1", "1001", { missingFromBrokerSince: earlier })],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.clearMissing, true);
  assert.equal(d.missing.length, 0);
});

test("inactive broker entries do NOT auto-create new pending_decision rows", () => {
  // Tradovate occasionally exposes legacy inactive accounts the user never
  // had. Don't create local rows for them.
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [{ externalAccountId: "9999", name: "Old", accountType: "evaluation", active: false }],
    localAccounts: [],
  });
  assert.equal(d.newAccounts.length, 0);
});

// ─── Type-safe id matching (string ↔ numeric) ─────────────────────────────

test("matching survives numeric broker id ↔ string DB externalAccountId", () => {
  // The discovery fetcher converts numeric ids with String(a.id) before
  // building DiscoveredAccount, so by the time decideReconciliation runs,
  // both sides are strings. This test pins that contract: a DB row with
  // externalAccountId="49392735" must match a discovered "49392735".
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("49392735", "MFFUEVBLDR133936248")],
    localAccounts: [local("la1", "49392735")],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.id, "la1");
  assert.equal(d.missing.length, 0);
});

test("matching is case-insensitive and trims whitespace (defensive normalization)", () => {
  // Defends against any historical migration that left whitespace or case
  // drift in externalAccountId. Normalization is symmetric on both sides.
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("ABC123")],
    localAccounts: [local("la1", "  abc123  ")],
  });
  assert.equal(d.matched.length, 1);
  assert.equal(d.matched[0]!.id, "la1");
  assert.equal(d.missing.length, 0);
});

// ─── Multi-connection isolation (live vs demo) ───────────────────────────

test("live and demo broker connections are reconciled independently", () => {
  // A user with both a live and a demo Tradovate connection should have the
  // two reconciled in separate calls. A demo-only account never appears in
  // the live connection's missing list, and vice versa.
  const liveResult = decideReconciliation({
    brokerConnectionId: "conn_live",
    discovered: [discovered("live_1")],
    localAccounts: [
      local("la_live", "live_1", { brokerConnectionId: "conn_live" }),
      local("la_demo", "demo_1", { brokerConnectionId: "conn_demo" }),
    ],
  });
  assert.equal(liveResult.matched.length, 1);
  assert.equal(liveResult.matched[0]!.id, "la_live");
  assert.equal(
    liveResult.missing.length,
    0,
    "demo-connection account must not be flagged when reconciling the live connection",
  );
});

test("a new account discovered on demo does not appear in a separate live discovery pass", () => {
  // Two consecutive discovery passes (one per connection) must produce
  // independent newAccounts arrays. A new demo account in the demo pass
  // must not appear as new on the live pass — it never reaches that pass.
  const demoPass = decideReconciliation({
    brokerConnectionId: "conn_demo",
    discovered: [discovered("demo_new")],
    localAccounts: [],
  });
  const livePass = decideReconciliation({
    brokerConnectionId: "conn_live",
    discovered: [discovered("live_existing")],
    localAccounts: [local("la_live", "live_existing", { brokerConnectionId: "conn_live" })],
  });
  assert.equal(demoPass.newAccounts.length, 1);
  assert.equal(demoPass.newAccounts[0]!.externalAccountId, "demo_new");
  assert.equal(livePass.newAccounts.length, 0);
});

// ─── Safety: discovered accounts inherit nothing from siblings ───────────

test("newAccounts entries carry only broker-supplied fields — no sibling state", () => {
  // The reconciliation surface used to create new pending_decision rows is
  // limited to externalAccountId/name/accountType/active. There is no field
  // for inherited lockout state, trade count, balance, or any reference to
  // other local accounts. This pins that contract — so adding a new account
  // can never silently inherit risk state from a sibling.
  const protectedSibling = local("sibling", "1001", {
    protectionStatus: "protected",
    missingFromBrokerSince: null,
  });
  const d = decideReconciliation({
    brokerConnectionId: CONN,
    discovered: [discovered("1001"), discovered("9999", "Brand new account")],
    localAccounts: [protectedSibling],
  });
  assert.equal(d.newAccounts.length, 1);
  const created = d.newAccounts[0]!;
  // Exactly the four broker-supplied fields, nothing else.
  const keys = Object.keys(created).sort();
  assert.deepEqual(keys, ["accountType", "active", "externalAccountId", "name"]);
  assert.equal(created.externalAccountId, "9999");
});
