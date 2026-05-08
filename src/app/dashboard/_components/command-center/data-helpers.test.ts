import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveTradingPermissionStatus, resolveSessionDisplayMetrics } from "./data-helpers.ts";
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
    assert.equal(result.headline, "Protection test mode");
    assert.ok(result.subline.includes("will not block"));
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
    assert.ok(result.headline.includes("Protection test mode"), `got: ${result.headline}`);
  });

  it("test_mode with single locked account uses singular", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("locked", "dry_run"), makeAccount("allowed", "dry_run")],
    });
    assert.ok(result !== null);
    assert.equal(result.level, "test_mode");
    assert.ok(result.headline.includes("1 account"), `got: ${result.headline}`);
  });

  it("subline always mentions monitoring and no blocking", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run")],
    });
    assert.ok(result !== null);
    assert.ok(result.subline.includes("monitoring"), `got: ${result.subline}`);
    assert.ok(result.subline.includes("will not block"), `got: ${result.subline}`);
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

  it("full_access subline mentions cancel/flatten not active yet", () => {
    const result = deriveTradingPermissionStatus({
      accounts: [makeAccount("allowed", "dry_run", "full_access")],
    });
    assert.ok(result !== null);
    assert.ok(
      result.subline.toLowerCase().includes("cancel/flatten not active yet"),
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
