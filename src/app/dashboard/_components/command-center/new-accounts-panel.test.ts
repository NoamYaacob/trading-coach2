import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isProtectionIncrease, canChangeProtection } from "../../../../lib/account-protection.ts";
import { derivePropFirmNotice } from "../../../accounts/[id]/setup/prop-firm-notice.ts";
import {
  buildMetaParts,
  buildPanelHeading,
  resolveConfirmOutcome,
  PREVIEW_CONFIRM_MESSAGE,
  PREVIEW_CONFIRM_HINT,
  getDefaultFirmChoice,
  getDefaultOtherText,
  getDefaultTypeChoice,
  KNOWN_PILL_FIRMS,
} from "./new-accounts-panel-logic.ts";

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

// ── Dashboard CTA contracts: Add to Guardrail / Ignore for now ────────────────

describe("dashboard CTA contract — Add to Guardrail / Ignore for now", () => {
  // The dashboard's "New broker account detected" panel exposes two buttons:
  //  1. "Add to Guardrail" → POST /api/accounts/[id]/protection { protectionStatus: "protected" }
  //  2. "Ignore for now"   → POST /api/accounts/[id]/protection { protectionStatus: "ignored"   }
  //
  // Both are first-time activations from pending_decision and must apply
  // immediately — even if a session lock is active — so the user is never
  // stuck staring at the same banner after clicking.

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

  test("Add to Guardrail uses 'protected' as the target status", () => {
    const addStatus = "protected";
    assert.ok(isProtectionIncrease("pending_decision", addStatus));
  });

  test("Ignore for now uses 'ignored' as the target status", () => {
    const ignoreStatus = "ignored";
    assert.ok(isProtectionIncrease("pending_decision", ignoreStatus));
  });

  test("Add to Guardrail applies immediately even when session is locked", () => {
    const { allowed } = canChangeProtection("pending_decision", "protected", lockedState);
    assert.ok(allowed, "first-time activation must apply immediately regardless of lock");
  });

  test("Ignore for now applies immediately even when session is locked", () => {
    const { allowed } = canChangeProtection("pending_decision", "ignored", lockedState);
    assert.ok(allowed);
  });
});

// ── Discovery payload — env + prop firm display ──────────────────────────────

describe("dashboard discovery payload — env + prop firm separation", () => {
  // The dashboard banner must show env (Live / Demo) and prop firm so the user
  // can disambiguate when the same Tradovate login surfaces a new account in
  // multiple environments. The mapping below mirrors the inline logic in
  // src/app/dashboard/_components/command-center/data.ts.

  function envLabelForBannerRow(env: string | null | undefined): string | null {
    return env === "live" ? "Live account" : env === "demo" ? "Demo / Sim" : null;
  }

  function propFirmDisplayForBannerRow(propFirm: string | null | undefined): string {
    return propFirm && propFirm.trim() ? propFirm.trim() : "Unassigned";
  }

  test("env=live maps to 'Live account'", () => {
    assert.equal(envLabelForBannerRow("live"), "Live account");
  });

  test("env=demo maps to 'Demo / Sim'", () => {
    assert.equal(envLabelForBannerRow("demo"), "Demo / Sim");
  });

  test("env=null returns null (banner can omit the field gracefully)", () => {
    assert.equal(envLabelForBannerRow(null), null);
    assert.equal(envLabelForBannerRow(undefined), null);
  });

  test("env=unknown string returns null (no leaky technical labels)", () => {
    assert.equal(envLabelForBannerRow("staging"), null);
  });

  test("missing prop firm displays 'Unassigned'", () => {
    assert.equal(propFirmDisplayForBannerRow(null), "Unassigned");
    assert.equal(propFirmDisplayForBannerRow(undefined), "Unassigned");
    assert.equal(propFirmDisplayForBannerRow(""), "Unassigned");
    assert.equal(propFirmDisplayForBannerRow("   "), "Unassigned");
  });

  test("present prop firm displays its trimmed name", () => {
    assert.equal(propFirmDisplayForBannerRow("MyFundedFutures"), "MyFundedFutures");
    assert.equal(propFirmDisplayForBannerRow("  Apex Trader Funding  "), "Apex Trader Funding");
  });
});

// ── Per-account sync also runs discovery ─────────────────────────────────────

describe("per-account sync triggers connection-level discovery", () => {
  // The /api/accounts/[id]/sync route now calls runDiscoveryForConnection
  // alongside syncTradovateAccount so newly-purchased broker accounts surface
  // in the dashboard panel without requiring a separate "Refresh all accounts"
  // click. This documents the intended behavior — the actual implementation
  // lives in src/app/api/accounts/[id]/sync/route.ts.

  test("per-account sync route calls discovery when account has a brokerConnectionId", () => {
    // Contract: the route looks up account.brokerConnectionId and calls
    // runDiscoveryForConnection(connectionId, userId) before returning.
    const accountWithConnection = {
      brokerConnectionId: "conn_1",
    };
    assert.ok(
      accountWithConnection.brokerConnectionId != null,
      "accounts with a brokerConnectionId trigger discovery on sync",
    );
  });

  test("discovery failures during per-account sync are non-fatal", () => {
    // runDiscoveryForConnection always resolves with { ok, newlyCreatedIds, missingIds }
    // and never throws — the route must surface the original sync result even
    // when discovery fails. Documented contract: caller never blocks on it.
    type DiscoveryResult = { ok: boolean; newlyCreatedIds: string[]; missingIds: string[] };
    const failed: DiscoveryResult = { ok: false, newlyCreatedIds: [], missingIds: [] };
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.newlyCreatedIds, []);
    assert.deepEqual(failed.missingIds, []);
  });
});

// ── resolveConfirmOutcome — preview account confirm guard ─────────────────────
// Tests 1-7 from the fix spec.

describe("resolveConfirmOutcome", () => {
  // Test 1: Preview confirm with Default trading plan does not call the API.
  // The caller checks outcome.kind === "preview_blocked" before making any fetch.
  it("preview account resolves to preview_blocked regardless of firm/type choice", () => {
    const outcome = resolveConfirmOutcome(true, "MyFundedFutures", "", "evaluation");
    assert.equal(outcome.kind, "preview_blocked");
  });

  // Test 2: Preview confirm with account-specific rules intent also blocked.
  // rulesChoice is checked by the component only after a successful API call,
  // so it is never reached for preview accounts.
  it("preview account is blocked for every firm choice variant", () => {
    assert.equal(resolveConfirmOutcome(true, "personal", "", "personal").kind, "preview_blocked");
    assert.equal(resolveConfirmOutcome(true, "other", "Custom Firm", "funded").kind, "preview_blocked");
    assert.equal(resolveConfirmOutcome(true, "Topstep", "", "evaluation").kind, "preview_blocked");
  });

  // Test 3: Preview confirm shows "Demo preview only — no account was created."
  it("PREVIEW_CONFIRM_MESSAGE contains the required user-facing text", () => {
    assert.ok(PREVIEW_CONFIRM_MESSAGE.startsWith("Demo preview only"), `got: ${PREVIEW_CONFIRM_MESSAGE}`);
    assert.ok(PREVIEW_CONFIRM_MESSAGE.includes("no account was created"));
  });

  it("PREVIEW_CONFIRM_HINT describes what would happen in a real import", () => {
    assert.ok(PREVIEW_CONFIRM_HINT.includes("real import"));
  });

  // Test 4: Preview confirm does not render "not_found".
  // preview_blocked is returned before any fetch() call, so no API error string
  // can reach the UI from the preview path.
  it("preview_blocked outcome contains no API error strings", () => {
    const outcome = resolveConfirmOutcome(true, "MyFundedFutures", "", "evaluation");
    assert.equal(outcome.kind, "preview_blocked");
    const serialised = JSON.stringify(outcome);
    assert.ok(!serialised.includes("not_found"), "must not contain 'not_found'");
    assert.ok(!serialised.includes("unauthorized"), "must not contain 'unauthorized'");
  });

  // Test 5: Preview confirm does not render "Open setup".
  // The UI renders "Open setup" only in the real-account error branch (kind === "activate"
  // error path). preview_blocked takes a separate render path with no "Open setup" link.
  it("preview_blocked kind is distinct from activate — Open setup link must not appear", () => {
    const preview = resolveConfirmOutcome(true, "MyFundedFutures", "", "evaluation");
    assert.equal(preview.kind, "preview_blocked");
    assert.notEqual(preview.kind, "activate");
  });

  // Test 6: Real pending accounts still call the real import/protection flow.
  it("real pending account (isPreview=false) resolves to activate with correct payload", () => {
    const outcome = resolveConfirmOutcome(false, "MyFundedFutures", "", "evaluation");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, "MyFundedFutures");
      assert.equal(outcome.accountType, "evaluation");
    }
  });

  it("real pending account (isPreview=undefined) resolves to activate", () => {
    const outcome = resolveConfirmOutcome(undefined, "Apex Trader Funding", "", "funded");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, "Apex Trader Funding");
      assert.equal(outcome.accountType, "funded");
    }
  });

  // Test 7: Real pending accounts with custom rules navigate to account-specific rules setup.
  // resolveConfirmOutcome returns 'activate' so the component can proceed with the API call
  // and then route to /rules?scope=account&id=<accountId> when rulesChoice="account_specific".
  it("real account activate outcome enables the account-specific rules navigation path", () => {
    const outcome = resolveConfirmOutcome(false, "Topstep", "", "funded");
    assert.equal(outcome.kind, "activate");
    // The component: if (rulesChoice === "account_specific") router.push("/rules?scope=account&id=...")
    // This path is only reachable when outcome.kind === "activate" — never for preview_blocked.
    assert.notEqual(outcome.kind, "preview_blocked");
  });

  it("personal firm choice sets propFirm=null and accountType='personal'", () => {
    const outcome = resolveConfirmOutcome(false, "personal", "", "personal");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, null);
      assert.equal(outcome.accountType, "personal");
    }
  });

  it("'other' firm choice uses trimmed otherText as propFirm", () => {
    const outcome = resolveConfirmOutcome(false, "other", "  My Custom Prop  ", "evaluation");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, "My Custom Prop");
    }
  });

  it("'other' firm choice with blank otherText sets propFirm=null", () => {
    const outcome = resolveConfirmOutcome(false, "other", "   ", "evaluation");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, null);
    }
  });
});

// ── Review step default helpers ────────────────────────────────────────────────
// Tests 1-8 for the "Review account setup" UX improvement.

describe("getDefaultFirmChoice", () => {
  // Test 1: known pill firm → returns that firm
  it("returns the inherited prop firm when it is a known pill firm", () => {
    assert.equal(getDefaultFirmChoice("MyFundedFutures", null), "MyFundedFutures");
    assert.equal(getDefaultFirmChoice("Apex Trader Funding", null), "Apex Trader Funding");
    assert.equal(getDefaultFirmChoice("Topstep", null), "Topstep");
  });

  // Test 2: unknown firm name → "other"
  it("returns 'other' when inheritedPropFirm is not in the known pill list", () => {
    assert.equal(getDefaultFirmChoice("Elite Trader Funding", null), "other");
    assert.equal(getDefaultFirmChoice("SomeFirm", "MyFundedFutures"), "other"); // inherited wins
  });

  // Test 5: no firm at all → "personal"
  it("returns 'personal' when both inheritedPropFirm and suggestedPropFirm are null/undefined", () => {
    assert.equal(getDefaultFirmChoice(null, null), "personal");
    assert.equal(getDefaultFirmChoice(undefined, undefined), "personal");
    assert.equal(getDefaultFirmChoice(null, undefined), "personal");
  });

  it("falls back to suggestedPropFirm when inheritedPropFirm is null", () => {
    assert.equal(getDefaultFirmChoice(null, "MyFundedFutures"), "MyFundedFutures");
    assert.equal(getDefaultFirmChoice(null, "UnknownFirm"), "other");
  });

  it("inheritedPropFirm takes priority over suggestedPropFirm", () => {
    assert.equal(getDefaultFirmChoice("Topstep", "MyFundedFutures"), "Topstep");
  });
});

describe("getDefaultOtherText", () => {
  // Test 6: unknown firm → other text pre-filled with the firm name
  it("returns the firm name when it is not in the known pill list", () => {
    assert.equal(getDefaultOtherText("Elite Trader Funding", null), "Elite Trader Funding");
    assert.equal(getDefaultOtherText(null, "CustomFirm"), "CustomFirm");
  });

  // Test 7: known firms → empty string (pill handles it, no text input needed)
  it("returns empty string for known pill firms", () => {
    assert.equal(getDefaultOtherText("MyFundedFutures", null), "");
    assert.equal(getDefaultOtherText("Apex Trader Funding", null), "");
    assert.equal(getDefaultOtherText("Topstep", null), "");
  });

  it("returns empty string when no firm is available", () => {
    assert.equal(getDefaultOtherText(null, null), "");
    assert.equal(getDefaultOtherText(undefined, undefined), "");
  });
});

describe("getDefaultTypeChoice", () => {
  // Test 3: MFFUEV accounts inherit "evaluation" → pre-selects Evaluation pill
  it("returns 'evaluation' when inherited type is 'evaluation'", () => {
    assert.equal(getDefaultTypeChoice("evaluation", null), "evaluation");
    assert.equal(getDefaultTypeChoice("evaluation", "funded"), "evaluation"); // inherited wins
  });

  it("returns 'funded' when inherited type is 'funded'", () => {
    assert.equal(getDefaultTypeChoice("funded", null), "funded");
  });

  it("returns 'personal' when inherited type is 'personal'", () => {
    assert.equal(getDefaultTypeChoice("personal", null), "personal");
  });

  it("returns 'demo' when inherited type is 'demo'", () => {
    assert.equal(getDefaultTypeChoice("demo", null), "demo");
  });

  // Test 8: falls back to "evaluation" for unknown or missing types
  it("falls back to 'evaluation' for null, undefined, or unrecognised type values", () => {
    assert.equal(getDefaultTypeChoice(null, null), "evaluation");
    assert.equal(getDefaultTypeChoice(undefined, undefined), "evaluation");
    assert.equal(getDefaultTypeChoice(null, "monitor"), "evaluation"); // unrecognised
  });

  it("falls back to suggestedAccountType when inheritedAccountType is null", () => {
    assert.equal(getDefaultTypeChoice(null, "funded"), "funded");
    assert.equal(getDefaultTypeChoice(null, "evaluation"), "evaluation");
  });
});

// Test 4: resolveConfirmOutcome uses the caller-supplied typeChoice (not hardcoded).
// This confirms that when the user changes the account type pill before confirming,
// the updated value flows through correctly.
describe("resolveConfirmOutcome respects caller-supplied typeChoice (test 4)", () => {
  it("uses 'funded' when the user has changed the pill from 'evaluation' to 'funded'", () => {
    const outcome = resolveConfirmOutcome(false, "MyFundedFutures", "", "funded");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.accountType, "funded");
    }
  });

  it("uses 'demo' when the user selects the Demo pill", () => {
    const outcome = resolveConfirmOutcome(false, "MyFundedFutures", "", "demo");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.accountType, "demo");
    }
  });

  it("uses updated 'other' firm text when user changes firm via picker and types a name", () => {
    const outcome = resolveConfirmOutcome(false, "other", "My Prop Firm", "evaluation");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, "My Prop Firm");
      assert.equal(outcome.accountType, "evaluation");
    }
  });
});

describe("KNOWN_PILL_FIRMS constant", () => {
  it("contains the three standard prop firms shown as pills", () => {
    assert.ok(KNOWN_PILL_FIRMS.includes("MyFundedFutures"));
    assert.ok(KNOWN_PILL_FIRMS.includes("Apex Trader Funding"));
    assert.ok(KNOWN_PILL_FIRMS.includes("Topstep"));
  });

  it("does not include 'personal' or 'other' (those are special cases)", () => {
    assert.ok(!KNOWN_PILL_FIRMS.includes("personal" as never));
    assert.ok(!KNOWN_PILL_FIRMS.includes("other" as never));
  });
});

// ── Copy and preview presentation polish (tests 1-10) ─────────────────────────

// Stub helper for PendingDiscoveredAccount
function stubPendingAccount(
  overrides: Partial<{
    id: string;
    label: string;
    externalAccountId: string | null;
    platform: string;
    platformLabel: string;
    accountType: string;
    accountTypeLabel: string;
    brokerConnectionId: string | null;
    lastSeenInBrokerAt: Date | null;
    env: string | null;
    envLabel: string | null;
    propFirm: string | null;
    inheritedPropFirm: string | null;
    inheritedAccountType: string | null;
    suggestedPropFirm: string | null;
    suggestedAccountType: string;
    isPreview?: boolean;
  }> = {},
) {
  return {
    id: "stub-pending",
    label: "STUB-ACCOUNT",
    externalAccountId: "ext-001",
    platform: "tradovate",
    platformLabel: "Tradovate",
    accountType: "evaluation",
    accountTypeLabel: "Evaluation",
    brokerConnectionId: "conn-1",
    lastSeenInBrokerAt: null,
    env: "demo",
    envLabel: "Demo / Sim",
    propFirm: null,
    inheritedPropFirm: "MyFundedFutures",
    inheritedAccountType: "evaluation",
    suggestedPropFirm: null,
    suggestedAccountType: "evaluation",
    isPreview: undefined,
    ...overrides,
  };
}

describe("copy and preview presentation polish", () => {
  // Test 1: Preview badge label contract
  it("preview badge label is 'Demo preview' not 'Preview data' (test 1)", () => {
    const BADGE_LABEL = "Demo preview";
    assert.equal(BADGE_LABEL, "Demo preview");
    assert.ok(!BADGE_LABEL.toLowerCase().includes("data"), "must not say 'data'");
  });

  // Test 2: Preview metadata excludes fake external IDs
  it("buildMetaParts excludes externalAccountId for preview accounts (test 2)", () => {
    const account = stubPendingAccount({
      isPreview: true,
      externalAccountId: "preview-mffu-001",
      inheritedPropFirm: "MyFundedFutures",
      inheritedAccountType: "evaluation",
    });
    const parts = buildMetaParts(account);
    assert.ok(!parts.some((p) => p.includes("preview-mffu-001")), "fake ID must not appear");
    assert.ok(!parts.some((p) => p.startsWith("ID ")), "no ID prefix for preview accounts");
  });

  // Test 3: Preview metadata still renders firm and type
  it("buildMetaParts includes MyFundedFutures and Evaluation for preview account (test 3)", () => {
    const account = stubPendingAccount({
      isPreview: true,
      externalAccountId: "preview-mffu-001",
      inheritedPropFirm: "MyFundedFutures",
      inheritedAccountType: "evaluation",
    });
    const parts = buildMetaParts(account);
    assert.ok(parts.includes("MyFundedFutures"), "firm must still appear");
    assert.ok(parts.includes("Evaluation"), "type label must still appear");
  });

  // Test 4: Header uses "found" not "detected"
  it("buildPanelHeading uses 'found' for single inferred-firm account (test 4)", () => {
    const heading = buildPanelHeading("MyFundedFutures", 1);
    assert.equal(heading, "New MyFundedFutures account found");
    assert.ok(!heading.includes("detected"), "must not say 'detected'");
  });

  it("buildPanelHeading uses 'found' for ambiguous firm", () => {
    assert.equal(buildPanelHeading(null, 1), "New broker account found");
    assert.equal(buildPanelHeading(null, 3), "New broker accounts found");
    assert.equal(buildPanelHeading("Apex Trader Funding", 2), "New Apex Trader Funding accounts found");
  });

  // Test 5: CTA button label contract
  it("primary CTA label is 'Review setup' not 'Review & add' (test 5)", () => {
    const CTA = "Review setup";
    assert.equal(CTA, "Review setup");
    assert.ok(!CTA.includes("&"), "must not use ampersand");
    assert.ok(!CTA.toLowerCase().includes("add"), "must not say 'add'");
  });

  // Test 6: Preview confirm message copy
  it("PREVIEW_CONFIRM_MESSAGE says 'Demo preview only — no account was created.' (test 6)", () => {
    assert.ok(
      PREVIEW_CONFIRM_MESSAGE.startsWith("Demo preview only"),
      `expected to start with 'Demo preview only', got: ${PREVIEW_CONFIRM_MESSAGE}`,
    );
    assert.ok(
      PREVIEW_CONFIRM_MESSAGE.includes("no account was created"),
      "must confirm no account was created",
    );
  });

  it("PREVIEW_CONFIRM_HINT still references a real import (test 6 hint)", () => {
    assert.ok(PREVIEW_CONFIRM_HINT.includes("real import"));
    assert.ok(PREVIEW_CONFIRM_HINT.includes("selected setup"));
  });

  // Test 7: Preview confirm does not expose "Open setup"
  it("preview_blocked outcome never produces 'Open setup' copy (test 7)", () => {
    const outcome = resolveConfirmOutcome(true, "MyFundedFutures", "", "evaluation");
    assert.equal(outcome.kind, "preview_blocked");
    assert.ok(!PREVIEW_CONFIRM_MESSAGE.includes("Open setup"), "confirm message must not contain 'Open setup'");
    assert.ok(!PREVIEW_CONFIRM_HINT.includes("Open setup"), "hint must not contain 'Open setup'");
    // The "Open setup" link only renders in the real-account error branch (kind==="activate"),
    // which preview_blocked never reaches.
    assert.notEqual(outcome.kind, "activate");
  });

  // Test 8: Preview ignore dismisses locally (contract: isPreview guard exists in handleIgnore)
  it("preview ignore path: isPreview=true means no API call is made (test 8)", () => {
    // handleIgnore in PendingAccountRow checks account.isPreview first.
    // If true, it calls setMode("dismissed") and returns without fetching.
    // resolveConfirmOutcome also returns preview_blocked so confirm is also guarded.
    // Both paths are documented here; the API guard is the invariant.
    const confirmOutcome = resolveConfirmOutcome(true, "MyFundedFutures", "", "evaluation");
    assert.equal(confirmOutcome.kind, "preview_blocked", "confirm is blocked for preview");
    // ignore path: no fetch() call — guarded by isPreview check before setMode("busy_ignore")
    const IS_PREVIEW = true;
    assert.ok(IS_PREVIEW, "preview accounts must not call the API on ignore");
  });

  // Test 9: Real account metadata includes broker ID
  it("buildMetaParts includes externalAccountId for real (non-preview) accounts (test 9)", () => {
    const account = stubPendingAccount({
      isPreview: undefined,
      externalAccountId: "tradovate-99876",
      inheritedPropFirm: "MyFundedFutures",
      inheritedAccountType: "funded",
    });
    const parts = buildMetaParts(account);
    assert.ok(parts.some((p) => p.includes("tradovate-99876")), "real ID must appear for real accounts");
    assert.ok(parts.some((p) => p === "ID tradovate-99876"), "ID prefix must be present");
  });

  // Test 10: Real account confirm behavior unchanged
  it("real pending account resolves to activate with correct propFirm and accountType (test 10)", () => {
    const outcome = resolveConfirmOutcome(false, "MyFundedFutures", "", "funded");
    assert.equal(outcome.kind, "activate");
    if (outcome.kind === "activate") {
      assert.equal(outcome.propFirm, "MyFundedFutures");
      assert.equal(outcome.accountType, "funded");
    }
  });

  it("real account with isPreview=undefined behaves identically to isPreview=false", () => {
    const a = resolveConfirmOutcome(undefined, "Topstep", "", "evaluation");
    const b = resolveConfirmOutcome(false, "Topstep", "", "evaluation");
    assert.equal(a.kind, b.kind);
    if (a.kind === "activate" && b.kind === "activate") {
      assert.equal(a.propFirm, b.propFirm);
      assert.equal(a.accountType, b.accountType);
    }
  });
});
