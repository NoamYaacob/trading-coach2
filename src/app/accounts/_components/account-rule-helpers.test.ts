import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  derivePropFirmLabel,
  deriveRulesLabel,
  deriveEnforcementLabelValues,
  deriveStopContext,
} from "./account-rule-helpers.ts";

// ── derivePropFirmLabel ────────────────────────────────────────────────────────

describe("derivePropFirmLabel", () => {
  it("returns 'MFF Builder' for MyFundedFutures evaluation accounts", () => {
    assert.equal(derivePropFirmLabel("MyFundedFutures", "evaluation"), "MFF Builder");
  });

  it("is case-insensitive for the firm name", () => {
    assert.equal(derivePropFirmLabel("myfundedfutures", "evaluation"), "MFF Builder");
    assert.equal(derivePropFirmLabel("MYFUNDEDFUTURES", "evaluation"), "MFF Builder");
  });

  it("returns 'MFF Funded' for funded accounts", () => {
    assert.equal(derivePropFirmLabel("MyFundedFutures", "funded"), "MFF Funded");
  });

  it("returns 'MFF' when accountType is unrecognised", () => {
    assert.equal(derivePropFirmLabel("MyFundedFutures", "demo"), "MFF");
  });

  it("matches bare 'mff' abbreviation", () => {
    assert.equal(derivePropFirmLabel("mff", "evaluation"), "MFF Builder");
  });

  it("returns null for unknown firms", () => {
    assert.equal(derivePropFirmLabel("Topstep", "evaluation"), null);
    assert.equal(derivePropFirmLabel("Apex", "funded"), null);
  });

  it("returns null when propFirm is null", () => {
    assert.equal(derivePropFirmLabel(null, "evaluation"), null);
  });
});

// ── deriveRulesLabel ──────────────────────────────────────────────────────────

describe("deriveRulesLabel", () => {
  it("shows 'MFF Builder rule' when account has account-specific rules", () => {
    assert.equal(
      deriveRulesLabel(true, true, "MyFundedFutures", "evaluation"),
      "MFF Builder rule",
    );
  });

  it("shows 'Default plan · MFF Builder' when using default plan on MFF account", () => {
    assert.equal(
      deriveRulesLabel(false, true, "MyFundedFutures", "evaluation"),
      "Default plan · MFF Builder",
    );
  });

  it("shows 'Account rules' for non-MFF account with account-specific rules", () => {
    assert.equal(deriveRulesLabel(true, true, null, "evaluation"), "Account rules");
    assert.equal(deriveRulesLabel(true, false, "Topstep", "evaluation"), "Account rules");
  });

  it("shows 'Default plan' for non-MFF account using default plan", () => {
    assert.equal(deriveRulesLabel(false, true, null, "evaluation"), "Default plan");
  });

  it("shows 'No rules' when neither account nor default rules exist", () => {
    assert.equal(deriveRulesLabel(false, false, "MyFundedFutures", "evaluation"), "No rules");
    assert.equal(deriveRulesLabel(false, false, null, "evaluation"), "No rules");
  });
});

// ── deriveEnforcementLabelValues ─────────────────────────────────────────────

describe("deriveEnforcementLabelValues", () => {
  const today = "2026-05-05";

  it("shows 'Internal lock' when riskState is STOPPED for today — lock is account-scoped", () => {
    const result = deriveEnforcementLabelValues(null, "STOPPED", today, today);
    assert.equal(result.label, "Internal lock");
    assert.ok(result.cls.includes("red"), "should use red styling");
  });

  it("does NOT show 'Broker-enforced' on a read-only connection when account is STOPPED", () => {
    // A read-only connection never sets brokerLockStatus to broker_locked,
    // so the enforcement label is 'Internal lock', not 'Broker-enforced'.
    const result = deriveEnforcementLabelValues(null, "STOPPED", today, today);
    assert.notEqual(result.label, "Broker-enforced");
  });

  it("shows 'Broker-enforced' only when brokerLockStatus is explicitly broker_locked", () => {
    const result = deriveEnforcementLabelValues("broker_locked", "STOPPED", today, today);
    assert.equal(result.label, "Broker-enforced");
  });

  it("shows 'Monitoring only' when riskState is NORMAL", () => {
    const result = deriveEnforcementLabelValues(null, "NORMAL", today, today);
    assert.equal(result.label, "Monitoring only");
  });

  it("shows 'Monitoring only' when sessionDate is not today (stale state)", () => {
    const result = deriveEnforcementLabelValues(null, "STOPPED", "2026-05-04", today);
    assert.equal(result.label, "Monitoring only");
  });

  it("shows 'Monitoring only' when sessionState is absent", () => {
    const result = deriveEnforcementLabelValues(null, null, null, today);
    assert.equal(result.label, "Monitoring only");
  });
});

// ── deriveStopContext ─────────────────────────────────────────────────────────

describe("deriveStopContext", () => {
  it("includes MFF Builder firm label and dollar limit in lockNote", () => {
    const ctx = deriveStopContext({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.lockNote.includes("MFF Builder"), `lockNote: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("$1,000"), `lockNote: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("locked"), `lockNote: ${ctx.lockNote}`);
  });

  it("adds read-only note for connected_readonly connections", () => {
    const ctx = deriveStopContext({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.readOnlyNote !== null, "should have read-only note");
    assert.ok(
      ctx.readOnlyNote!.includes("Broker-side blocking"),
      `readOnlyNote: ${ctx.readOnlyNote}`,
    );
    assert.ok(
      ctx.readOnlyNote!.includes("not active"),
      `readOnlyNote: ${ctx.readOnlyNote}`,
    );
  });

  it("omits read-only note for live connections", () => {
    const ctx = deriveStopContext({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      dailyLossLimit: 1000,
      connectionStatus: "connected_live",
    });
    assert.equal(ctx.readOnlyNote, null);
  });

  it("adds MFF soft-pause note for MFF accounts", () => {
    const ctx = deriveStopContext({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      dailyLossLimit: 1000,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.softPauseNote !== null, "should have soft pause note");
    assert.ok(
      ctx.softPauseNote!.includes("MyFundedFutures"),
      `softPauseNote: ${ctx.softPauseNote}`,
    );
    assert.ok(
      ctx.softPauseNote!.includes("soft pause"),
      `softPauseNote: ${ctx.softPauseNote}`,
    );
  });

  it("omits MFF soft-pause note for non-MFF accounts", () => {
    const ctx = deriveStopContext({
      propFirm: "Topstep",
      accountType: "evaluation",
      dailyLossLimit: 2000,
      connectionStatus: "connected_readonly",
    });
    assert.equal(ctx.softPauseNote, null);
  });

  it("shows generic label when propFirm is null", () => {
    const ctx = deriveStopContext({
      propFirm: null,
      accountType: "personal",
      dailyLossLimit: 500,
      connectionStatus: "connected_readonly",
    });
    assert.ok(ctx.lockNote.includes("Daily loss limit reached"), `lockNote: ${ctx.lockNote}`);
    assert.ok(!ctx.lockNote.includes("MFF"), `should not mention MFF: ${ctx.lockNote}`);
  });

  it("omits dollar amount when dailyLossLimit is null", () => {
    const ctx = deriveStopContext({
      propFirm: "MyFundedFutures",
      accountType: "evaluation",
      dailyLossLimit: null,
      connectionStatus: "connected_readonly",
    });
    assert.ok(!ctx.lockNote.includes("$"), `should not include dollar amount: ${ctx.lockNote}`);
    assert.ok(ctx.lockNote.includes("locked"), `should still say locked: ${ctx.lockNote}`);
  });
});
