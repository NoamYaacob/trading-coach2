import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveStatus,
  derivePropFirmSetupNeeded,
  deriveBreachReason,
  getTradeCountDisplay,
  deriveBrokerEnforcementCopy,
  deriveFlattenCopy,
  deriveEnforcementMode,
  deriveAccountKind,
  deriveStaleSyncWarning,
  deriveConnectionStatusLabel,
  deriveFooterCopy,
  deriveGroupStateSuffix,
  derivePerAccountStateLabel,
  deriveProtectionStatusPanel,
  deriveRowStatusLabel,
  shouldShowEnforcementChip,
  DRY_RUN_BANNER_COPY,
  ESTIMATED_TRADE_COUNT_HINT,
  ESTIMATED_TRADE_COUNT_SHORT,
} from "./data-helpers.ts";

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

  // ── missingFromBrokerSince → unavailable ─────────────────────────────────
  // When the broker's /account/list no longer returns this account, every
  // cached number is suspect. The status must flip to "unavailable" and
  // beat every other state, including STOPPED — we cannot trust riskState
  // computed against stale fills.

  it("returns 'unavailable' when missingFromBrokerSince is set", () => {
    assert.equal(
      deriveStatus({ ...base, missingFromBrokerSince: new Date("2026-05-04T12:00:00Z") }),
      "unavailable",
    );
  });

  it("'unavailable' wins over riskState=STOPPED (don't trust stale lock state)", () => {
    assert.equal(
      deriveStatus({
        ...base,
        riskState: "STOPPED",
        missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
      }),
      "unavailable",
    );
  });

  it("'unavailable' wins over a verified trade-count limit breach", () => {
    assert.equal(
      deriveStatus({
        ...base,
        tradesCount: 5,
        maxTradesPerDay: 3,
        tradeCountSource: "verified",
        missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
      }),
      "unavailable",
    );
  });

  it("inactive accounts stay 'not_connected' even when also missing", () => {
    assert.equal(
      deriveStatus({
        ...base,
        isActive: false,
        missingFromBrokerSince: new Date("2026-05-04T12:00:00Z"),
      }),
      "not_connected",
    );
  });

  it("returns 'allowed' when missingFromBrokerSince is null (broker still returns the account)", () => {
    assert.equal(
      deriveStatus({ ...base, missingFromBrokerSince: null }),
      "allowed",
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

// ── getTradeCountDisplay ─────────────────────────────────────────────────────

describe("getTradeCountDisplay", () => {
  const baseAccount = {
    platform: "tradovate",
    fillsSyncedAt: new Date("2026-05-05T12:00:00Z"),
    lastSyncAt: new Date("2026-05-05T12:00:00Z"),
    tradeCountSource: "verified" as "verified" | "estimated" | "unavailable",
    tradesCount: 2 as number | null,
    maxTradesPerDay: 3 as number | null,
    tradesUsedPct: 2 / 3 as number | null,
  };

  it("verified count returns kind=verified with numeric data and pct", () => {
    const display = getTradeCountDisplay(baseAccount);
    assert.equal(display.kind, "verified");
    if (display.kind === "verified") {
      assert.equal(display.used, 2);
      assert.equal(display.max, 3);
      assert.equal(display.pct, 2 / 3);
    }
  });

  it("estimated count returns kind=estimated and does NOT carry the numeric ratio", () => {
    // Regression: previously the UI showed "12 / 3" for accounts whose count
    // came from a multi-account fill/list dump. The display kind must drop
    // the numeric data so the component cannot accidentally render the ratio
    // or breach styling.
    const display = getTradeCountDisplay({
      ...baseAccount,
      tradeCountSource: "estimated",
      tradesCount: 12,
      maxTradesPerDay: 3,
      tradesUsedPct: 1, // would otherwise drive a red bar
    });
    assert.equal(display.kind, "estimated");
    // No numeric fields surfaced — the component cannot render "12 / 3".
    assert.ok(!("used" in display), "estimated must not expose 'used'");
    assert.ok(!("max" in display), "estimated must not expose 'max'");
    assert.ok(!("pct" in display), "estimated must not expose 'pct' (no breach styling)");
  });

  it("unavailable source returns kind=unavailable", () => {
    const display = getTradeCountDisplay({
      ...baseAccount,
      tradeCountSource: "unavailable",
      tradesCount: 0,
    });
    assert.equal(display.kind, "unavailable");
  });

  it("broker account with fills never synced returns kind=unavailable", () => {
    const display = getTradeCountDisplay({
      ...baseAccount,
      fillsSyncedAt: null,
      lastSyncAt: new Date("2026-05-05T12:00:00Z"),
    });
    assert.equal(display.kind, "unavailable");
  });

  it("manual platform with no rule and no count returns kind=no_data", () => {
    const display = getTradeCountDisplay({
      ...baseAccount,
      platform: "manual",
      fillsSyncedAt: null,
      lastSyncAt: null,
      tradesCount: null,
      maxTradesPerDay: null,
    });
    assert.equal(display.kind, "no_data");
  });

  it("estimated state takes precedence over a configured maxTradesPerDay", () => {
    // Even if the rules engine has a per-day cap configured, the unreliable
    // count must not be rendered as a ratio against that cap.
    const display = getTradeCountDisplay({
      ...baseAccount,
      tradeCountSource: "estimated",
      tradesCount: 5,
      maxTradesPerDay: 3,
      tradesUsedPct: 1,
    });
    assert.equal(display.kind, "estimated");
  });

  it("verified count with no rules-defined cap still renders verified (max=null)", () => {
    const display = getTradeCountDisplay({
      ...baseAccount,
      tradesCount: 4,
      maxTradesPerDay: null,
      tradesUsedPct: null,
    });
    assert.equal(display.kind, "verified");
    if (display.kind === "verified") {
      assert.equal(display.used, 4);
      assert.equal(display.max, null);
    }
  });

  it("unavailable hint is shown for broker accounts but suppressed for manual", () => {
    const broker = getTradeCountDisplay({ ...baseAccount, tradeCountSource: "unavailable" });
    const manual = getTradeCountDisplay({
      ...baseAccount,
      platform: "manual",
      tradeCountSource: "unavailable",
    });
    if (broker.kind === "unavailable") assert.equal(broker.showHint, true);
    if (manual.kind === "unavailable") assert.equal(manual.showHint, false);
  });
});

// ── source-gated trade-limit enforcement (multi-account OAuth tokens) ────────

describe("trade-limit enforcement is suppressed when tradeCountSource is not 'verified'", () => {
  const lockableTrades = {
    isActive: true,
    platform: "tradovate",
    connectionStatus: "connected_readonly",
    hasAnyRules: true,
    propFirmSetupNeeded: false,
    riskState: null as "NORMAL" | "WARNING" | "STOPPED" | null,
    dailyLossUsedPct: 0.5, // below daily loss limit
    tradesCount: 12,
    maxTradesPerDay: 3,
  };

  it("estimated count + trades over limit → status stays 'allowed' (not 'locked')", () => {
    // Multi-account OAuth scenario: tradesCount=12 may include other accounts'
    // fills, so we MUST NOT lock the account based on this alone.
    const status = deriveStatus({ ...lockableTrades, tradeCountSource: "estimated" });
    assert.equal(status, "allowed");
  });

  it("unavailable count + trades over limit → status stays 'allowed'", () => {
    const status = deriveStatus({ ...lockableTrades, tradeCountSource: "unavailable" });
    assert.equal(status, "allowed");
  });

  it("verified count + trades over limit → status is 'locked' (existing behavior)", () => {
    const status = deriveStatus({ ...lockableTrades, tradeCountSource: "verified" });
    assert.equal(status, "locked");
  });

  it("estimated count does NOT downgrade a daily-loss STOPPED state", () => {
    // Daily loss enforcement uses an account-scoped balance endpoint and
    // remains authoritative regardless of tradeCountSource.
    const status = deriveStatus({
      ...lockableTrades,
      riskState: "STOPPED",
      dailyLossUsedPct: 1.0,
      tradeCountSource: "estimated",
    });
    assert.equal(status, "locked");
  });

  it("estimated count + warning threshold trades → no warning status", () => {
    const status = deriveStatus({
      ...lockableTrades,
      tradesCount: 2,
      maxTradesPerDay: 3,
      tradeCountSource: "estimated",
    });
    assert.equal(status, "allowed");
  });

  it("breachReason returns null for trades-over-limit when source is estimated", () => {
    const result = deriveBreachReason({
      status: "locked",
      riskState: null,
      dailyLossUsedPct: null,
      tradesCount: 12,
      maxTradesPerDay: 3,
      consecutiveLosses: null,
      stopAfterLosses: null,
      tradeCountSource: "estimated",
    });
    // Status was passed as "locked" but if the helpers had been called together
    // status would be "allowed" — either way, no trade-limit headline.
    assert.ok(result === null || !result.headline.includes("Trade activity"));
  });

  it("breachReason still surfaces daily-loss headline when daily loss is at limit, even with estimated trade count", () => {
    const result = deriveBreachReason({
      status: "locked",
      riskState: "STOPPED",
      dailyLossUsedPct: 1.0,
      tradesCount: 12,
      maxTradesPerDay: 3,
      consecutiveLosses: null,
      stopAfterLosses: null,
      tradeCountSource: "estimated",
    });
    assert.ok(result !== null);
    assert.equal(result.headline, "Daily loss limit reached");
  });

  it("breachReason returns null trade warning when count is estimated", () => {
    const result = deriveBreachReason({
      status: "warning",
      riskState: null,
      dailyLossUsedPct: 0.4,
      tradesCount: 2,
      maxTradesPerDay: 3,
      consecutiveLosses: null,
      stopAfterLosses: null,
      tradeCountSource: "estimated",
    });
    // Warning status was passed but no eligible breach reason matches — the
    // trade-warning branch is gated on "verified".
    assert.equal(result, null);
  });

  it("backwards compat: omitting tradeCountSource defaults to 'verified' behavior", () => {
    const status = deriveStatus(lockableTrades); // no tradeCountSource key
    assert.equal(status, "locked");
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

// ── deriveBrokerEnforcementCopy ───────────────────────────────────────────────

describe("deriveBrokerEnforcementCopy", () => {
  // ── broker_locked: Tradovate confirmed the lock ───────────────────────────

  it("broker_locked → kind=broker_active", () => {
    const { kind } = deriveBrokerEnforcementCopy("broker_locked");
    assert.equal(kind, "broker_active");
  });

  it("broker_locked text says 'Broker-side lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy("broker_locked");
    assert.ok(
      text.includes("Broker-side lock active"),
      `expected 'Broker-side lock active', got: ${text}`,
    );
  });

  it("broker_locked text does NOT say 'Guardrail lock' — broker confirmed, no internal-only framing", () => {
    const { text } = deriveBrokerEnforcementCopy("broker_locked");
    assert.ok(
      !text.includes("Guardrail lock"),
      `'Guardrail lock' must be absent for broker_locked; got: ${text}`,
    );
  });

  // ── unavailable_read_only: connection is connected_readonly ───────────────

  it("unavailable_read_only → kind=unavailable_readonly", () => {
    const { kind } = deriveBrokerEnforcementCopy("unavailable_read_only");
    assert.equal(kind, "unavailable_readonly");
  });

  it("unavailable_read_only text says 'Guardrail lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy("unavailable_read_only");
    assert.ok(
      text.includes("Guardrail lock active"),
      `expected 'Guardrail lock active', got: ${text}`,
    );
  });

  it("unavailable_read_only text mentions 'read-only'", () => {
    const { text } = deriveBrokerEnforcementCopy("unavailable_read_only");
    assert.ok(
      text.toLowerCase().includes("read-only"),
      `expected 'read-only' in text, got: ${text}`,
    );
  });

  it("unavailable_read_only text does NOT say 'Broker-side lock active' (lock is internal only)", () => {
    const { text } = deriveBrokerEnforcementCopy("unavailable_read_only");
    assert.ok(
      !text.includes("Broker-side lock active"),
      `'Broker-side lock active' must not appear for unavailable_read_only; got: ${text}`,
    );
  });

  // ── unavailable_permission: HTTP 403 from risk endpoint ───────────────────

  it("unavailable_permission → kind=unavailable_permission", () => {
    const { kind } = deriveBrokerEnforcementCopy("unavailable_permission");
    assert.equal(kind, "unavailable_permission");
  });

  it("unavailable_permission text says 'Guardrail lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy("unavailable_permission");
    assert.ok(
      text.includes("Guardrail lock active"),
      `expected 'Guardrail lock active', got: ${text}`,
    );
  });

  it("unavailable_permission text mentions Account Risk Settings", () => {
    const { text } = deriveBrokerEnforcementCopy("unavailable_permission");
    assert.ok(
      text.includes("Account Risk Settings"),
      `expected 'Account Risk Settings' in text, got: ${text}`,
    );
  });

  it("unavailable_permission differs from unavailable_read_only text", () => {
    const perm = deriveBrokerEnforcementCopy("unavailable_permission").text;
    const ro = deriveBrokerEnforcementCopy("unavailable_read_only").text;
    assert.notEqual(perm, ro, "permission-missing and read-only must have distinct copy");
  });

  // ── broker_lock_failed: non-permission error ──────────────────────────────

  it("broker_lock_failed → kind=failed", () => {
    const { kind } = deriveBrokerEnforcementCopy("broker_lock_failed");
    assert.equal(kind, "failed");
  });

  it("broker_lock_failed text says 'Guardrail lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy("broker_lock_failed");
    assert.ok(
      text.includes("Guardrail lock active"),
      `expected 'Guardrail lock active', got: ${text}`,
    );
  });

  it("broker_lock_failed text mentions 'failed'", () => {
    const { text } = deriveBrokerEnforcementCopy("broker_lock_failed");
    assert.ok(
      text.toLowerCase().includes("failed"),
      `expected 'failed' in text, got: ${text}`,
    );
  });

  // ── monitoring_only: no broker API for this trigger ───────────────────────

  it("monitoring_only → kind=internal_only", () => {
    const { kind } = deriveBrokerEnforcementCopy("monitoring_only");
    assert.equal(kind, "internal_only");
  });

  it("monitoring_only text says 'Guardrail lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy("monitoring_only");
    assert.ok(
      text.includes("Guardrail lock active"),
      `expected 'Guardrail lock active', got: ${text}`,
    );
  });

  // ── null / not_requested / unknown ───────────────────────────────────────

  it("null → kind=internal_only (no intervention recorded)", () => {
    const { kind } = deriveBrokerEnforcementCopy(null);
    assert.equal(kind, "internal_only");
  });

  it("null text says 'Guardrail lock active'", () => {
    const { text } = deriveBrokerEnforcementCopy(null);
    assert.ok(
      text.includes("Guardrail lock active"),
      `expected 'Guardrail lock active', got: ${text}`,
    );
  });

  // ── Invariants across all non-broker-confirmed states ────────────────────

  it("every non-broker-locked status text contains 'Guardrail lock active'", () => {
    const nonBrokerStatuses = [
      "unavailable_read_only",
      "unavailable_permission",
      "broker_lock_failed",
      "monitoring_only",
      "not_requested",
      "pending",
      null,
    ] as const;
    for (const status of nonBrokerStatuses) {
      const { text } = deriveBrokerEnforcementCopy(status);
      assert.ok(
        text.includes("Guardrail lock active"),
        `status=${status ?? "null"}: expected 'Guardrail lock active', got: ${text}`,
      );
    }
  });

  it("'Broker-side lock active' appears ONLY for broker_locked", () => {
    const allStatuses = [
      "unavailable_read_only",
      "unavailable_permission",
      "broker_lock_failed",
      "monitoring_only",
      "not_requested",
      "pending",
      null,
    ] as const;
    for (const status of allStatuses) {
      const { text } = deriveBrokerEnforcementCopy(status);
      assert.ok(
        !text.includes("Broker-side lock active"),
        `status=${status ?? "null"}: 'Broker-side lock active' must not appear; got: ${text}`,
      );
    }
    // And it DOES appear for broker_locked.
    assert.ok(deriveBrokerEnforcementCopy("broker_locked").text.includes("Broker-side lock active"));
  });

  it("each status produces a distinct kind (no two non-broker statuses are confused)", () => {
    const readOnly = deriveBrokerEnforcementCopy("unavailable_read_only");
    const permission = deriveBrokerEnforcementCopy("unavailable_permission");
    const failed = deriveBrokerEnforcementCopy("broker_lock_failed");
    // Kinds must be distinct where the causes are distinct.
    assert.equal(readOnly.kind, "unavailable_readonly");
    assert.equal(permission.kind, "unavailable_permission");
    assert.equal(failed.kind, "failed");
    assert.notEqual(readOnly.kind, permission.kind);
    assert.notEqual(permission.kind, failed.kind);
  });

  // ── dry_run ───────────────────────────────────────────────────────────────

  it("dry_run → kind=dry_run", () => {
    const { kind } = deriveBrokerEnforcementCopy("dry_run");
    assert.equal(kind, "dry_run");
  });

  it("dry_run text uses user-facing 'Test mode' prefix (not the technical 'Dry run')", () => {
    const { text } = deriveBrokerEnforcementCopy("dry_run");
    assert.ok(text.includes("Test mode"), `expected 'Test mode' prefix, got: ${text}`);
    assert.ok(
      !text.includes("Dry run"),
      `'Dry run' is internal-only and must not leak to user-facing copy: ${text}`,
    );
  });

  it("dry_run text says 'No Tradovate write was sent'", () => {
    const { text } = deriveBrokerEnforcementCopy("dry_run");
    assert.ok(
      text.includes("No Tradovate write was sent"),
      `expected 'No Tradovate write was sent', got: ${text}`,
    );
  });

  it("dry_run text mentions both 'Position exit' and 'broker-side lockout' (combined simulation)", () => {
    const { text } = deriveBrokerEnforcementCopy("dry_run");
    assert.ok(
      text.includes("Position exit") || text.includes("position exit"),
      `expected 'Position exit' in dry_run text, got: ${text}`,
    );
    assert.ok(
      text.toLowerCase().includes("lockout"),
      `expected 'lockout' in dry_run text, got: ${text}`,
    );
  });

  it("dry_run text does NOT say 'Broker-side lock active' — no real lock was applied", () => {
    const { text } = deriveBrokerEnforcementCopy("dry_run");
    assert.ok(
      !text.includes("Broker-side lock active"),
      `'Broker-side lock active' must be absent for dry_run; got: ${text}`,
    );
  });

  it("dry_run text does NOT say 'Guardrail lock active' — it is a simulation, not a Guardrail state message", () => {
    // dry_run has its own distinct copy rather than sharing the 'Guardrail lock active' framing.
    const { text } = deriveBrokerEnforcementCopy("dry_run");
    assert.ok(
      !text.includes("Guardrail lock active"),
      `'Guardrail lock active' must be absent for dry_run; got: ${text}`,
    );
  });

  it("dry_run kind is distinct from all other kinds", () => {
    const otherKinds = [
      deriveBrokerEnforcementCopy("broker_locked").kind,
      deriveBrokerEnforcementCopy("unavailable_read_only").kind,
      deriveBrokerEnforcementCopy("unavailable_permission").kind,
      deriveBrokerEnforcementCopy("broker_lock_failed").kind,
      deriveBrokerEnforcementCopy("monitoring_only").kind,
    ];
    for (const other of otherKinds) {
      assert.notEqual("dry_run", other, `dry_run kind must differ from ${other}`);
    }
  });
});

// ── deriveFlattenCopy ─────────────────────────────────────────────────────────

describe("deriveFlattenCopy", () => {
  it("flattened → kind=broker_active", () => {
    assert.equal(deriveFlattenCopy("flattened").kind, "broker_active");
  });

  it("flattened text says 'Position exit confirmed'", () => {
    const { text } = deriveFlattenCopy("flattened");
    assert.ok(text.includes("Position exit confirmed"), `got: ${text}`);
  });

  it("not_needed text says 'No open position'", () => {
    const { text } = deriveFlattenCopy("not_needed");
    assert.ok(text.toLowerCase().includes("no open position"), `got: ${text}`);
  });

  it("not_needed → kind=internal_only", () => {
    assert.equal(deriveFlattenCopy("not_needed").kind, "internal_only");
  });

  it("attempted text mentions confirmation pending", () => {
    const { text } = deriveFlattenCopy("attempted");
    assert.ok(
      text.toLowerCase().includes("pending") || text.toLowerCase().includes("sent"),
      `got: ${text}`,
    );
  });

  it("unavailable_read_only → kind=unavailable_readonly", () => {
    assert.equal(deriveFlattenCopy("unavailable_read_only").kind, "unavailable_readonly");
  });

  it("unavailable_read_only text mentions read-only", () => {
    const { text } = deriveFlattenCopy("unavailable_read_only");
    assert.ok(text.toLowerCase().includes("read-only"), `got: ${text}`);
  });

  it("unavailable_permission → kind=unavailable_permission", () => {
    assert.equal(deriveFlattenCopy("unavailable_permission").kind, "unavailable_permission");
  });

  it("unavailable_permission text mentions permission", () => {
    const { text } = deriveFlattenCopy("unavailable_permission");
    assert.ok(text.toLowerCase().includes("permission"), `got: ${text}`);
  });

  it("failed → kind=failed", () => {
    assert.equal(deriveFlattenCopy("failed").kind, "failed");
  });

  it("failed text says 'Position exit failed'", () => {
    const { text } = deriveFlattenCopy("failed");
    assert.ok(text.includes("Position exit failed"), `got: ${text}`);
  });

  it("dry_run → kind=dry_run", () => {
    assert.equal(deriveFlattenCopy("dry_run").kind, "dry_run");
  });

  it("dry_run text uses user-facing 'Test mode' prefix and mentions 'simulated'", () => {
    const { text } = deriveFlattenCopy("dry_run");
    assert.ok(text.includes("Test mode"), `expected 'Test mode' prefix, got: ${text}`);
    assert.ok(
      !text.includes("Dry run"),
      `'Dry run' is internal-only and must not leak to user-facing copy: ${text}`,
    );
    assert.ok(text.toLowerCase().includes("simulated"), `expected 'simulated', got: ${text}`);
  });

  it("null → safe fallback with kind=internal_only", () => {
    const { kind } = deriveFlattenCopy(null);
    assert.equal(kind, "internal_only");
  });

  it("flattened is distinct from failed", () => {
    assert.notEqual(deriveFlattenCopy("flattened").kind, deriveFlattenCopy("failed").kind);
  });

  it("dry_run kind is distinct from flattened kind", () => {
    assert.notEqual(deriveFlattenCopy("dry_run").kind, deriveFlattenCopy("flattened").kind);
  });
});

// ── deriveEnforcementMode (Dashboard chip label source) ───────────────────────

describe("deriveEnforcementMode", () => {
  const base = {
    platform: "tradovate",
    connectionStatus: "connected_readonly",
    isActive: true,
    permissionLevel: null as string | null | undefined,
    isDryRun: false,
  };

  it("full_access → broker_active", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, permissionLevel: "full_access" }),
      "broker_active",
    );
  });

  it("full_access + isDryRun → dry_run (dry-run overrides full access)", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, permissionLevel: "full_access", isDryRun: true }),
      "dry_run",
    );
  });

  it("read_only → broker_readonly", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, permissionLevel: "read_only" }),
      "broker_readonly",
    );
  });

  it("null permissionLevel → permission_unverified (probe not yet run)", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, permissionLevel: null }),
      "permission_unverified",
    );
  });

  it("unknown permissionLevel → permission_unverified (inconclusive probe result)", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, permissionLevel: "unknown" }),
      "permission_unverified",
    );
  });

  it("inactive account → not_connected regardless of permissionLevel", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, isActive: false, permissionLevel: "full_access" }),
      "not_connected",
    );
  });

  it("expired connectionStatus → not_connected", () => {
    assert.equal(
      deriveEnforcementMode({ ...base, connectionStatus: "expired", permissionLevel: "full_access" }),
      "not_connected",
    );
  });

  it("connected_live with full_access → broker_active (live webhook does not block enforcement)", () => {
    assert.equal(
      deriveEnforcementMode({
        ...base,
        connectionStatus: "connected_live",
        permissionLevel: "full_access",
      }),
      "broker_active",
    );
  });

  it("bug case: stale connected_readonly + full_access → broker_active (not broker_readonly)", () => {
    // Regression guard: BrokerConnection.connectionStatus is often stuck at
    // connected_readonly because the webhook only updates ConnectedAccount.
    // The permissionLevel from the probe must determine the chip, not the stale status.
    assert.equal(
      deriveEnforcementMode({
        ...base,
        connectionStatus: "connected_readonly",
        permissionLevel: "full_access",
      }),
      "broker_active",
    );
  });
});

// ── deriveAccountKind ─────────────────────────────────────────────────────────

describe("deriveAccountKind", () => {
  it("funded → live", () => {
    assert.equal(deriveAccountKind("funded"), "live");
  });

  it("personal → live", () => {
    assert.equal(deriveAccountKind("personal"), "live");
  });

  it("evaluation → practice", () => {
    assert.equal(deriveAccountKind("evaluation"), "practice");
  });

  it("demo → practice", () => {
    assert.equal(deriveAccountKind("demo"), "practice");
  });

  it("unknown accountType falls back to practice (never silently mis-counted as live)", () => {
    // Better to under-report live accounts than to inflate the count and
    // mislead the user into thinking demo/evaluation accounts are live.
    assert.equal(deriveAccountKind("something_new"), "practice");
  });
});

// ── Estimated trade count copy ────────────────────────────────────────────────

describe("ESTIMATED_TRADE_COUNT_HINT (long-form tooltip)", () => {
  it("explicitly states the count is estimated", () => {
    assert.ok(
      ESTIMATED_TRADE_COUNT_HINT.toLowerCase().includes("estimated"),
      `expected 'estimated' in copy, got: ${ESTIMATED_TRADE_COUNT_HINT}`,
    );
  });

  it("explicitly states Guardrail will not lock the account from this count", () => {
    assert.ok(
      ESTIMATED_TRADE_COUNT_HINT.toLowerCase().includes("will not use") &&
        ESTIMATED_TRADE_COUNT_HINT.toLowerCase().includes("lock"),
      `expected lockout disclaimer in copy, got: ${ESTIMATED_TRADE_COUNT_HINT}`,
    );
  });

  it("mentions the verified condition", () => {
    assert.ok(
      ESTIMATED_TRADE_COUNT_HINT.toLowerCase().includes("verified"),
      `expected 'verified' in copy, got: ${ESTIMATED_TRADE_COUNT_HINT}`,
    );
  });
});

// ── Estimated trade count is not used for lockout ─────────────────────────────
// These tests already exist for deriveStatus/deriveBreachReason — this block
// documents the product invariant: max trades and stop-after-losses MUST never
// trigger lockout when tradeCountSource is "estimated".

describe("estimated trade count never causes lockout (product invariant)", () => {
  const accountAtTradeLimit = {
    isActive: true,
    platform: "tradovate",
    connectionStatus: "connected_readonly",
    hasAnyRules: true,
    propFirmSetupNeeded: false,
    riskState: null as "NORMAL" | "WARNING" | "STOPPED" | null,
    dailyLossUsedPct: 0.5,
    tradesCount: 12,
    maxTradesPerDay: 3,
  };

  it("max trades exceeded → status remains 'allowed' when source is estimated", () => {
    assert.equal(
      deriveStatus({ ...accountAtTradeLimit, tradeCountSource: "estimated" }),
      "allowed",
    );
  });

  it("max trades exceeded → status is 'locked' when source is verified", () => {
    assert.equal(
      deriveStatus({ ...accountAtTradeLimit, tradeCountSource: "verified" }),
      "locked",
    );
  });

  it("breachReason returns null for trades-over-limit when source is estimated", () => {
    const result = deriveBreachReason({
      status: "locked",
      riskState: null,
      dailyLossUsedPct: null,
      tradesCount: 12,
      maxTradesPerDay: 3,
      consecutiveLosses: null,
      stopAfterLosses: null,
      tradeCountSource: "estimated",
    });
    assert.ok(
      result === null || !result.headline.includes("Trade activity"),
      "trade-limit headline must not appear when source is estimated",
    );
  });
});

// ── deriveStaleSyncWarning ────────────────────────────────────────────────────

describe("deriveStaleSyncWarning", () => {
  const FRESHNESS_MS = 5 * 60_000; // 5 minutes
  const NOW = new Date("2026-05-06T12:00:00Z");

  it("no broker accounts → never stale", () => {
    const result = deriveStaleSyncWarning({
      oldestSyncAt: null,
      hasBrokerAccounts: false,
      freshnessMs: FRESHNESS_MS,
      now: NOW,
    });
    assert.equal(result.isStale, false);
    assert.equal(result.minutesSinceOldestSync, null);
  });

  it("broker accounts but oldestSyncAt is null → stale (nothing has synced yet)", () => {
    const result = deriveStaleSyncWarning({
      oldestSyncAt: null,
      hasBrokerAccounts: true,
      freshnessMs: FRESHNESS_MS,
      now: NOW,
    });
    assert.equal(result.isStale, true);
    assert.equal(result.minutesSinceOldestSync, null);
  });

  it("recent sync (< freshnessMs) → not stale, minutes accurate", () => {
    // Synced 2 minutes ago.
    const oldest = new Date(NOW.getTime() - 2 * 60_000);
    const result = deriveStaleSyncWarning({
      oldestSyncAt: oldest,
      hasBrokerAccounts: true,
      freshnessMs: FRESHNESS_MS,
      now: NOW,
    });
    assert.equal(result.isStale, false);
    assert.equal(result.minutesSinceOldestSync, 2);
  });

  it("old sync (> freshnessMs) → stale, minutes accurate", () => {
    // Synced 7 minutes ago.
    const oldest = new Date(NOW.getTime() - 7 * 60_000);
    const result = deriveStaleSyncWarning({
      oldestSyncAt: oldest,
      hasBrokerAccounts: true,
      freshnessMs: FRESHNESS_MS,
      now: NOW,
    });
    assert.equal(result.isStale, true);
    assert.equal(result.minutesSinceOldestSync, 7);
  });

  it("exactly at threshold → not stale (strict greater-than)", () => {
    // Synced exactly 5 minutes ago.
    const oldest = new Date(NOW.getTime() - FRESHNESS_MS);
    const result = deriveStaleSyncWarning({
      oldestSyncAt: oldest,
      hasBrokerAccounts: true,
      freshnessMs: FRESHNESS_MS,
      now: NOW,
    });
    assert.equal(result.isStale, false);
    assert.equal(result.minutesSinceOldestSync, 5);
  });
});

// ── deriveConnectionStatusLabel — never leaks raw enum values ─────────────────

describe("deriveConnectionStatusLabel", () => {
  it("connected_live → 'Connected'", () => {
    assert.equal(deriveConnectionStatusLabel("connected_live"), "Connected");
  });

  it("connected_readonly → 'Connected' (NOT 'connected readonly')", () => {
    // Regression: the dashboard previously rendered the raw enum value
    // ("connected readonly") because the label map didn't include this key.
    // The capability nuance (limited vs full) is shown via the enforcement chip.
    const label = deriveConnectionStatusLabel("connected_readonly");
    assert.equal(label, "Connected");
    assert.ok(!label.includes("readonly"), `'readonly' must not leak: ${label}`);
  });

  it("never returns the raw underscored enum form for any known value", () => {
    const knownStatuses = [
      "connected_live",
      "connected_readonly",
      "pending_webhook",
      "oauth_pending_storage",
      "not_connected",
      "connection_error",
      "expired",
    ];
    for (const status of knownStatuses) {
      const label = deriveConnectionStatusLabel(status);
      assert.ok(!label.includes("_"), `label for ${status} must not contain '_': ${label}`);
    }
  });

  it("unknown status falls back to a safe label, not the raw value", () => {
    const label = deriveConnectionStatusLabel("some_future_status");
    assert.ok(!label.includes("_"), `unknown status leaked raw value: ${label}`);
    assert.ok(label.length > 0);
  });

  it("not_connected and expired surface their distinct user-facing copy", () => {
    assert.equal(deriveConnectionStatusLabel("not_connected"), "Not connected");
    assert.ok(
      deriveConnectionStatusLabel("expired").toLowerCase().includes("expired"),
    );
  });
});

// ── deriveFooterCopy — dynamic, non-repetitive footer ─────────────────────────

describe("deriveFooterCopy", () => {
  it("no accounts → null (nothing to say)", () => {
    assert.equal(
      deriveFooterCopy({ modes: [], hasDryRunBanner: false }),
      null,
    );
  });

  it("dry_run + banner showing → null (banner already says it; footer stays silent)", () => {
    const copy = deriveFooterCopy({
      modes: ["dry_run", "dry_run"],
      hasDryRunBanner: true,
    });
    assert.equal(copy, null);
  });

  it("dry_run without banner → 'Test mode' footer text (user-facing phrase, not 'Dry run')", () => {
    const copy = deriveFooterCopy({
      modes: ["dry_run"],
      hasDryRunBanner: false,
    });
    assert.ok(copy != null);
    assert.ok(
      copy!.includes("Test mode"),
      `expected 'Test mode' in footer copy, got: ${copy}`,
    );
    assert.ok(
      !copy!.toLowerCase().includes("dry run"),
      `'Dry run' must not leak into user-facing footer, got: ${copy}`,
    );
    assert.ok(copy!.toLowerCase().includes("lockout"));
  });

  it("broker_active → 'Broker enforcement available where permissions support it.'", () => {
    const copy = deriveFooterCopy({
      modes: ["broker_active"],
      hasDryRunBanner: false,
    });
    assert.equal(
      copy,
      "Broker enforcement available where permissions support it.",
    );
  });

  it("broker_readonly only → limited-permissions footer", () => {
    const copy = deriveFooterCopy({
      modes: ["broker_readonly"],
      hasDryRunBanner: false,
    });
    assert.ok(copy != null);
    assert.ok(copy!.toLowerCase().includes("limited permissions"));
    assert.ok(copy!.toLowerCase().includes("reconnect"));
  });

  it("permission_unverified only → limited-permissions footer", () => {
    const copy = deriveFooterCopy({
      modes: ["permission_unverified"],
      hasDryRunBanner: false,
    });
    assert.ok(copy != null);
    assert.ok(copy!.toLowerCase().includes("limited permissions"));
  });

  it("mixed broker_active + broker_readonly → broker_active wins (positive framing)", () => {
    const copy = deriveFooterCopy({
      modes: ["broker_active", "broker_readonly"],
      hasDryRunBanner: false,
    });
    assert.equal(
      copy,
      "Broker enforcement available where permissions support it.",
    );
  });

  it("only not_connected accounts → null (no useful footer)", () => {
    const copy = deriveFooterCopy({
      modes: ["not_connected"],
      hasDryRunBanner: false,
    });
    assert.equal(copy, null);
  });
});

// ── DRY_RUN_BANNER_COPY ───────────────────────────────────────────────────────

describe("DRY_RUN_BANNER_COPY (user-facing 'Protection test mode' banner)", () => {
  it("uses 'Protection test mode' as the title phrase", () => {
    assert.ok(
      DRY_RUN_BANNER_COPY.includes("Protection test mode"),
      `expected 'Protection test mode' in banner copy, got: ${DRY_RUN_BANNER_COPY}`,
    );
  });

  it("does NOT use the technical phrase 'Dry run' (regression: too jargon-heavy for users)", () => {
    assert.ok(
      !DRY_RUN_BANNER_COPY.toLowerCase().includes("dry run"),
      `'Dry run' must not appear in user-facing banner copy, got: ${DRY_RUN_BANNER_COPY}`,
    );
  });

  it("uses plain language: 'watching' the accounts (instead of 'monitoring' / 'simulating')", () => {
    assert.ok(
      DRY_RUN_BANNER_COPY.toLowerCase().includes("watching your accounts"),
      `expected 'watching your accounts' in copy, got: ${DRY_RUN_BANNER_COPY}`,
    );
  });

  it("explicitly states it 'will not block or close trades' (the user-facing safety promise)", () => {
    assert.ok(
      DRY_RUN_BANNER_COPY.includes("will not block or close trades"),
      `expected 'will not block or close trades' in copy, got: ${DRY_RUN_BANNER_COPY}`,
    );
  });

  it("references the live-enforcement toggle so the user knows what changes when it's flipped", () => {
    assert.ok(
      DRY_RUN_BANNER_COPY.toLowerCase().includes("live enforcement"),
      `expected 'live enforcement' in copy, got: ${DRY_RUN_BANNER_COPY}`,
    );
  });
});

// ── shouldShowEnforcementChip — dry-run suppression ───────────────────────────

describe("shouldShowEnforcementChip", () => {
  it("dry_run → false (banner is the single source)", () => {
    assert.equal(shouldShowEnforcementChip("dry_run"), false);
  });

  it("broker_active → true", () => {
    assert.equal(shouldShowEnforcementChip("broker_active"), true);
  });

  it("broker_readonly → true", () => {
    assert.equal(shouldShowEnforcementChip("broker_readonly"), true);
  });

  it("permission_unverified → true", () => {
    assert.equal(shouldShowEnforcementChip("permission_unverified"), true);
  });

  it("not_connected → true", () => {
    assert.equal(shouldShowEnforcementChip("not_connected"), true);
  });
});

// ── Estimated short copy ──────────────────────────────────────────────────────

describe("ESTIMATED_TRADE_COUNT_SHORT (visible row copy)", () => {
  it("is the literal 'Not used for lockout'", () => {
    assert.equal(ESTIMATED_TRADE_COUNT_SHORT, "Not used for lockout");
  });

  it("is short — under 30 characters (must not bloat the table cell)", () => {
    assert.ok(
      ESTIMATED_TRADE_COUNT_SHORT.length < 30,
      `short copy too long (${ESTIMATED_TRADE_COUNT_SHORT.length} chars): ${ESTIMATED_TRADE_COUNT_SHORT}`,
    );
  });

  it("hint and short copy are distinct strings (short ≠ full)", () => {
    assert.notEqual(ESTIMATED_TRADE_COUNT_SHORT, ESTIMATED_TRADE_COUNT_HINT);
  });

  it("the long-form hint mentions the verified condition (used as tooltip)", () => {
    assert.ok(ESTIMATED_TRADE_COUNT_HINT.toLowerCase().includes("verified"));
  });
});

// ── deriveRowStatusLabel — clearer trading/protection state for each row ──────

describe("deriveRowStatusLabel", () => {
  const baseAllowed = {
    status: "allowed" as const,
    setupNeededReason: null,
    enforcementMode: "broker_active" as const,
    requiresAutomatedActionsConsent: false,
  };

  it("status='allowed' + clean → 'Tradable' (legacy 'Allowed' label is gone)", () => {
    const label = deriveRowStatusLabel(baseAllowed);
    assert.equal(label, "Tradable");
    // Regression: ALLOWED is the legacy label and must not leak.
    assert.notEqual(label, "Allowed");
  });

  it("status='allowed' + requiresAutomatedActionsConsent=true → 'Action required'", () => {
    const label = deriveRowStatusLabel({
      ...baseAllowed,
      requiresAutomatedActionsConsent: true,
    });
    assert.equal(label, "Action required");
  });

  it("status='allowed' + enforcementMode='broker_readonly' → 'Action required' (limited permissions need a fix)", () => {
    const label = deriveRowStatusLabel({
      ...baseAllowed,
      enforcementMode: "broker_readonly",
    });
    assert.equal(label, "Action required");
  });

  it("status='allowed' + enforcementMode='dry_run' (test mode) → 'Tradable' (no per-row action needed)", () => {
    // Test mode is communicated by the top-level banner; per-row label
    // should not say "Action required" just because dry-run is on.
    const label = deriveRowStatusLabel({
      ...baseAllowed,
      enforcementMode: "dry_run",
    });
    assert.equal(label, "Tradable");
  });

  it("status='locked' → 'Locked'", () => {
    assert.equal(
      deriveRowStatusLabel({ ...baseAllowed, status: "locked" }),
      "Locked",
    );
  });

  it("status='unavailable' → 'Unavailable' (broker no longer returns the account)", () => {
    assert.equal(
      deriveRowStatusLabel({ ...baseAllowed, status: "unavailable" }),
      "Unavailable",
    );
  });

  it("status='warning' → 'Warning'", () => {
    assert.equal(
      deriveRowStatusLabel({ ...baseAllowed, status: "warning" }),
      "Warning",
    );
  });

  it("status='not_connected' → 'Not connected'", () => {
    assert.equal(
      deriveRowStatusLabel({ ...baseAllowed, status: "not_connected" }),
      "Not connected",
    );
  });

  it("setup_needed maps to its specific reason", () => {
    assert.equal(
      deriveRowStatusLabel({
        ...baseAllowed,
        status: "setup_needed",
        setupNeededReason: "no_rules",
      }),
      "Needs rules",
    );
    assert.equal(
      deriveRowStatusLabel({
        ...baseAllowed,
        status: "setup_needed",
        setupNeededReason: "pending_connection",
      }),
      "Pending",
    );
    assert.equal(
      deriveRowStatusLabel({
        ...baseAllowed,
        status: "setup_needed",
        setupNeededReason: "prop_firm_rules_missing",
      }),
      "Firm rules missing",
    );
  });
});

// ── derivePerAccountStateLabel — small label under plan name ──────────────────

describe("derivePerAccountStateLabel", () => {
  it("dry_run → 'Test mode only' (per-row reminder of the global banner)", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "dry_run",
        requiresAutomatedActionsConsent: false,
      }),
      "Test mode only",
    );
  });

  it("requiresAutomatedActionsConsent=true → 'Consent required' (highest non-dry-run priority)", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "broker_active",
        requiresAutomatedActionsConsent: true,
      }),
      "Consent required",
    );
  });

  it("broker_active + consent valid → 'Broker enforcement ready'", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "broker_active",
        requiresAutomatedActionsConsent: false,
      }),
      "Broker enforcement ready",
    );
  });

  it("broker_readonly → 'Limited permissions'", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "broker_readonly",
        requiresAutomatedActionsConsent: false,
      }),
      "Limited permissions",
    );
  });

  it("permission_unverified → 'Monitoring only' (probe still pending; nothing actionable yet)", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "permission_unverified",
        requiresAutomatedActionsConsent: false,
      }),
      "Monitoring only",
    );
  });

  it("not_connected → 'Monitoring only'", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "not_connected",
        requiresAutomatedActionsConsent: false,
      }),
      "Monitoring only",
    );
  });

  it("dry_run wins over consent missing (banner state is the dominant context)", () => {
    assert.equal(
      derivePerAccountStateLabel({
        enforcementMode: "dry_run",
        requiresAutomatedActionsConsent: true,
      }),
      "Test mode only",
    );
  });
});

// ── deriveGroupStateSuffix — extra context next to "Connected" ────────────────

describe("deriveGroupStateSuffix", () => {
  it("empty group → null", () => {
    assert.equal(deriveGroupStateSuffix({ accounts: [] }), null);
  });

  it("any account in dry_run → 'Test mode' (the dominant indicator)", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "broker_active", requiresAutomatedActionsConsent: false },
        { enforcementMode: "dry_run", requiresAutomatedActionsConsent: false },
      ],
    });
    assert.equal(suffix, "Test mode");
  });

  it("any account requires consent → 'Consent required'", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "broker_active", requiresAutomatedActionsConsent: true },
      ],
    });
    assert.equal(suffix, "Consent required");
  });

  it("any account broker_readonly → 'Limited permissions'", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "broker_readonly", requiresAutomatedActionsConsent: false },
      ],
    });
    assert.equal(suffix, "Limited permissions");
  });

  it("all broker_active + valid consent → 'Broker enforcement ready'", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "broker_active", requiresAutomatedActionsConsent: false },
        { enforcementMode: "broker_active", requiresAutomatedActionsConsent: false },
      ],
    });
    assert.equal(suffix, "Broker enforcement ready");
  });

  it("only permission_unverified → null (probe still pending; no actionable state to show)", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "permission_unverified", requiresAutomatedActionsConsent: false },
      ],
    });
    assert.equal(suffix, null);
  });

  it("priority: consent_required wins over broker_readonly (more actionable)", () => {
    const suffix = deriveGroupStateSuffix({
      accounts: [
        { enforcementMode: "broker_active", requiresAutomatedActionsConsent: true },
        { enforcementMode: "broker_readonly", requiresAutomatedActionsConsent: false },
      ],
    });
    assert.equal(suffix, "Consent required");
  });
});

// ── deriveProtectionStatusPanel ───────────────────────────────────────────────

describe("deriveProtectionStatusPanel", () => {
  it("returns null when nothing is active", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: false,
      requiresConsentCount: 0,
      isProtectionLocked: false,
    });
    assert.equal(panel, null);
  });

  it("returns dry_run panel when test mode is active", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: true,
      requiresConsentCount: 0,
      isProtectionLocked: false,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "dry_run");
    assert.equal(panel!.showConsentCta, false);
  });

  it("returns consent_required when only consent is needed", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: false,
      requiresConsentCount: 2,
      isProtectionLocked: false,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "consent_required");
    assert.equal(panel!.showConsentCta, true);
  });

  it("returns protection_locked when only protection is locked", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: false,
      requiresConsentCount: 0,
      isProtectionLocked: true,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "protection_locked");
    assert.equal(panel!.showConsentCta, false);
  });

  it("dry_run wins over consent_required (priority: test mode > consent)", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: true,
      requiresConsentCount: 3,
      isProtectionLocked: false,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "dry_run");
    // Consent CTA is still shown even when dry_run wins the primary slot.
    assert.equal(panel!.showConsentCta, true);
  });

  it("dry_run wins over protection_locked", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: true,
      requiresConsentCount: 0,
      isProtectionLocked: true,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "dry_run");
    assert.equal(panel!.showConsentCta, false);
  });

  it("consent_required wins over protection_locked when not in dry_run", () => {
    const panel = deriveProtectionStatusPanel({
      isDryRunActive: false,
      requiresConsentCount: 1,
      isProtectionLocked: true,
    });
    assert.ok(panel !== null);
    assert.equal(panel!.kind, "consent_required");
    assert.equal(panel!.showConsentCta, true);
  });
});
