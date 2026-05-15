/**
 * Tests for internal-lock-event-summary-helpers.ts and related surfaces.
 *
 * Source-scan guards verify:
 *   - The route never performs DB writes
 *   - The route has correct auth and userId ownership filter
 *   - The dashboard shows clear "internal only / no broker action" copy
 *   - The dashboard data layer includes InternalLockEvent in its query
 *
 * Pure-logic tests exercise buildLockEventSummary directly (no Prisma, no network).
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLockEventSummary,
  type LockEventRow,
} from "./internal-lock-event-summary-helpers.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const ROUTE_SRC = readFileSync(
  resolve(__dirname, "../../app/api/debug/internal-lock-events/route.ts"),
  "utf8",
);
const DASHBOARD_SRC = readFileSync(
  resolve(__dirname, "../../app/dashboard/_components/command-center/command-center.tsx"),
  "utf8",
);
const DATA_HELPERS_SRC = readFileSync(
  resolve(__dirname, "../../app/dashboard/_components/command-center/data-helpers.ts"),
  "utf8",
);
const DATA_SRC = readFileSync(
  resolve(__dirname, "../../app/dashboard/_components/command-center/data.ts"),
  "utf8",
);
const RESET_SRC = readFileSync(
  resolve(__dirname, "../../app/api/debug/accounts/[accountId]/reset-session-state/route.ts"),
  "utf8",
);
const ACCOUNT_EDIT_SRC = readFileSync(
  resolve(__dirname, "../../app/accounts/[id]/edit/page.tsx"),
  "utf8",
);

// ── Source-scan: route is read-only ──────────────────────────────────────────

describe("source-scan: internal-lock-events route has no DB writes", () => {
  it("never calls prisma create", () => {
    assert.ok(!ROUTE_SRC.includes(".create("), "must not call .create()");
  });

  it("never calls prisma upsert", () => {
    assert.ok(!ROUTE_SRC.includes(".upsert("), "must not call .upsert()");
  });

  it("never calls prisma update", () => {
    assert.ok(!ROUTE_SRC.includes(".update("), "must not call .update()");
  });

  it("never calls prisma delete", () => {
    assert.ok(!ROUTE_SRC.includes(".delete("), "must not call .delete()");
  });
});

// ── Source-scan: route auth and ownership ─────────────────────────────────────

describe("source-scan: route auth and ownership", () => {
  it("requires authenticated session via getCurrentUser", () => {
    assert.ok(ROUTE_SRC.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(ROUTE_SRC.includes("unauthorized"), "must return 401 when unauthenticated");
  });

  it("requires x-cron-secret header", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"), "must check x-cron-secret header");
    assert.ok(ROUTE_SRC.includes("forbidden"), "must return 403 when secret missing");
  });

  it("filters by userId for ownership", () => {
    assert.ok(
      ROUTE_SRC.includes("userId: currentUser.id"),
      "must filter DB rows by the current user's ID",
    );
  });

  it("response includes the internal-only safety note", () => {
    assert.ok(
      ROUTE_SRC.includes("Internal app lock only — no broker action was sent."),
      "response must include the safety note",
    );
  });

  it("response exposes internalLockEnabled flag state", () => {
    assert.ok(
      ROUTE_SRC.includes("internalLockEnabled"),
      "response must expose whether the lock feature is currently enabled",
    );
  });

  it("response exposes brokerActionTaken field", () => {
    assert.ok(
      ROUTE_SRC.includes("brokerActionTaken"),
      "response must include brokerActionTaken so callers can verify it is always false",
    );
  });
});

// ── Source-scan: dashboard banner copy ───────────────────────────────────────

describe("source-scan: dashboard shows internal-only copy", () => {
  it("contains 'Guardrail internal lock active'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("Guardrail internal lock active"),
      "data-helpers must say Guardrail internal lock active (copy lives in deriveBrokerEnforcementNoteCopy)",
    );
  });

  it("contains 'Broker enforcement is not active'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("Broker enforcement is not active"),
      "data-helpers must say broker enforcement is not active",
    );
  });

  it("contains 'No Tradovate action was sent'", () => {
    assert.ok(
      DATA_HELPERS_SRC.includes("No Tradovate action was sent"),
      "data-helpers must explicitly state no Tradovate action was sent",
    );
  });

  it("checks internalLockActive before rendering broker copy", () => {
    // dashboard delegates to deriveBrokerEnforcementNoteCopy in data-helpers.ts;
    // verify the wrapper is called from command-center and the internalLockActive
    // guard lives inside data-helpers.
    assert.ok(
      DASHBOARD_SRC.includes("deriveBrokerEnforcementNoteCopy("),
      "command-center must call deriveBrokerEnforcementNoteCopy()",
    );
    // Use the call site ("return deriveBrokerEnforcementCopy(") not the definition
    // so the index comparison is meaningful.
    const internalIdx = DATA_HELPERS_SRC.indexOf("if (input.internalLockActive)");
    const brokerCallIdx = DATA_HELPERS_SRC.indexOf("return deriveBrokerEnforcementCopy(");
    assert.ok(internalIdx !== -1, "data-helpers must check internalLockActive");
    assert.ok(brokerCallIdx !== -1, "data-helpers must call deriveBrokerEnforcementCopy(");
    assert.ok(
      internalIdx < brokerCallIdx,
      "internalLockActive guard must appear before deriveBrokerEnforcementCopy call site in data-helpers",
    );
  });

  it("status !== locked guard prevents banner on non-locked accounts", () => {
    assert.ok(
      DASHBOARD_SRC.includes('status !== "locked"'),
      "BrokerEnforcementNote must bail out early when status is not locked",
    );
  });
});

// ── Source-scan: dashboard data includes InternalLockEvent ───────────────────

describe("source-scan: dashboard data query includes InternalLockEvent", () => {
  it("includes internalLockEvents in the Prisma query", () => {
    assert.ok(
      DATA_SRC.includes("internalLockEvents"),
      "data.ts must include internalLockEvents in the accounts query",
    );
  });

  it("filters by clearedAt: null for active locks only", () => {
    assert.ok(
      DATA_SRC.includes("clearedAt: null"),
      "query must filter to active (not yet cleared) lock events",
    );
  });
});

// ── Source-scan: reset endpoint stamps InternalLockEvent clearedAt ────────────

describe("source-scan: reset endpoint clears internal lock", () => {
  it("stamps clearedAt on InternalLockEvent rows", () => {
    assert.ok(
      RESET_SRC.includes("clearedAt"),
      "reset endpoint must stamp clearedAt on active InternalLockEvent rows",
    );
  });

  it("sets clearedBy to manual_reset", () => {
    assert.ok(
      RESET_SRC.includes("manual_reset"),
      "reset endpoint must record clearedBy=manual_reset",
    );
  });

  it("uses updateMany — does not delete history", () => {
    assert.ok(
      RESET_SRC.includes("updateMany"),
      "reset endpoint must updateMany (stamp clearedAt), not delete rows",
    );
    assert.ok(
      !RESET_SRC.includes("deleteMany"),
      "reset endpoint must not delete InternalLockEvent history",
    );
  });

  it("does not call any Tradovate broker endpoint", () => {
    assert.ok(!RESET_SRC.includes("tradovate"), "reset must not call any Tradovate endpoint");
    assert.ok(!RESET_SRC.includes("userAccountAutoLiq"), "reset must not call userAccountAutoLiq");
    assert.ok(!RESET_SRC.includes("liquidate"), "reset must not call liquidatepositions");
  });
});

// ── Helper factory ────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<LockEventRow> = {}): LockEventRow {
  return {
    id: "lock-1",
    accountId: "acct-1",
    accountLabel: "DEMO-TEST",
    externalAccountId: "ext-123",
    env: "demo",
    ruleType: "trade_limit",
    tradingDay: "2026-05-15",
    thresholdAmount: null,
    thresholdCount: 5,
    observedAmount: null,
    observedCount: 7,
    internalOnly: true,
    brokerActionTaken: false,
    createdAt: new Date("2026-05-15T10:00:00Z"),
    clearedAt: null,
    clearedBy: null,
    ...overrides,
  };
}

const CLEARED_AT = new Date("2026-05-15T12:00:00Z");

// ── Pure logic: empty input ───────────────────────────────────────────────────

describe("buildLockEventSummary — empty input", () => {
  it("returns zero counts", () => {
    const result = buildLockEventSummary([]);
    assert.equal(result.total, 0);
    assert.equal(result.activeCount, 0);
    assert.equal(result.clearedCount, 0);
  });

  it("returns empty arrays", () => {
    const result = buildLockEventSummary([]);
    assert.deepEqual(result.recent, []);
    assert.deepEqual(result.byAccount, []);
    assert.deepEqual(result.byRuleType, []);
  });
});

// ── Pure logic: single event ──────────────────────────────────────────────────

describe("buildLockEventSummary — single active event", () => {
  const row = makeRow();
  const result = buildLockEventSummary([row]);

  it("total is 1", () => assert.equal(result.total, 1));
  it("activeCount is 1", () => assert.equal(result.activeCount, 1));
  it("clearedCount is 0", () => assert.equal(result.clearedCount, 0));
  it("recent contains the row", () => assert.equal(result.recent.length, 1));
  it("brokerActionTaken is false", () => assert.equal(result.recent[0].brokerActionTaken, false));
  it("internalOnly is true", () => assert.equal(result.recent[0].internalOnly, true));

  it("byAccount has one entry", () => assert.equal(result.byAccount.length, 1));
  it("byAccount entry has active=1", () => assert.equal(result.byAccount[0].active, 1));
  it("byAccount entry has cleared=0", () => assert.equal(result.byAccount[0].cleared, 0));

  it("byRuleType has one entry", () => assert.equal(result.byRuleType.length, 1));
  it("byRuleType entry has active=1", () => assert.equal(result.byRuleType[0].active, 1));
});

describe("buildLockEventSummary — single cleared event", () => {
  const row = makeRow({ clearedAt: CLEARED_AT, clearedBy: "manual_reset" });
  const result = buildLockEventSummary([row]);

  it("total is 1", () => assert.equal(result.total, 1));
  it("activeCount is 0", () => assert.equal(result.activeCount, 0));
  it("clearedCount is 1", () => assert.equal(result.clearedCount, 1));
  it("byAccount entry has active=0", () => assert.equal(result.byAccount[0].active, 0));
  it("byAccount entry has cleared=1", () => assert.equal(result.byAccount[0].cleared, 1));
  it("lastClearedAt is set", () =>
    assert.deepEqual(result.byAccount[0].lastClearedAt, CLEARED_AT));
  it("byRuleType entry has cleared=1", () => assert.equal(result.byRuleType[0].cleared, 1));
  it("byRuleType entry has active=0", () => assert.equal(result.byRuleType[0].active, 0));
});

// ── Pure logic: active vs cleared counts ─────────────────────────────────────

describe("buildLockEventSummary — mixed active and cleared", () => {
  const rows = [
    makeRow({ id: "lock-1", clearedAt: null }),
    makeRow({ id: "lock-2", clearedAt: CLEARED_AT, clearedBy: "manual_reset" }),
    makeRow({ id: "lock-3", clearedAt: CLEARED_AT, clearedBy: "manual_reset" }),
  ];
  const result = buildLockEventSummary(rows);

  it("total is 3", () => assert.equal(result.total, 3));
  it("activeCount is 1", () => assert.equal(result.activeCount, 1));
  it("clearedCount is 2", () => assert.equal(result.clearedCount, 2));
  it("byAccount has 1 entry (same account)", () => assert.equal(result.byAccount.length, 1));
  it("byAccount active=1 cleared=2", () => {
    assert.equal(result.byAccount[0].active, 1);
    assert.equal(result.byAccount[0].cleared, 2);
  });
});

// ── Pure logic: brokerActionTaken is always false ────────────────────────────

describe("buildLockEventSummary — brokerActionTaken safety", () => {
  it("all Phase 2B events have brokerActionTaken=false", () => {
    const rows = [
      makeRow({ id: "1" }),
      makeRow({ id: "2", clearedAt: CLEARED_AT }),
    ];
    const result = buildLockEventSummary(rows);
    for (const row of result.recent) {
      assert.equal(row.brokerActionTaken, false, `row ${row.id} must have brokerActionTaken=false`);
    }
  });

  it("all Phase 2B events have internalOnly=true", () => {
    const rows = [makeRow({ id: "1" }), makeRow({ id: "2" })];
    const result = buildLockEventSummary(rows);
    for (const row of result.recent) {
      assert.equal(row.internalOnly, true, `row ${row.id} must have internalOnly=true`);
    }
  });
});

// ── Pure logic: byAccount grouping ───────────────────────────────────────────

describe("buildLockEventSummary — byAccount grouping", () => {
  const t1 = new Date("2026-05-15T10:00:00Z");
  const t2 = new Date("2026-05-15T11:00:00Z");

  it("groups two events for the same account", () => {
    const rows = [
      makeRow({ id: "1", accountId: "acct-1", createdAt: t1, ruleType: "trade_limit" }),
      makeRow({
        id: "2",
        accountId: "acct-1",
        createdAt: t2,
        ruleType: "daily_loss_limit",
        clearedAt: CLEARED_AT,
      }),
    ];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byAccount.length, 1);
    assert.equal(result.byAccount[0].total, 2);
    assert.equal(result.byAccount[0].ruleTypes.length, 2);
  });

  it("separates events for different accounts", () => {
    const rows = [
      makeRow({ id: "1", accountId: "acct-a", accountLabel: "Acct A", createdAt: t1 }),
      makeRow({ id: "2", accountId: "acct-b", accountLabel: "Acct B", createdAt: t2 }),
    ];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byAccount.length, 2);
  });

  it("sorts by lastLockedAt desc — most recently locked account first", () => {
    const rows = [
      makeRow({ id: "1", accountId: "acct-early", accountLabel: "Early", createdAt: t1 }),
      makeRow({ id: "2", accountId: "acct-later", accountLabel: "Later", createdAt: t2 }),
    ];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byAccount[0].accountId, "acct-later");
    assert.equal(result.byAccount[1].accountId, "acct-early");
  });

  it("lastClearedAt tracks most recent cleared timestamp", () => {
    const clearedEarlier = new Date("2026-05-15T11:00:00Z");
    const clearedLater = new Date("2026-05-15T13:00:00Z");
    const rows = [
      makeRow({ id: "1", accountId: "acct-1", clearedAt: clearedEarlier }),
      makeRow({ id: "2", accountId: "acct-1", clearedAt: clearedLater }),
    ];
    const result = buildLockEventSummary(rows);
    assert.deepEqual(result.byAccount[0].lastClearedAt, clearedLater);
  });

  it("lastClearedAt is null when no events are cleared", () => {
    const rows = [makeRow({ id: "1", accountId: "acct-1", clearedAt: null })];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byAccount[0].lastClearedAt, null);
  });
});

// ── Pure logic: byRuleType grouping ──────────────────────────────────────────

describe("buildLockEventSummary — byRuleType grouping", () => {
  it("groups events by ruleType", () => {
    const rows = [
      makeRow({ id: "1", ruleType: "trade_limit" }),
      makeRow({ id: "2", ruleType: "trade_limit", clearedAt: CLEARED_AT }),
      makeRow({ id: "3", ruleType: "daily_loss_limit" }),
    ];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byRuleType.length, 2);
    const tradeLimit = result.byRuleType.find((r) => r.ruleType === "trade_limit");
    assert.ok(tradeLimit, "trade_limit entry must exist");
    assert.equal(tradeLimit.total, 2);
    assert.equal(tradeLimit.active, 1);
    assert.equal(tradeLimit.cleared, 1);
  });

  it("sorts by total desc — most-triggered rule type first", () => {
    const rows = [
      makeRow({ id: "1", ruleType: "daily_loss_limit" }),
      makeRow({ id: "2", ruleType: "trade_limit" }),
      makeRow({ id: "3", ruleType: "trade_limit" }),
      makeRow({ id: "4", ruleType: "trade_limit" }),
    ];
    const result = buildLockEventSummary(rows);
    assert.equal(result.byRuleType[0].ruleType, "trade_limit");
    assert.equal(result.byRuleType[1].ruleType, "daily_loss_limit");
  });

  it("affectedAccounts uses label when available", () => {
    const rows = [
      makeRow({ id: "1", accountId: "acct-1", accountLabel: "My Demo Account", ruleType: "trade_limit" }),
    ];
    const result = buildLockEventSummary(rows);
    assert.ok(result.byRuleType[0].affectedAccounts.includes("My Demo Account"));
  });

  it("affectedAccounts falls back to accountId when label is null", () => {
    const rows = [
      makeRow({ id: "1", accountId: "acct-xyz", accountLabel: null, ruleType: "trade_limit" }),
    ];
    const result = buildLockEventSummary(rows);
    assert.ok(result.byRuleType[0].affectedAccounts.includes("acct-xyz"));
  });
});

// ── Source-scan: post-canary UI — banner copy and account details ─────────────

describe("source-scan: protection-locked banner does not imply trading is locked", () => {
  it("banner copy does not say 'Protection locked for today'", () => {
    assert.ok(
      !DASHBOARD_SRC.includes("Protection locked for today"),
      "banner must not say 'Protection locked for today' — it sounds like the account is locked for trading",
    );
  });

  it("banner copy conveys rule changes are queued, not account locked", () => {
    assert.ok(
      DASHBOARD_SRC.includes("Rule changes queued for next session") ||
        DASHBOARD_SRC.includes("Protection settings are locked"),
      "banner must convey that rule changes are deferred to next session, not that the account is locked",
    );
  });
});

describe("source-scan: manage-connection page shows broker enforcement history", () => {
  it("queries GuardianIntervention with listenerBrokerDedupKey filter", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("listenerBrokerDedupKey"),
      "edit page must query GuardianIntervention rows by listenerBrokerDedupKey",
    );
  });

  it("renders a Broker Enforcement History section", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("Broker Enforcement History"),
      "edit page must show a 'Broker Enforcement History' section",
    );
  });

  it("shows 'Historical audit record' label on each enforcement row", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("Historical audit record"),
      "edit page must label broker enforcement rows as historical audit records",
    );
  });

  it("shows 'No active Guardrail lock' badge when riskState is not STOPPED", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("No active Guardrail lock"),
      "edit page must show 'No active Guardrail lock' when riskState is not STOPPED",
    );
  });

  it("shows internalLockEventId in the audit record", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("internalLockEventId"),
      "edit page must surface internalLockEventId in the broker enforcement history",
    );
  });

  it("surfaces dedup key for each enforcement row", () => {
    assert.ok(
      ACCOUNT_EDIT_SRC.includes("listenerBrokerDedupKey"),
      "edit page must show the listenerBrokerDedupKey dedup key",
    );
  });
});
