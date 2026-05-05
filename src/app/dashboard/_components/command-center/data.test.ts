import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, derivePropFirmSetupNeeded, deriveBreachReason } from "./data-helpers.ts";

// ── deriveStatus ──────────────────────────────────────────────────────────────

describe("deriveStatus", () => {
  const base = {
    isActive: true,
    platform: "tradovate",
    connectionStatus: "connected_readonly",
    hasAnyRules: true,
    propFirmSetupNeeded: false,
    riskState: null as "NORMAL" | "WARNING" | "STOPPED" | null,
    dailyLossUsedPct: null,
    tradesCount: null,
    maxTradesPerDay: null,
  };

  it("returns 'locked' when riskState is STOPPED — matches broker connections page", () => {
    assert.equal(deriveStatus({ ...base, riskState: "STOPPED" }), "locked");
  });

  it("returns 'locked' for STOPPED even when propFirmSetupNeeded is true", () => {
    // A prop firm account that hit its daily loss limit is locked, not setup_needed.
    // propFirmSetupNeeded must not override a live STOPPED state.
    const result = deriveStatus({ ...base, riskState: "STOPPED", propFirmSetupNeeded: true });
    assert.equal(result, "locked");
    assert.notEqual(result, "setup_needed");
  });

  it("does not show 'setup_needed' for a STOPPED prop-firm account covered only by default rules", () => {
    // Default plan covers the account → propFirmSetupNeeded should be false upstream,
    // but even if caller passes true, STOPPED must win.
    const result = deriveStatus({
      ...base,
      riskState: "STOPPED",
      propFirmSetupNeeded: true,
      hasAnyRules: true,
    });
    assert.notEqual(result, "setup_needed");
  });

  it("returns 'warning' when riskState is WARNING", () => {
    assert.equal(deriveStatus({ ...base, riskState: "WARNING" }), "warning");
  });

  it("returns 'locked' when daily loss pct >= 1", () => {
    assert.equal(deriveStatus({ ...base, dailyLossUsedPct: 1.0 }), "locked");
  });

  it("returns 'warning' when daily loss pct is 0.8–0.99", () => {
    assert.equal(deriveStatus({ ...base, dailyLossUsedPct: 0.85 }), "warning");
  });

  it("returns 'locked' when tradesCount >= maxTradesPerDay", () => {
    assert.equal(
      deriveStatus({ ...base, tradesCount: 3, maxTradesPerDay: 3 }),
      "locked",
    );
  });

  it("returns 'warning' when tradesCount === maxTradesPerDay - 1", () => {
    assert.equal(
      deriveStatus({ ...base, tradesCount: 2, maxTradesPerDay: 3 }),
      "warning",
    );
  });

  it("returns 'setup_needed' when there are no rules and riskState is null", () => {
    assert.equal(
      deriveStatus({ ...base, hasAnyRules: false, riskState: null }),
      "setup_needed",
    );
  });

  it("returns 'setup_needed' for propFirmSetupNeeded when riskState is null", () => {
    assert.equal(
      deriveStatus({ ...base, propFirmSetupNeeded: true, riskState: null }),
      "setup_needed",
    );
  });

  it("returns 'allowed' when connected with rules and riskState is NORMAL", () => {
    assert.equal(deriveStatus({ ...base, riskState: "NORMAL" }), "allowed");
  });

  it("returns 'allowed' when connected with rules and no session state", () => {
    assert.equal(deriveStatus({ ...base, riskState: null }), "allowed");
  });

  it("returns 'not_connected' for expired connections", () => {
    assert.equal(
      deriveStatus({ ...base, connectionStatus: "expired" }),
      "not_connected",
    );
  });

  it("returns 'setup_needed' for pending_webhook connections", () => {
    assert.equal(
      deriveStatus({ ...base, connectionStatus: "pending_webhook" }),
      "setup_needed",
    );
  });
});

// ── deriveBreachReason ────────────────────────────────────────────────────────

describe("deriveBreachReason", () => {
  const base = {
    status: "locked" as const,
    riskState: "STOPPED" as const,
    dailyLossUsedPct: 1.0,
    tradesCount: null,
    maxTradesPerDay: null,
    consecutiveLosses: null,
    stopAfterLosses: null,
  };

  it("returns null when status is allowed", () => {
    assert.equal(
      deriveBreachReason({ ...base, status: "allowed", riskState: null, dailyLossUsedPct: null }),
      null,
    );
  });

  it("returns null when status is setup_needed", () => {
    assert.equal(
      deriveBreachReason({ ...base, status: "setup_needed", riskState: null, dailyLossUsedPct: null }),
      null,
    );
  });

  it("daily loss limit reached — shows locked headline without trade count", () => {
    const result = deriveBreachReason(base);
    assert.ok(result !== null);
    assert.equal(result.headline, "Daily loss limit reached");
    assert.equal(result.detail, "This account is locked for the rest of the trading day.");
    assert.ok(!result.headline.includes("/"), "headline must not show trade counts");
  });

  it("daily loss + trades at limit — still shows daily loss headline only (no 'Max trades exceeded')", () => {
    const result = deriveBreachReason({
      ...base,
      tradesCount: 12,
      maxTradesPerDay: 3,
    });
    assert.ok(result !== null);
    assert.equal(result.headline, "Daily loss limit reached");
    assert.ok(!result.detail?.includes("Max trades"), "must not mention 'Max trades exceeded'");
    assert.ok(!result.detail?.includes("12"), "must not show raw trade count in detail");
  });

  it("trade limit breach — softened copy, no raw count in headline", () => {
    const result = deriveBreachReason({
      ...base,
      riskState: "STOPPED",
      dailyLossUsedPct: null,
      tradesCount: 12,
      maxTradesPerDay: 3,
    });
    assert.ok(result !== null);
    assert.equal(result.headline, "Trade activity may exceed limit");
    assert.ok(result.detail?.includes("Tradovate"), "detail should reference Tradovate report");
    assert.ok(!result.headline.includes("12"), "headline must not show raw count");
    assert.ok(!result.headline.includes("3"), "headline must not show limit");
  });

  it("trade warning (one trade left) — shows specific warning copy", () => {
    const result = deriveBreachReason({
      ...base,
      status: "warning",
      riskState: "WARNING",
      dailyLossUsedPct: null,
      tradesCount: 2,
      maxTradesPerDay: 3,
    });
    assert.ok(result !== null);
    assert.ok(result.headline.includes("2/3"), "warning headline shows count/limit");
    assert.equal(result.detail, "One trade left today.");
  });

  it("loss streak breach — shows streak/limit ratio", () => {
    const result = deriveBreachReason({
      ...base,
      riskState: null,
      dailyLossUsedPct: null,
      status: "locked",
      consecutiveLosses: 3,
      stopAfterLosses: 3,
    });
    assert.ok(result !== null);
    assert.ok(result.headline.includes("3/3"), "should show consecutive losses ratio");
  });

  it("approaching daily loss (80% used, warning status) — specific headline", () => {
    const result = deriveBreachReason({
      ...base,
      status: "warning",
      riskState: "WARNING",
      dailyLossUsedPct: 0.85,
    });
    assert.ok(result !== null);
    assert.equal(result.headline, "Approaching daily loss limit");
  });
});

// ── derivePropFirmSetupNeeded ──────────────────────────────────────────────────

describe("derivePropFirmSetupNeeded", () => {
  const propFirmBase = {
    isPropFirm: true,
    hasAccountRules: false,
    hasDefaultRules: false,
    hasPropFirmDailyLossLimit: false,
    hasPropFirmMaxDrawdown: false,
    hasPropFirmDrawdownRemaining: false,
  };

  it("returns false when not a prop firm account", () => {
    assert.equal(
      derivePropFirmSetupNeeded({ ...propFirmBase, isPropFirm: false }),
      false,
    );
  });

  it("returns false when default plan covers the account — 'Firm rules missing' must not show", () => {
    // MFF evaluation accounts covered by the user's default $1,000/day plan.
    // propFirmSetupNeeded must be false so status resolves to locked, not setup_needed.
    assert.equal(
      derivePropFirmSetupNeeded({ ...propFirmBase, hasDefaultRules: true }),
      false,
    );
  });

  it("returns false when account-specific rules cover the account", () => {
    assert.equal(
      derivePropFirmSetupNeeded({ ...propFirmBase, hasAccountRules: true }),
      false,
    );
  });

  it("returns false when propFirmDailyLossLimit is set even without other coverage", () => {
    assert.equal(
      derivePropFirmSetupNeeded({ ...propFirmBase, hasPropFirmDailyLossLimit: true }),
      false,
    );
  });

  it("returns false when propFirmMaxDrawdown is set", () => {
    assert.equal(
      derivePropFirmSetupNeeded({ ...propFirmBase, hasPropFirmMaxDrawdown: true }),
      false,
    );
  });

  it("returns true only when prop firm account has truly no rule coverage", () => {
    assert.equal(derivePropFirmSetupNeeded(propFirmBase), true);
  });
});
