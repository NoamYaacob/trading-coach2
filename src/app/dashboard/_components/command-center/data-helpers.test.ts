import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveTradingPermissionStatus, resolveSessionDisplayMetrics, deriveRowStatusLabel, deriveBrokerEnforcementNoteCopy } from "./data-helpers.ts";
import type { AccountStatus, EnforcementMode } from "./types.ts";

function makeAccount(
  status: AccountStatus,
  enforcementMode: EnforcementMode = "broker_active",
  permissionLevel: string | null = null,
) {
  return { status, enforcementMode, permissionLevel };
}

// ── Test 1: null when no active accounts ──────────────────────────────────────

describe("deriveTradingPermissionStatus returns null for no active accounts", () => {
  it("returns null for empty array", () => {
    assert.strictEqual(deriveTradingPermissionStatus({ accounts: [] }), null);
  });

  it("returns null when all accounts are unavailable", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [
        makeAccount("unavailable"),
        makeAccount("unavailable"),
      ],
    });
    assert.strictEqual(result, null);
  });

  it("returns null when all accounts are not_connected", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("not_connected"), makeAccount("not_connected")],
    });
    assert.strictEqual(result, null);
  });

  it("returns null when mix of unavailable and not_connected only", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("unavailable"), makeAccount("not_connected")],
    });
    assert.strictEqual(result, null);
  });
});

// ── Test 2: allowed level ─────────────────────────────────────────────────────

describe("deriveTradingPermissionStatus allowed level", () => {
  it("returns allowed when all accounts are allowed", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("allowed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
    assert.equal(result.headline, "Allowed to trade");
    assert.ok(result.subline.length > 0);
  });

  it("returns allowed when mix of allowed and setup_needed (no locked/warning)", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("setup_needed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
  });
});

// ── Test 3: warning level ─────────────────────────────────────────────────────

describe("deriveTradingPermissionStatus warning level", () => {
  it("returns warning for single warning account (singular headline)", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("warning"), makeAccount("allowed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "warning");
    assert.ok(result.headline.includes("1 account in warning"), `got: ${result.headline}`);
  });

  it("returns warning for multiple warning accounts (plural headline)", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("warning"), makeAccount("warning"), makeAccount("allowed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "warning");
    assert.ok(result.headline.includes("2 accounts in warning"), `got: ${result.headline}`);
  });
});

// ── Test 4: locked level ──────────────────────────────────────────────────────

describe("deriveTradingPermissionStatus locked level", () => {
  it("returns locked for single locked account (singular headline)", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked"), makeAccount("allowed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "locked");
    assert.ok(result.headline.includes("1 account locked"), `got: ${result.headline}`);
  });

  it("returns locked for multiple locked accounts (plural headline)", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked"), makeAccount("locked")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "locked");
    assert.ok(result.headline.includes("2 accounts locked"), `got: ${result.headline}`);
  });

  it("locked takes precedence over warning", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked"), makeAccount("warning")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "locked");
  });
});

// ── Test 5: test_mode level ───────────────────────────────────────────────────

describe("deriveTradingPermissionStatus test_mode level", () => {
  it("returns test_mode when any account is in dry_run mode", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run"), makeAccount("allowed", "broker_active")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
    assert.equal(result.headline, "Monitoring active");
    assert.ok(result.subline.includes("Broker-side enforcement is not active"));
  });

  it("test_mode takes precedence over locked", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked", "dry_run"), makeAccount("allowed")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
  });

  it("test_mode with locked accounts has compound headline", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked", "dry_run"), makeAccount("locked", "dry_run")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
    assert.ok(result.headline.includes("locked"), `got: ${result.headline}`);
    assert.ok(result.headline.includes("Monitoring active"), `got: ${result.headline}`);
  });

  it("test_mode with single locked account uses singular", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked", "dry_run"), makeAccount("allowed", "dry_run")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
    assert.ok(result.headline.includes("1 account"), `got: ${result.headline}`);
  });

  it("subline always mentions monitoring and not active enforcement", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run")],
    });
    assert.ok(result !== null);
    assert.ok(result.subline.includes("watching"), `got: ${result.subline}`);
    assert.ok(result.subline.includes("not active"), `got: ${result.subline}`);
  });

  it("headline never contains the phrase 'test mode'", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run")],
    });
    assert.ok(result !== null);
    assert.ok(
      !result.headline.toLowerCase().includes("test mode"),
      `headline must not say 'test mode': ${result.headline}`,
    );
  });
});

// ── Test 6: active count includes setup_needed ────────────────────────────────

describe("deriveTradingPermissionStatus active count includes setup_needed", () => {
  it("setup_needed is active so the block shows with allowed level", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("setup_needed", "not_connected")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
  });
});

// ── Test 7: dry_run + full_access shows broker capability headline ─────────────

describe("deriveTradingPermissionStatus — dry_run with full_access", () => {
  it("all full_access → allowed level with broker headline", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run", "full_access")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
    assert.ok(
      result.headline.includes("Broker risk settings enabled"),
      `got: ${result.headline}`,
    );
  });

  it("full_access + locked → allowed level with compound headline", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [
        makeAccount("locked", "dry_run", "full_access"),
        makeAccount("allowed", "dry_run", "full_access"),
      ],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
    assert.ok(
      result.headline.includes("Broker risk settings enabled"),
      `got: ${result.headline}`,
    );
    assert.ok(result.headline.includes("locked"), `got: ${result.headline}`);
  });

  it("mixed permissions (some null) → test_mode fallback", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [
        makeAccount("allowed", "dry_run", "full_access"),
        makeAccount("allowed", "dry_run", null),
      ],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
  });

  it("full_access subline mentions position exit not active yet", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run", "full_access")],
    });
    assert.ok(result !== null);
    assert.ok(
      result.subline.toLowerCase().includes("position exit not active yet"),
      `got: ${result.subline}`,
    );
  });
});

// ── resolveSessionDisplayMetrics ──────────────────────────────────────────────

const TODAY = "2026-05-08";
const YESTERDAY = "2026-05-07";

function makeSession(overrides: {
  sessionDate?: string;
  tradesCount?: number;
  dailyPnl?: number;
  tradeCountSource?: string | null;
}) {
  return {
    sessionDate: overrides.sessionDate ?? TODAY,
    tradesCount: overrides.tradesCount ?? 0,
    dailyPnl: overrides.dailyPnl ?? 0,
    tradeCountSource: overrides.tradeCountSource ?? "verified",
  };
}

describe("resolveSessionDisplayMetrics — no session", () => {
  it("returns null metrics and isStale:false when sessionState is null", () => {
    const result = resolveSessionDisplayMetrics(null, TODAY);
    assert.equal(result.tradesCount, null);
    assert.equal(result.dailyPnl, null);
    assert.equal(result.tradeCountSource, "unavailable");
    assert.equal(result.isStale, false);
  });
});

describe("resolveSessionDisplayMetrics — stale session (prior CME day)", () => {
  it("nulls all display metrics when sessionDate is yesterday's key", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: YESTERDAY, tradesCount: 2, dailyPnl: -150 }),
      TODAY,
    );
    assert.equal(result.tradesCount, null, "stale count must not be shown as today's");
    assert.equal(result.dailyPnl, null, "stale P&L must not be shown as today's");
    assert.equal(result.tradeCountSource, "unavailable");
    assert.equal(result.isStale, true);
  });

  it("isStale:true regardless of tradeCountSource value", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: YESTERDAY, tradeCountSource: "estimated" }),
      TODAY,
    );
    assert.equal(result.isStale, true);
    assert.equal(result.tradeCountSource, "unavailable");
  });

  it("isStale:true for any sessionDate that differs from todayKey", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: "2026-01-01", tradesCount: 99 }),
      TODAY,
    );
    assert.equal(result.tradesCount, null);
    assert.equal(result.isStale, true);
  });
});

describe("resolveSessionDisplayMetrics — current session", () => {
  it("returns actual metrics when sessionDate matches todayKey", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: TODAY, tradesCount: 3, dailyPnl: 250 }),
      TODAY,
    );
    assert.equal(result.tradesCount, 3);
    assert.equal(result.dailyPnl, 250);
    assert.equal(result.tradeCountSource, "verified");
    assert.equal(result.isStale, false);
  });

  it("returns 0 trades when session exists with no fills yet", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: TODAY, tradesCount: 0 }),
      TODAY,
    );
    assert.equal(result.tradesCount, 0);
    assert.equal(result.isStale, false);
  });

  it("preserves tradeCountSource from session", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: TODAY, tradeCountSource: "estimated" }),
      TODAY,
    );
    assert.equal(result.tradeCountSource, "estimated");
  });

  it("treats null tradeCountSource as verified", () => {
    const result = resolveSessionDisplayMetrics(
      makeSession({ sessionDate: TODAY, tradeCountSource: null }),
      TODAY,
    );
    assert.equal(result.tradeCountSource, "verified");
  });

  it("handles Decimal-like dailyPnl (toString-able object)", () => {
    const decimalLike = { toString: () => "-75.50" };
    const result = resolveSessionDisplayMetrics(
      { sessionDate: TODAY, tradesCount: 1, dailyPnl: decimalLike as unknown as number, tradeCountSource: "verified" },
      TODAY,
    );
    assert.equal(result.dailyPnl, -75.5);
  });
});

// ── deriveRowStatusLabel — maintenance window ─────────────────────────────────

describe("deriveRowStatusLabel — maintenance window", () => {
  const allowedBase = {
    status: "allowed" as AccountStatus,
    setupNeededReason: null as null,
    enforcementMode: "broker_active" as EnforcementMode,
    requiresAutomatedActionsConsent: false,
  };

  it("returns 'Maintenance' for allowed account during maintenance", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, isMaintenanceWindow: true }),
      "Maintenance",
    );
  });

  it("returns 'Tradable' for allowed account outside maintenance", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, isMaintenanceWindow: false }),
      "Tradable",
    );
  });

  it("maintenance does not override locked status", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, status: "locked", isMaintenanceWindow: true }),
      "Locked",
    );
  });

  it("maintenance does not override warning status", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, status: "warning", isMaintenanceWindow: true }),
      "Warning",
    );
  });

  it("maintenance does not override setup_needed status", () => {
    assert.equal(
      deriveRowStatusLabel({
        ...allowedBase,
        status: "setup_needed",
        setupNeededReason: "no_rules",
        isMaintenanceWindow: true,
      }),
      "Needs rules",
    );
  });
});

// ── deriveTradingPermissionStatus — maintenance window ────────────────────────

describe("deriveTradingPermissionStatus — maintenance window", () => {
  it("returns maintenance headline when all accounts are allowed and maintenance is active", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "broker_active")],
      isMaintenanceWindow: true,
    });
    assert.equal(result?.level, "allowed");
    assert.equal(result?.headline, "CME break");
    assert.match(result?.subline ?? "", /5:00 PM CT/);
  });

  it("maintenance banner is suppressed when an account is locked", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("locked")],
      isMaintenanceWindow: true,
    });
    assert.equal(result?.level, "locked");
  });

  it("maintenance banner is suppressed when an account is in warning", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("warning")],
      isMaintenanceWindow: true,
    });
    assert.equal(result?.level, "warning");
  });

  it("isMaintenanceWindow false → normal Allowed to trade headline", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "broker_active")],
      isMaintenanceWindow: false,
    });
    assert.equal(result?.headline, "Allowed to trade");
  });
});

// ── deriveRowStatusLabel — weekend close ──────────────────────────────────────

describe("deriveRowStatusLabel — weekend close", () => {
  const allowedBase = {
    status: "allowed" as AccountStatus,
    setupNeededReason: null as null,
    enforcementMode: "broker_active" as EnforcementMode,
    requiresAutomatedActionsConsent: false,
  };

  it("returns 'Market closed' for allowed account during weekend close", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, isWeekendClose: true }),
      "Market closed",
    );
  });

  it("returns 'Tradable' for allowed account outside weekend close", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, isWeekendClose: false }),
      "Tradable",
    );
  });

  it("weekend close does not override locked status", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, status: "locked", isWeekendClose: true }),
      "Locked",
    );
  });

  it("weekend close does not override warning status", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, status: "warning", isWeekendClose: true }),
      "Warning",
    );
  });

  it("weekend close does not override setup_needed status", () => {
    assert.equal(
      deriveRowStatusLabel({
        ...allowedBase,
        status: "setup_needed",
        setupNeededReason: "no_rules",
        isWeekendClose: true,
      }),
      "Needs rules",
    );
  });

  it("weekend close takes priority over maintenance when both are true", () => {
    assert.equal(
      deriveRowStatusLabel({ ...allowedBase, isWeekendClose: true, isMaintenanceWindow: true }),
      "Market closed",
    );
  });
});

// ── deriveTradingPermissionStatus — weekend close ─────────────────────────────

describe("deriveTradingPermissionStatus — weekend close", () => {
  it("returns 'Market closed' headline when all accounts allowed and weekend close is active", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "broker_active")],
      isWeekendClose: true,
    });
    assert.equal(result?.level, "allowed");
    assert.equal(result?.headline, "Market closed");
    assert.match(result?.subline ?? "", /Sunday/);
    assert.match(result?.subline ?? "", /5:00 PM CT/);
  });

  it("weekend close banner is suppressed when an account is locked", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("locked")],
      isWeekendClose: true,
    });
    assert.equal(result?.level, "locked");
  });

  it("weekend close banner is suppressed when an account is in warning", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed"), makeAccount("warning")],
      isWeekendClose: true,
    });
    assert.equal(result?.level, "warning");
  });

  it("isWeekendClose false → normal Allowed to trade headline", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "broker_active")],
      isWeekendClose: false,
    });
    assert.equal(result?.headline, "Allowed to trade");
  });
});

// ── deriveBrokerEnforcementNoteCopy ──────────────────────────────────────────
//
// Verifies copy and visual kind for the combined internalLockActive + brokerLockStatus
// cases introduced by the Phase 2C-F canary (post-canary dashboard hardening).

describe("deriveBrokerEnforcementNoteCopy — internalLockActive=true", () => {
  it("internal lock + broker_locked → confirmed text, broker_active kind", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: true,
      brokerLockStatus: "broker_locked",
    });
    assert.ok(
      result.text.includes("Broker enforcement confirmed"),
      `expected confirmed text, got: ${result.text}`,
    );
    assert.equal(result.kind, "broker_active");
  });

  it("internal lock + broker_locked → does NOT say 'No Tradovate action was sent'", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: true,
      brokerLockStatus: "broker_locked",
    });
    assert.ok(
      !result.text.includes("No Tradovate action was sent"),
      `must not claim no action was sent when broker_locked: ${result.text}`,
    );
  });

  it("internal lock + dry_run → monitoring-only text, dry_run kind", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: true,
      brokerLockStatus: "dry_run",
    });
    assert.ok(
      result.text.includes("Monitoring only"),
      `expected monitoring-only text, got: ${result.text}`,
    );
    assert.equal(result.kind, "dry_run");
    assert.ok(
      !result.text.includes("test mode"),
      `dry_run message must not say 'test mode': ${result.text}`,
    );
  });

  it("internal lock + null → internal_only kind, no action text", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: true,
      brokerLockStatus: null,
    });
    assert.equal(result.kind, "internal_only");
    assert.ok(
      result.text.includes("No Tradovate action was sent"),
      `expected no-action text for null status, got: ${result.text}`,
    );
  });

  it("internal lock + broker_lock_failed → internal_only kind (not broker_active)", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: true,
      brokerLockStatus: "broker_lock_failed",
    });
    assert.equal(result.kind, "internal_only");
  });
});

describe("deriveBrokerEnforcementNoteCopy — internalLockActive=false", () => {
  it("no internal lock + broker_locked → delegates to deriveBrokerEnforcementCopy, broker_active kind", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: false,
      brokerLockStatus: "broker_locked",
    });
    assert.equal(result.kind, "broker_active");
    assert.ok(
      result.text.includes("Broker-side lock active"),
      `expected broker-side lock text, got: ${result.text}`,
    );
  });

  it("no internal lock + null → internal_only kind", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: false,
      brokerLockStatus: null,
    });
    assert.equal(result.kind, "internal_only");
  });

  it("no internal lock + dry_run → dry_run kind", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: false,
      brokerLockStatus: "dry_run",
    });
    assert.equal(result.kind, "dry_run");
  });
});

// ── Post-canary UI scenarios ──────────────────────────────────────────────────
//
// Post-canary state: riskState=NORMAL, activeCount=0, historical broker_locked row.
// The dashboard should show "Allowed to trade" with no conflicting lock copy.

describe("post-canary: tradable account with historical broker_locked record", () => {
  it("internalLockActive=false + broker_locked does NOT say 'Guardrail internal lock active'", () => {
    const result = deriveBrokerEnforcementNoteCopy({
      internalLockActive: false,
      brokerLockStatus: "broker_locked",
    });
    assert.ok(
      !result.text.includes("Guardrail internal lock active"),
      `tradable account must not show 'Guardrail internal lock active': ${result.text}`,
    );
  });

  it("'Allowed to trade' headline matches the allowed level", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [{ status: "allowed", enforcementMode: "broker_active", permissionLevel: null }],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "allowed");
    assert.equal(result.headline, "Allowed to trade");
  });

  it("allowed level does not require locked accounts", () => {
    const locked = deriveTradingPermissionStatus({
      accounts: [{ status: "locked", enforcementMode: "broker_active", permissionLevel: null }],
    });
    const allowed = deriveTradingPermissionStatus({
      accounts: [{ status: "allowed", enforcementMode: "broker_active", permissionLevel: null }],
    });
    assert.notEqual(locked?.level, "allowed");
    assert.equal(allowed?.level, "allowed");
  });
});
