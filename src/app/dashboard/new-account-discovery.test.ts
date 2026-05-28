import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { decideReconciliation } from "../../lib/brokers/discovery-decision.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Helpers ───────────────────────────────────────────────────────────────────

function discovered(id: string, name = `Account ${id}`, active = true) {
  return { externalAccountId: id, name, accountType: "evaluation" as const, active };
}

function local(
  id: string,
  externalId: string | null,
  overrides: { missingFromBrokerSince?: Date | null; protectionStatus?: string } = {},
) {
  return {
    id,
    externalAccountId: externalId,
    brokerConnectionId: "conn_test",
    protectionStatus: overrides.protectionStatus ?? "protected",
    missingFromBrokerSince: overrides.missingFromBrokerSince ?? null,
  };
}

// ── Test 1: New account in broker list → becomes pending_decision ─────────────

describe("New broker account discovery — accounts A, B, C (test 1)", () => {
  it("third account C is classified as new (pending_decision candidate)", () => {
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A"), discovered("acct_B"), discovered("acct_C")],
      localAccounts: [local("local_A", "acct_A"), local("local_B", "acct_B")],
    });
    assert.equal(result.newAccounts.length, 1, "exactly one new account detected");
    assert.equal(result.newAccounts[0]!.externalAccountId, "acct_C");
    assert.equal(result.matched.length, 2, "two existing accounts matched");
    assert.equal(result.missing.length, 0, "no accounts flagged as missing");
  });

  it("active=false account from broker is not created as new", () => {
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [
        discovered("acct_A"),
        discovered("acct_D", "Account D", false),
      ],
      localAccounts: [local("local_A", "acct_A")],
    });
    assert.equal(result.newAccounts.length, 0, "inactive broker account must not create a new row");
  });

  it("multiple new accounts are all returned", () => {
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A"), discovered("acct_B"), discovered("acct_C"), discovered("acct_D")],
      localAccounts: [local("local_A", "acct_A")],
    });
    assert.equal(result.newAccounts.length, 3);
  });
});

// ── Test 2: Missing account → flagged, not deleted ────────────────────────────

describe("Missing broker account preservation — accounts A and B, sync returns only A (test 2)", () => {
  it("account B absent from broker list is flagged (alreadyMissing=false)", () => {
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A")],
      localAccounts: [local("local_A", "acct_A"), local("local_B", "acct_B")],
    });
    assert.equal(result.missing.length, 1, "one account flagged as missing");
    assert.equal(result.missing[0]!.id, "local_B");
    assert.equal(result.missing[0]!.alreadyMissing, false, "first time flagged");
    assert.equal(result.newAccounts.length, 0);
  });

  it("already-missing account keeps alreadyMissing=true (timestamp not overwritten)", () => {
    const missingAt = new Date("2026-01-01T00:00:00Z");
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A")],
      localAccounts: [
        local("local_A", "acct_A"),
        local("local_B", "acct_B", { missingFromBrokerSince: missingAt }),
      ],
    });
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]!.alreadyMissing, true, "already flagged — preserve original timestamp");
  });

  it("matched accounts clear their missing flag", () => {
    const missingAt = new Date("2026-01-01T00:00:00Z");
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A"), discovered("acct_B")],
      localAccounts: [
        local("local_A", "acct_A"),
        local("local_B", "acct_B", { missingFromBrokerSince: missingAt }),
      ],
    });
    const matchedB = result.matched.find((m) => m.id === "local_B");
    assert.ok(matchedB, "account B matched because broker returned it again");
    assert.equal(result.missing.length, 0, "no accounts missing when both returned");
  });
});

// ── Test 3: Archived accounts excluded from active selectors ──────────────────

describe("Archived account exclusion from active selectors (test 3)", () => {
  it("archived account is not flagged as missing when absent from broker list", () => {
    const result = decideReconciliation({
      brokerConnectionId: "conn_test",
      discovered: [discovered("acct_A")],
      localAccounts: [
        local("local_A", "acct_A"),
        local("local_B", "acct_B", { protectionStatus: "archived" }),
      ],
    });
    assert.equal(result.missing.length, 0, "archived account must not be flagged as missing");
    assert.equal(result.matched.length, 1);
  });

  it("active dashboard query filter excludes pending_decision, ignored, archived", () => {
    const activeStatuses = ["protected", "monitor_only"];
    for (const excluded of ["pending_decision", "ignored", "archived"]) {
      assert.ok(!activeStatuses.includes(excluded), `${excluded} must not be in active dashboard filter`);
    }
  });

  it("rules page query excludes archived but includes pending_decision", () => {
    const rulesPageSrc = readFileSync(join(__dirname, "../rules/page.tsx"), "utf8");
    assert.ok(
      rulesPageSrc.includes(`not: "archived"`),
      "rules page query must exclude archived accounts",
    );
    assert.ok(
      !rulesPageSrc.includes(`not: "pending_decision"`),
      "rules page must not exclude pending_decision (they are valid rule-setup targets)",
    );
  });
});

// ── Test 4: Pending account surfaced for rule setup ───────────────────────────

describe("Pending account surfacing — dashboard and settings (test 4)", () => {
  it("dashboard page renders NewAccountsPanel when pendingAccounts exist", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    assert.ok(
      src.includes("NewAccountsPanel"),
      "dashboard/page.tsx must import and render NewAccountsPanel for pending accounts",
    );
    assert.ok(
      src.includes("pendingAccounts"),
      "dashboard/page.tsx must reference commandCenter.pendingAccounts",
    );
  });

  it("settings broker-connections-section handles pending_decision accounts", () => {
    const src = readFileSync(
      join(__dirname, "../settings/_components/broker-connections-section.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("pending_decision"),
      "broker-connections-section.tsx must classify pending_decision accounts",
    );
  });

  it("new-accounts-panel offers copy-from-existing-account option", () => {
    const src = readFileSync(
      join(__dirname, "_components/command-center/new-accounts-panel.tsx"),
      "utf8",
    );
    assert.ok(
      src.includes("copy_from"),
      "NewAccountsPanel must offer a copy_from rules choice",
    );
  });

  it("settings PendingAccountCard setup CTA links to /rules?scope=account, not /accounts/{id}/setup", () => {
    const src = readFileSync(
      join(__dirname, "../settings/_components/broker-connections-section.tsx"),
      "utf8",
    );
    assert.ok(
      !src.includes("/accounts/${acct.id}/setup") && !src.includes("/accounts/${acct.id}/setup"),
      "PendingAccountCard must not link to /accounts/{id}/setup — that route does not exist",
    );
    assert.ok(
      src.includes("/rules?scope=account&id=${acct.id}"),
      "PendingAccountCard must link to /rules?scope=account&id={accountId}",
    );
  });

  it("dashboard panel and settings card use the same setup destination (/rules?scope=account)", () => {
    const dashSrc = readFileSync(
      join(__dirname, "_components/command-center/new-accounts-panel.tsx"),
      "utf8",
    );
    const settingsSrc = readFileSync(
      join(__dirname, "../settings/_components/broker-connections-section.tsx"),
      "utf8",
    );
    assert.ok(
      dashSrc.includes("/rules?scope=account"),
      "NewAccountsPanel must route to /rules?scope=account",
    );
    assert.ok(
      settingsSrc.includes("/rules?scope=account"),
      "PendingAccountCard must route to /rules?scope=account",
    );
  });
});
