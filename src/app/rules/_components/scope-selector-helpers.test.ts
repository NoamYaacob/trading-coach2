import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveScopeGroupBadge,
  deriveScopeAccountBadge,
} from "./scope-selector-helpers.ts";

// ── deriveScopeGroupBadge ─────────────────────────────────────────────────────

describe("deriveScopeGroupBadge — capability-driven (no Protection test mode override)", () => {
  it("full_access never returns 'Protection test mode'", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.notEqual(badge.label, "Protection test mode");
    assert.ok(!badge.label.toLowerCase().includes("test mode"));
  });

  it("read_only never returns 'Protection test mode'", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_readonly",
      permissionLevel: "read_only",
      requiresConsentInGroup: false,
    });
    assert.notEqual(badge.label, "Protection test mode");
  });
});

describe("deriveScopeGroupBadge — disconnected states", () => {
  for (const status of ["not_connected", "expired", "connection_error"]) {
    it(`${status} → 'Reconnect'`, () => {
      const badge = deriveScopeGroupBadge({
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
        connectionStatus: status,
        permissionLevel: null,
        requiresConsentInGroup: false,
      });
      assert.equal(badge.label, "Setting up");
    });
  }
});

describe("deriveScopeGroupBadge — full_access permission", () => {
  it("full_access + no consent needed → 'Risk settings'", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Risk settings");
    assert.ok(badge.cls.includes("emerald"), `expected emerald colour, got: ${badge.cls}`);
  });

  it("full_access + consent missing in group → 'Action required'", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_live",
      permissionLevel: "full_access",
      requiresConsentInGroup: true,
    });
    assert.equal(badge.label, "Action required");
    assert.ok(badge.cls.includes("amber"), `expected amber colour, got: ${badge.cls}`);
  });

  it("full_access via connected_readonly status → 'Risk settings' (probe wins over status)", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_readonly",
      permissionLevel: "full_access",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Risk settings");
  });
});

describe("deriveScopeGroupBadge — read_only permission", () => {
  it("read_only → 'Monitoring' (alerts only, no broker actions)", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_readonly",
      permissionLevel: "read_only",
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Monitoring");
    assert.ok(
      !badge.label.toLowerCase().includes("read"),
      `label must not contain 'read': ${badge.label}`,
    );
  });
});

describe("deriveScopeGroupBadge — unverified permission", () => {
  it("permissionLevel=null → 'Verifying'", () => {
    const badge = deriveScopeGroupBadge({
      connectionStatus: "connected_live",
      permissionLevel: null,
      requiresConsentInGroup: false,
    });
    assert.equal(badge.label, "Verifying");
  });

  it("permissionLevel=undefined → 'Verifying'", () => {
    const badge = deriveScopeGroupBadge({
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
    "protection test mode",
  ];

  const cases: Parameters<typeof deriveScopeGroupBadge>[0][] = [
    { connectionStatus: "connected_readonly", permissionLevel: "read_only", requiresConsentInGroup: false },
    { connectionStatus: "connected_live", permissionLevel: null, requiresConsentInGroup: false },
    { connectionStatus: "connected_live", permissionLevel: "full_access", requiresConsentInGroup: false },
    { connectionStatus: "connected_live", permissionLevel: "full_access", requiresConsentInGroup: true },
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
