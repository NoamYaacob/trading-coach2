/**
 * Phase E — Guardrail design-pass regression tests.
 *
 * Locks in:
 *  - RulesOverviewScreen has group filter chips (All rules + per-group).
 *  - Filter chips use RULE_GROUPS and rulesInGroup (no hardcoded group names).
 *  - RuleCard has a sub-text helper line (rule.helper below the title).
 *  - RuleCard footer shows "Configured" / "Not configured" state label.
 *  - Enforcement key footnote is present at the bottom of the overview.
 *  - No fake enforcement labels in the footnote (only real 5 types).
 *  - All prior Phase D assertions still hold (see phase-d-dashboard-redesign.test.ts).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("RulesOverviewScreen — Phase E filter chips", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("renders an 'All rules' filter chip", () => {
    assert.ok(
      SRC.includes("All rules"),
      "overview must have an 'All rules' chip to reset the group filter",
    );
  });

  it("uses RULE_GROUPS for chip iteration (no hardcoded group names in chip row)", () => {
    assert.ok(
      SRC.includes("activeGroups"),
      "overview must iterate over activeGroups (derived from RULE_GROUPS) for filter chips",
    );
  });

  it("has client-side activeGroup state for filter", () => {
    assert.ok(
      SRC.includes("activeGroup"),
      "overview must track an activeGroup state for filtering cards by category",
    );
    assert.ok(
      SRC.includes("setActiveGroup"),
      "overview must expose a setActiveGroup setter",
    );
  });

  it("selected chip uses amber styling", () => {
    assert.ok(
      SRC.includes("bg-amber-50"),
      "active filter chip must use amber-50 background for warm accent",
    );
    assert.ok(
      SRC.includes("border-amber-300"),
      "active filter chip must use amber-300 border",
    );
  });
});

describe("RulesOverviewScreen — Phase E card anatomy", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("card renders sub-text from rule.helper", () => {
    assert.ok(
      SRC.includes("rule.helper"),
      "card must render rule.helper as sub-text below the rule title",
    );
  });

  it("card footer shows Configured / Not configured state", () => {
    assert.ok(
      SRC.includes("Configured"),
      "card footer must show 'Configured' state for set values",
    );
    assert.ok(
      SRC.includes("Not configured"),
      "card footer must show 'Not configured' for unset values",
    );
  });
});

describe("RulesOverviewScreen — Phase E enforcement key", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("has an 'About enforcement labels' footnote section", () => {
    assert.ok(
      SRC.includes("About enforcement labels"),
      "overview must have an enforcement key section explaining badge meanings",
    );
  });

  it("enforcement key covers all five real enforcement types", () => {
    assert.ok(SRC.includes("Broker-backed"), "enforcement key must mention Broker-backed");
    assert.ok(SRC.includes("App lock"), "enforcement key must mention App lock");
    assert.ok(SRC.includes("Monitor"), "enforcement key must mention Monitor");
    assert.ok(SRC.includes("Saved"), "enforcement key must mention Saved");
    assert.ok(SRC.includes("Planned"), "enforcement key must mention Planned");
  });

  it("enforcement key does not claim broker actions are active (honesty constraint)", () => {
    assert.ok(
      !SRC.includes("Auto-flatten") && !SRC.includes("Cancel all") && !SRC.includes("Lock account at broker"),
      "enforcement key must not use forbidden phrasing implying live broker actions",
    );
  });
});
