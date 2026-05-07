import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveScopeGroupBadge,
  deriveScopeAccountBadge,
} from "./scope-selector-helpers.ts";

// ── deriveScopeGroupBadge ─────────────────────────────────────────────────────

describe("deriveScopeGroupBadge — test mode", () => {
  it("isDryRun=true → 'Test mode' regardless of permission level", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: true,
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Test mode");
    assert.ok(badge.cls.includes("sky"), `expected sky colour, got: ${badge.cls}`);
  });

  it("isDryRun=true overrides disconnected status too", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: true,
      connectionStatus: "expired",
      permissionLevel: null,
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Test mode");
  });

  it("no user-facing copy contains 'dry_run'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: true,
      connectionStatus: "connected_readonly",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.ok(
      !badge.label.toLowerCase().includes("dry"),
      `label must not contain 'dry': ${badge.label}`,
    );
  });
});

describe("deriveScopeGroupBadge — disconnected states", () => {
  for (const status of ["not_connected", "expired", "connection_error"]) {
    it(`${status} → 'Reconnect'`, () => {
      const badge = deriveScopeGroupBadge({
        isDryRun: false,
        connectionStatus: status,
        permissionLevel: "full_access",
        requiresConsentInGroup: false,
      });
      assert.equal(badge.label, "Reconnect");
    });
  }
});

describe("deriveScopeGroupBadge — pending setup", () => {
  for (const status of ["pending_webhook", "oauth_pending_storage"]) {
    it(`${status} → 'Setting up'`, () => {
      const badge = deriveScopeGroupBadge({
        isDryRun: false,
        connectionStatus: status,
        permissionLevel: null,
        requiresConsentInGroup: false,
      });
      assert.equal(badge.label, "Setting up");
    });
  }
});

describe("deriveScopeGroupBadge — full_access permission", () => {
  it("full_access + no consent needed → 'Protected'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Protected");
    assert.ok(badge.cls.includes("emerald"), `expected emerald colour, got: ${badge.cls}`);
  });

  it("full_access + consent missing in group → 'Action required'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: true,
    });
    assert.equal(badge.label, "Action required");
    assert.ok(badge.cls.includes("amber"), `expected amber colour, got: ${badge.cls}`);
  });

  it("full_access even via connected_readonly connectionStatus → 'Protected'", () => {
    // permissionLevel wins over connectionStatus for the group badge.
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_readonly",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Protected");
  });
});

describe("deriveScopeGroupBadge — read_only permission (replaces READ-ONLY)", () => {
  it("read_only → 'Limited', not 'Read-only'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_readonly",
      permissionLevel: "read_only",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Limited");
    assert.notEqual(badge.label, "Read-only");
    assert.ok(
      !badge.label.toLowerCase().includes("read"),
      `label must not contain 'read': ${badge.label}`,
    );
  });
});

describe("deriveScopeGroupBadge — unverified permission", () => {
  it("permissionLevel=null → 'Verifying'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_live",
      permissionLevel: null,
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Verifying");
  });

  it("permissionLevel=undefined → 'Verifying'", () => {
    const badge = deriveScopeGroupBadge({
      isDryRun: false,
      connectionStatus: "connected_live",
      permissionLevel: undefined,
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Verifying");
  });
});

// ── deriveScopeAccountBadge ────────────────────────────────────────────────────

describe("deriveScopeAccountBadge", () => {
  it("unavailable (missingFromBroker) → 'Inactive'", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: true,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: false,
    });
    assert.ok(badge !== null);
    assert.equal(badge!.label, "Inactive");
  });

  it("unavailable wins over requiresConsent", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: true,
      requiresAutomatedActionsConsent: true,
      hasAccountRules: true,
    });
    assert.ok(badge !== null);
    assert.equal(badge!.label, "Inactive");
  });

  it("requiresAutomatedActionsConsent → 'Action required'", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: true,
      hasAccountRules: false,
    });
    assert.ok(badge !== null);
    assert.equal(badge!.label, "Action required");
  });

  it("requiresConsent wins over custom rules badge", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: true,
      hasAccountRules: true,
    });
    assert.ok(badge !== null);
    assert.equal(badge!.label, "Action required");
  });

  it("hasAccountRules only → 'Custom'", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: true,
    });
    assert.ok(badge !== null);
    assert.equal(badge!.label, "Custom");
  });

  it("no flags → null (no badge)", () => {
    const badge = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: false,
    });
    assert.equal(badge, null);
  });
});

// ── deriveScopeAccountBadge — per-account isolation ──────────────────────────

describe("deriveScopeAccountBadge — per-account badge is independent", () => {
  it("two accounts both hasAccountRules=false → both return null (no badge)", () => {
    const badgeA = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: false,
    });
    const badgeB = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: false,
    });
    assert.equal(badgeA, null, "account A without override must return null");
    assert.equal(badgeB, null, "account B without override must return null");
  });

  it("account A hasAccountRules=true, B hasAccountRules=false → A gets Custom, B gets null", () => {
    const badgeA = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: true,
    });
    const badgeB = deriveScopeAccountBadge({
      isUnavailable: false,
      requiresAutomatedActionsConsent: false,
      hasAccountRules: false,
    });
    assert.ok(badgeA !== null, "account A with override must have a badge");
    assert.equal(badgeA!.label, "Custom");
    assert.equal(badgeB, null, "account B without override must not inherit A's badge");
  });

  it("creating override for A does not affect B: B stays null regardless", () => {
    const makeA = (hasRules: boolean) =>
      deriveScopeAccountBadge({ isUnavailable: false, requiresAutomatedActionsConsent: false, hasAccountRules: hasRules });

    const beforeA = makeA(false);
    assert.equal(beforeA, null);

    const afterA = makeA(true);
    assert.ok(afterA !== null);
    assert.equal(afterA!.label, "Custom");

    // B is unchanged — its badge comes only from its own flags
    const badgeB = deriveScopeAccountBadge({ isUnavailable: false, requiresAutomatedActionsConsent: false, hasAccountRules: false });
    assert.equal(badgeB, null, "B must still be null after A gets an override");
  });
});

// ── Regression: never render raw technical strings ────────────────────────────

describe("deriveScopeGroupBadge — regression: no raw technical labels", () => {
  const FORBIDDEN = [
    "read-only",
    "read_only",
    "connected_readonly",
    "monitoring_only",
    "dry_run",
    "permission_unverified",
  ];

  const cases: Parameters<typeof deriveScopeGroupBadge>[0][] = [
    { isDryRun: false, connectionStatus: "connected_readonly", permissionLevel: "read_only", requiresConsentInGroup: false },
    { isDryRun: false, connectionStatus: "connected_live", permissionLevel: null, requiresConsentInGroup: false },
    { isDryRun: true, connectionStatus: "connected_live", permissionLevel: "full_access", requiresConsentInGroup: false },
    { isDryRun: false, connectionStatus: "connected_live", permissionLevel: "full_access", requiresConsentInGroup: false },
  ];

  for (const input of cases) {
    it(`no forbidden string in badge for ${JSON.stringify(input)}`, () => {
      const badge = deriveScopeGroupBadge(input);
      for (const forbidden of FORBIDDEN) {
        assert.ok(
          !badge.label.toLowerCase().includes(forbidden.toLowerCase()),
          `badge.label "${badge.label}" must not contain "${forbidden}"`,
        );
      }
    });
  }
});
