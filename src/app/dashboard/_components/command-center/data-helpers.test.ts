import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveTradingPermissionStatus } from "./data-helpers.ts";
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
