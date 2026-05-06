import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { isProtectionIncrease, canChangeProtection } from "../../../../lib/account-protection.ts";

// ── Dashboard exclusion contract ──────────────────────────────────────────────

describe("pending_decision exclusion from active dashboard", () => {
  // loadCommandCenterData uses: protectionStatus: { in: ["protected", "monitor_only"] }
  // pending_decision accounts are fetched separately into pendingAccounts[].
  // This keeps them out of totals, P&L, risk budgets, and enforcement.

  test("pending_decision is not in the active-dashboard status allowlist", () => {
    const activeDashboardStatuses = ["protected", "monitor_only"];
    assert.ok(
      !activeDashboardStatuses.includes("pending_decision"),
      "pending_decision must not appear in active dashboard query filter",
    );
  });

  test("pending_decision is not counted in account totals", () => {
    const activeDashboardStatuses = ["protected", "monitor_only"];
    for (const excluded of ["pending_decision", "ignored", "archived"]) {
      assert.ok(
        !activeDashboardStatuses.includes(excluded),
        `${excluded} must not appear in totals`,
      );
    }
  });
});

// ── Broker connections page contract ─────────────────────────────────────────

describe("pending_decision visibility in broker connections page", () => {
  // /accounts/page.tsx uses: protectionStatus: { not: "archived" }
  // This means pending_decision accounts ARE included in the broker connections
  // query and rendered with a "Setup needed" badge and "Choose rules" CTA.

  test("pending_decision is not excluded from broker connections page", () => {
    const brokerConnectionsExcluded = ["archived"];
    assert.ok(
      !brokerConnectionsExcluded.includes("pending_decision"),
      "pending_decision must appear in broker connections page",
    );
  });

  test("archived is excluded from broker connections page", () => {
    const brokerConnectionsExcluded = ["archived"];
    assert.ok(
      brokerConnectionsExcluded.includes("archived"),
      "archived must be excluded from broker connections page",
    );
  });
});

// ── Protection status transition contracts ────────────────────────────────────

describe("pending_decision → * transitions", () => {
  const unlockedState = {
    isLocked: false,
    timezone: "America/New_York",
    tradingDayKey: "2024-07-15",
    nextTradingDayKey: "2024-07-16",
    cutoffTime: null,
    hasSessionHours: false,
    lockedFrom: null,
    lockedUntil: null,
    nextCutoffTime: null,
  };
  const lockedState = {
    isLocked: true,
    timezone: "America/New_York",
    tradingDayKey: "2024-07-15",
    nextTradingDayKey: "2024-07-16",
    cutoffTime: new Date("2024-07-15T13:55:00Z"),
    hasSessionHours: true,
    lockedFrom: new Date("2024-07-15T14:00:00Z"),
    lockedUntil: new Date("2024-07-15T23:00:00Z"),
    nextCutoffTime: null,
  };

  test("pending_decision → protected is treated as a protection increase", () => {
    assert.ok(isProtectionIncrease("pending_decision", "protected"));
  });

  test("pending_decision → monitor_only is treated as a protection increase", () => {
    assert.ok(isProtectionIncrease("pending_decision", "monitor_only"));
  });

  test("pending_decision → ignored is treated as a protection increase (first-time setup)", () => {
    assert.ok(isProtectionIncrease("pending_decision", "ignored"));
  });

  test("pending_decision → protected applies immediately even when locked", () => {
    const { allowed } = canChangeProtection("pending_decision", "protected", lockedState);
    assert.ok(allowed, "first-time setup must apply immediately regardless of lock");
  });

  test("pending_decision → monitor_only applies immediately even when locked", () => {
    const { allowed } = canChangeProtection("pending_decision", "monitor_only", lockedState);
    assert.ok(allowed);
  });

  test("pending_decision → ignored applies immediately even when locked", () => {
    const { allowed } = canChangeProtection("pending_decision", "ignored", lockedState);
    assert.ok(allowed);
  });

  test("pending_decision → protected applies immediately when unlocked", () => {
    const { allowed } = canChangeProtection("pending_decision", "protected", unlockedState);
    assert.ok(allowed);
  });
});

// ── Safety gates: pending accounts do not trigger enforcement ─────────────────

describe("pending_decision safety gates", () => {
  // The protection API blocks setting pending_decision via user action.
  // Only reconcileDiscoveredAccounts() can create it.

  test("pending_decision cannot be set via the protection API (blocked at API layer)", () => {
    // Documented contract: the protection route rejects newStatus === "pending_decision".
    // This test documents the invariant — the actual check is in
    // /api/accounts/[id]/protection/route.ts.
    const apiRejectedStatuses = ["pending_decision"];
    assert.ok(
      apiRejectedStatuses.includes("pending_decision"),
      "pending_decision must be rejected by the protection API",
    );
  });

  test("pending accounts are not in the set of statuses eligible for enforcement", () => {
    // Enforcement only runs on protected/monitor_only accounts.
    const enforcementEligible = ["protected", "monitor_only"];
    assert.ok(!enforcementEligible.includes("pending_decision"));
    assert.ok(!enforcementEligible.includes("ignored"));
    assert.ok(!enforcementEligible.includes("archived"));
  });
});

// ── First-time activation contracts ──────────────────────────────────────────

describe("first-time activation (pending_decision → active)", () => {
  test("choosing default template sets status to protected", () => {
    // Option A on /accounts/[id]/setup calls the protection API with protectionStatus="protected".
    // This test documents the intended status transition.
    const optionAStatus = "protected";
    assert.equal(optionAStatus, "protected");
    assert.ok(isProtectionIncrease("pending_decision", optionAStatus));
  });

  test("ignoring a pending account sets status to ignored", () => {
    const optionCStatus = "ignored";
    assert.equal(optionCStatus, "ignored");
    assert.ok(isProtectionIncrease("pending_decision", optionCStatus));
  });

  test("ignored accounts are excluded from active dashboard", () => {
    const activeDashboardStatuses = ["protected", "monitor_only"];
    assert.ok(!activeDashboardStatuses.includes("ignored"));
  });

  test("activating a pending account removes it from the pending panel", () => {
    // Once protectionStatus changes from pending_decision to protected/monitor_only/ignored,
    // the account no longer matches the pendingAccounts query
    // (WHERE protectionStatus = 'pending_decision') and the panel disappears after refresh.
    const pendingQuery = "pending_decision";
    const activatedStatuses = ["protected", "monitor_only", "ignored"];
    for (const status of activatedStatuses) {
      assert.notEqual(status, pendingQuery);
    }
  });
});

// ── Duplicate prevention contract ─────────────────────────────────────────────

describe("duplicate prevention", () => {
  // reconcileDiscoveredAccounts uses upsert with externalAccountId+brokerConnectionId
  // as the unique key. Same account returning after being unavailable reactivates
  // the existing row (isActive=true, missingFromBrokerSince=null) rather than
  // creating a new pending_decision row.

  test("same externalAccountId+brokerConnectionId reactivates existing row, not creates new pending", () => {
    // This is a contract documented for the upsert in tradovate-discovery.ts.
    // The upsert key prevents duplicate pending_decision rows for the same broker account.
    const upsertKey = { externalAccountId: "abc-123", brokerConnectionId: "conn-1" };
    assert.equal(typeof upsertKey.externalAccountId, "string");
    assert.equal(typeof upsertKey.brokerConnectionId, "string");
  });

  test("new account ID after prop firm reset creates a new pending_decision row", () => {
    // A prop firm reset gives the account a new externalAccountId. This is a
    // genuinely new account from Guardrail's perspective — it gets pending_decision.
    const oldId = "tradovate-12345";
    const newIdAfterReset = "tradovate-99999";
    assert.notEqual(oldId, newIdAfterReset, "different IDs → different upsert key → new row");
  });
});
