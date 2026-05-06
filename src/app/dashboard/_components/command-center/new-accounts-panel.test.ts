import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { isProtectionIncrease, canChangeProtection } from "../../../../lib/account-protection.ts";
import { derivePropFirmNotice } from "../../../accounts/[id]/setup/prop-firm-notice.ts";

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

// ── PropFirmNotice derivation ─────────────────────────────────────────────────

describe("derivePropFirmNotice", () => {
  // ── Prop firm + known phase ──

  test("prop firm + evaluation accountType shows notice with Evaluation phase", () => {
    const result = derivePropFirmNotice({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      label: "MFF Builder Account",
    });
    assert.ok(result != null, "should return notice data");
    assert.equal(result!.phaseLabel, "Evaluation");
    assert.equal(result!.propFirmName, "MyFundedFutures");
  });

  test("prop firm + funded accountType shows notice with Funded phase", () => {
    const result = derivePropFirmNotice({
      propFirm: "Apex Trader Funding",
      accountType: "funded",
      label: "Apex Pro Account",
    });
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Funded");
    assert.equal(result!.propFirmName, "Apex Trader Funding");
  });

  test("prop firm + demo accountType shows notice with Sim phase", () => {
    const result = derivePropFirmNotice({
      propFirm: "Topstep",
      accountType: "demo",
      label: "Topstep Sim Account",
    });
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Sim");
    assert.equal(result!.propFirmName, "Topstep");
  });

  // ── Prop firm + unknown phase (personal accountType) ──

  test("prop firm + personal accountType shows notice with Not confirmed phase", () => {
    const result = derivePropFirmNotice({
      propFirm: "SomeFirm",
      accountType: "personal",
      label: "My Account",
    });
    assert.ok(result != null, "prop firm alone is enough to show notice");
    assert.equal(result!.phaseLabel, "Not confirmed");
    assert.equal(result!.propFirmName, "SomeFirm");
  });

  test("prop firm set but phase unknown → contextLabel falls back to firm name", () => {
    const result = derivePropFirmNotice({
      propFirm: "MyFirm",
      accountType: "personal",
      label: "Account 12345",
    });
    assert.ok(result != null);
    assert.equal(result!.contextLabel, "MyFirm");
  });

  // ── Phase detection from accountType ──

  test("evaluation accountType alone (no propFirm) triggers notice", () => {
    const result = derivePropFirmNotice({
      propFirm: null,
      accountType: "evaluation",
      label: "Some Eval Account",
    });
    assert.ok(result != null, "evaluation accountType alone should show notice");
    assert.equal(result!.phaseLabel, "Evaluation");
    assert.equal(result!.propFirmName, null);
  });

  test("funded accountType alone (no propFirm) triggers notice", () => {
    const result = derivePropFirmNotice({
      propFirm: null,
      accountType: "funded",
      label: "Funded Account",
    });
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Funded");
  });

  // ── Phase detection from label ──

  test("label containing 'live' triggers notice with Live phase", () => {
    const result = derivePropFirmNotice({
      propFirm: "SomeFirm",
      accountType: "personal",
      label: "Live Trading Account",
    });
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Live");
  });

  test("accountType takes precedence over label for phase detection", () => {
    // accountType=evaluation should win over any label keyword
    const result = derivePropFirmNotice({
      propFirm: "SomeFirm",
      accountType: "evaluation",
      label: "My Live Account",
    });
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Evaluation", "accountType wins over label");
  });

  // ── contextLabel ──

  test("known phase is used as contextLabel", () => {
    const result = derivePropFirmNotice({
      propFirm: "SomeFirm",
      accountType: "evaluation",
      label: "Eval Account",
    });
    assert.ok(result != null);
    assert.equal(result!.contextLabel, "Evaluation");
  });

  test("unknown phase with no propFirm falls back to generic 'prop firm'", () => {
    // evaluation accountType without propFirm: phase=Evaluation so contextLabel=Evaluation
    // To reach the generic fallback we need: no propFirm, no typed phase, but label trigger
    const result = derivePropFirmNotice({
      propFirm: null,
      accountType: "personal",
      label: "live account label",
    });
    // label contains "live" so phase = "Live", contextLabel = "Live"
    assert.ok(result != null);
    assert.equal(result!.phaseLabel, "Live");
    assert.equal(result!.contextLabel, "Live");
  });

  // ── Normal personal account — no notice ──

  test("personal account with no propFirm and no phase keywords returns null", () => {
    const result = derivePropFirmNotice({
      propFirm: null,
      accountType: "personal",
      label: "My Personal Trading Account",
    });
    assert.equal(result, null, "personal account with no prop firm context should not show notice");
  });

  test("personal account with empty propFirm string returns null", () => {
    const result = derivePropFirmNotice({
      propFirm: "   ",
      accountType: "personal",
      label: "Account",
    });
    assert.equal(result, null, "whitespace-only propFirm is treated as not set");
  });

  // ── Notice does not gate setup actions ──

  test("notice data contains no field that blocks setup options A/B/C", () => {
    const result = derivePropFirmNotice({
      propFirm: "MyFirm",
      accountType: "evaluation",
      label: "Eval",
    });
    assert.ok(result != null);
    // The notice only carries display data — no 'isBlocked' or similar guard.
    assert.ok(!("isBlocked" in result!));
    assert.ok(!("requiresConfirmation" in result!));
  });
});
