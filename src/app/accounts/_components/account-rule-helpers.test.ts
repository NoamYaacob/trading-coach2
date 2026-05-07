import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPropFirmDescriptor,
  deriveRulesLabel,
  deriveEnforcementLabelValues,
  deriveStopContext,
} from "./account-rule-helpers.ts";

// ── formatPropFirmDescriptor ──────────────────────────────────────────────────

describe("formatPropFirmDescriptor", () => {
  it("returns 'MyFundedFutures · Evaluation' without claiming a specific program", () => {
    const out = formatPropFirmDescriptor("MyFundedFutures", "evaluation");
    assert.equal(out, "MyFundedFutures · Evaluation");
    assert.ok(!out!.includes("Builder"), "must not infer a specific program from metadata");
  });

  it("formats funded and personal account types", () => {
    assert.equal(formatPropFirmDescriptor("Topstep", "funded"), "Topstep · Funded");
    assert.equal(formatPropFirmDescriptor("Apex", "evaluation"), "Apex · Evaluation");
  });

  it("preserves an unrecognised account-type string verbatim", () => {
    assert.equal(formatPropFirmDescriptor("MyFundedFutures", "pa"), "MyFundedFutures · pa");
  });

  it("returns null when propFirm is null or empty", () => {
    assert.equal(formatPropFirmDescriptor(null, "evaluation"), null);
    assert.equal(formatPropFirmDescriptor("", "evaluation"), null);
    assert.equal(formatPropFirmDescriptor("   ", "evaluation"), null);
  });

  it("trims surrounding whitespace from the propFirm string", () => {
    assert.equal(formatPropFirmDescriptor("  MyFundedFutures  ", "evaluation"), "MyFundedFutures · Evaluation");
  });
});

// ── deriveRulesLabel ──────────────────────────────────────────────────────────

describe("deriveRulesLabel", () => {
  // Test 2: Account with propFirm but no AccountRiskRules shows "Default trading plan"
  it("shows 'Default trading plan' for a prop firm account with no account-specific rules", () => {
    assert.equal(deriveRulesLabel(false, true, true), "Default trading plan");
  });

  // Test 3: Account with propFirm and AccountRiskRules shows "Custom rules"
  it("shows 'Custom rules' for a prop firm account with account-specific rules", () => {
    assert.equal(deriveRulesLabel(true, true, true), "Custom rules");
    assert.equal(deriveRulesLabel(true, false, true), "Custom rules");
  });

  it("shows 'Custom rules' for a non-prop-firm account with account-specific rules", () => {
    assert.equal(deriveRulesLabel(true, true, false), "Custom rules");
    assert.equal(deriveRulesLabel(true, false, false), "Custom rules");
  });

  it("shows 'Default trading plan' when default plan applies and no prop firm is set", () => {
    assert.equal(deriveRulesLabel(false, true, false), "Default trading plan");
  });

  it("shows 'No rules configured' when neither account-specific nor default rules exist", () => {
    assert.equal(deriveRulesLabel(false, false, true), "No rules configured");
    assert.equal(deriveRulesLabel(false, false, false), "No rules configured");
  });

  // Test 1: Dashboard must not render "prop firm preset" anywhere in rules labels
  it("never produces 'prop firm preset' in the rules label regardless of inputs", () => {
    for (const has of [true, false]) {
      for (const def of [true, false]) {
        for (const firm of [true, false]) {
          const label = deriveRulesLabel(has, def, firm);
          assert.ok(
            !label.includes("prop firm preset"),
            `unexpected 'prop firm preset' in label: "${label}"`,
          );
        }
      }
    }
  });

  it("never returns a program-specific label like 'MFF Builder' from metadata alone", () => {
    const label = deriveRulesLabel(true, true, true);
    assert.ok(!label.includes("Builder"), `must not include 'Builder': ${label}`);
    assert.ok(!label.includes("MFF"), `must not include 'MFF': ${label}`);
  });

  // Test 4: prop firm / account type appear as secondary metadata via formatPropFirmDescriptor,
  // not embedded in the rules label itself
  it("does not embed propFirm or accountType text in the rules label", () => {
    // The descriptor "MyFundedFutures · Evaluation" must come from formatPropFirmDescriptor,
    // not from deriveRulesLabel. The rules label is classification-agnostic.
    const label = deriveRulesLabel(false, true, true);
    assert.ok(!label.includes("MyFundedFutures"), "firm name must not appear in rules label");
    assert.ok(!label.includes("Evaluation"), "account type must not appear in rules label");
  });
});

// ── deriveEnforcementLabelValues ─────────────────────────────────────────────

describe("deriveEnforcementLabelValues", () => {
  const today = "2026-05-05";

  it("shows 'Internal Guardrail lock' when riskState is STOPPED today (account-scoped)", () => {
    const result = deriveEnforcementLabelValues(null, "STOPPED", today, today);
    assert.equal(result.label, "Internal Guardrail lock");
    assert.ok(result.cls.includes("red"), "should use red styling");
  });

  it("does NOT show 'Broker-enforced' for a read-only connection that hit a stop", () => {
    // Read-only Tradovate connections never produce brokerLockStatus="broker_locked".
    // The chip must remain "Internal Guardrail lock", not "Broker-enforced".
    const result = deriveEnforcementLabelValues(null, "STOPPED", today, today);
    assert.notEqual(result.label, "Broker-enforced");
    assert.equal(result.label, "Internal Guardrail lock");
  });

  it("shows 'Broker-enforced' only when brokerLockStatus is explicitly 'broker_locked'", () => {
    const result = deriveEnforcementLabelValues("broker_locked", "STOPPED", today, today);
    assert.equal(result.label, "Broker-enforced");
  });

  it("shows 'Monitoring only' when riskState is NORMAL", () => {
    assert.equal(deriveEnforcementLabelValues(null, "NORMAL", today, today).label, "Monitoring only");
  });

  it("shows 'Monitoring only' when sessionDate is not today (stale state)", () => {
    assert.equal(
      deriveEnforcementLabelValues(null, "STOPPED", "2026-05-04", today).label,
      "Monitoring only",
    );
  });

  it("does not leak STOPPED state from another day — the lock is scoped to the current session date", () => {
    // The function only returns Internal Guardrail lock when sessionDate === today.
    // A STOPPED riskState carried from a prior day's session must read as
    // 'Monitoring only' for the current day.
    assert.equal(
      deriveEnforcementLabelValues(null, "STOPPED", "2026-05-04", today).label,
      "Monitoring only",
    );
  });

  it("shows 'Monitoring only' when sessionState is absent", () => {
    assert.equal(deriveEnforcementLabelValues(null, null, null, today).label, "Monitoring only");
  });
});

// ── deriveStopContext ─────────────────────────────────────────────────────────

describe("deriveStopContext", () => {
  it("uses 'Prop firm daily loss limit reached' when hasPropFirm is true", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.lockNote.startsWith("Prop firm daily loss limit reached"), `lockNote: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("$1,000"), `lockNote: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("locked"), `lockNote: ${ctx.lockNote}`);
  });

  it("uses 'Daily loss limit reached' when hasPropFirm is false", () => {
    const ctx = deriveStopContext({
      hasPropFirm: false,
      dailyLossLimit: 500,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.lockNote.startsWith("Daily loss limit reached"), `lockNote: ${ctx.lockNote}`);
    assert.ok(!ctx.lockNote.startsWith("Prop firm"), "should not prefix with Prop firm when none is set");
  });

  it("never names a specific program (no 'MFF Builder' / 'MFF Funded' leakage)", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(!ctx.lockNote.includes("Builder"), `must not include 'Builder': ${ctx.lockNote}`);
    assert.ok(!ctx.lockNote.includes("MFF"), `must not include 'MFF': ${ctx.lockNote}`);
  });

  it("adds the read-only note for connected_readonly connections", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.readOnlyNote !== null, "should have read-only note");
    assert.ok(ctx.readOnlyNote!.includes("Broker-side blocking"), `readOnlyNote: ${ctx.readOnlyNote}`);
    assert.ok(ctx.readOnlyNote!.includes("not active"), `readOnlyNote: ${ctx.readOnlyNote}`);
  });

  it("omits the read-only note for live connections", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: 1000,
      connectionStatus: "connected_live",
    });
    assert.equal(ctx.readOnlyNote, null);
  });

  it("omits the dollar amount when dailyLossLimit is null", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: null,
      connectionStatus: "connected_readonly",
    });
    assert.ok(!ctx.lockNote.includes("$"), `should not include dollar amount: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("locked"), `should still say locked: ${ctx.lockNote}`);
  });

  it("formats large limit values with thousand separators", () => {
    const ctx = deriveStopContext({
      hasPropFirm: true,
      dailyLossLimit: 25000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.lockNote.includes("$25,000"), `lockNote: ${ctx.lockNote}`);
  });
});
