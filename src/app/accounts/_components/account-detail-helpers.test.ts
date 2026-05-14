import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveRuleSource,
  deriveRuleSourceLabel,
  hasAnyCoverage,
} from "./account-detail-helpers.ts";

// ── deriveRuleSource ──────────────────────────────────────────────────────────

describe("deriveRuleSource", () => {
  it("account-specific rules take priority over default plan", () => {
    assert.equal(
      deriveRuleSource({ hasAccountRules: true, hasDefaultRules: true }),
      "account",
    );
  });

  it("returns 'default' when no account-specific rules but default plan exists", () => {
    assert.equal(
      deriveRuleSource({ hasAccountRules: false, hasDefaultRules: true }),
      "default",
    );
  });

  it("returns 'account' when account rules exist and no default plan", () => {
    assert.equal(
      deriveRuleSource({ hasAccountRules: true, hasDefaultRules: false }),
      "account",
    );
  });

  it("returns 'none' when neither account rules nor default plan exist", () => {
    assert.equal(
      deriveRuleSource({ hasAccountRules: false, hasDefaultRules: false }),
      "none",
    );
  });
});

// ── deriveRuleSourceLabel ─────────────────────────────────────────────────────

describe("deriveRuleSourceLabel", () => {
  it("'account' → 'Account-specific rules active'", () => {
    assert.equal(deriveRuleSourceLabel("account"), "Account-specific rules active");
  });

  it("'default' → 'Uses Default Trading Plan'", () => {
    assert.equal(deriveRuleSourceLabel("default"), "Uses Default Trading Plan");
  });

  it("'none' → 'No rules configured'", () => {
    assert.equal(deriveRuleSourceLabel("none"), "No rules configured");
  });

  it("labels do not use old 'Guardian' terminology", () => {
    for (const source of ["account", "default", "none"] as const) {
      const label = deriveRuleSourceLabel(source);
      assert.ok(
        !label.toLowerCase().includes("guardian"),
        `label for '${source}' must not say 'Guardian': ${label}`,
      );
    }
  });

  it("labels do not use old 'Monitoring only' terminology", () => {
    for (const source of ["account", "default", "none"] as const) {
      const label = deriveRuleSourceLabel(source);
      assert.ok(
        !label.toLowerCase().includes("monitoring only"),
        `label for '${source}' must not say 'Monitoring only': ${label}`,
      );
    }
  });

  it("'none' label does not imply active monitoring (would mislead the user)", () => {
    const label = deriveRuleSourceLabel("none");
    assert.ok(
      !label.toLowerCase().includes("monitoring"),
      `'none' label must not say 'monitoring': ${label}`,
    );
  });

  it("each source produces a distinct label", () => {
    const labels = [
      deriveRuleSourceLabel("account"),
      deriveRuleSourceLabel("default"),
      deriveRuleSourceLabel("none"),
    ];
    const unique = new Set(labels);
    assert.equal(unique.size, 3, "each ruleSource must map to a unique label");
  });
});

// ── hasAnyCoverage ────────────────────────────────────────────────────────────

describe("hasAnyCoverage", () => {
  it("account rules alone → covered", () => {
    assert.equal(hasAnyCoverage({ hasAccountRules: true, hasDefaultRules: false }), true);
  });

  it("default plan alone → covered", () => {
    assert.equal(hasAnyCoverage({ hasAccountRules: false, hasDefaultRules: true }), true);
  });

  it("both → covered", () => {
    assert.equal(hasAnyCoverage({ hasAccountRules: true, hasDefaultRules: true }), true);
  });

  it("neither → not covered", () => {
    assert.equal(hasAnyCoverage({ hasAccountRules: false, hasDefaultRules: false }), false);
  });
});
