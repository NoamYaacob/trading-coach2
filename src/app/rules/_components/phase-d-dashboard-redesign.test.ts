/**
 * Phase D — Trading Plan dashboard redesign regression tests.
 *
 * Locks in:
 *  - RulesOverviewScreen has a stats strip with real data (rules-set count,
 *    session status, pending indicator). No fabricated telemetry.
 *  - Rule cards use a large value display (text-2xl) for premium feel.
 *  - Locked session shows a badge indicator on cards — not opacity wash.
 *  - ScopeSelector has a connection-status dot on broker group headers.
 *  - Scope selector still uses amber active state (regression guard).
 *  - No balance / P&L data fabricated (truthful "not available" comment).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── RulesOverviewScreen — stats strip ────────────────────────────────────────

describe("RulesOverviewScreen — Phase D stats strip", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("includes a 'Rules set' stat with real computed count", () => {
    assert.ok(
      SRC.includes("Rules set"),
      "stats strip must show 'Rules set' with a computed count of configured rules",
    );
  });

  it("includes a session status indicator", () => {
    assert.ok(
      SRC.includes("Session"),
      "stats strip must include a session status indicator (Open / Locked)",
    );
    assert.ok(
      SRC.includes("Locked") && SRC.includes("Open"),
      "session stat must surface both 'Locked' and 'Open' states",
    );
  });

  it("includes a pending changes indicator", () => {
    assert.ok(
      SRC.includes("Pending"),
      "stats strip must indicate pending changes status",
    );
  });

  it("does not fabricate balance or P&L values", () => {
    assert.ok(
      !SRC.includes("$0.00") && !SRC.includes("fakeBalance") && !SRC.includes("fakePnl"),
      "stats strip must not render fabricated balance or P&L data",
    );
  });

  it("explicitly documents that balance is omitted (not fabricated)", () => {
    assert.ok(
      SRC.includes("omitted") || SRC.includes("not available"),
      "source must note that balance/P&L is omitted since it is not fetched on this page",
    );
  });
});

// ── RulesOverviewScreen — premium card anatomy ─────────────────────────────

describe("RulesOverviewScreen — Phase D premium card anatomy", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("rule value display uses large text-2xl for visual weight", () => {
    assert.ok(
      SRC.includes("text-2xl"),
      "card value area must use text-2xl for large numeric display",
    );
  });

  it("locked state renders a 'Locked' badge (not an opacity wash)", () => {
    assert.ok(
      SRC.includes('"Locked"') || SRC.includes("'Locked'") || SRC.includes(">Locked<"),
      "locked state must render a visible 'Locked' label on the card",
    );
    assert.ok(
      !SRC.includes("opacity-50"),
      "locked cards must not use opacity-50 — text and badges stay readable",
    );
  });

  it("'Configure →' action is visible on hover for editable rules", () => {
    assert.ok(
      SRC.includes("Configure →"),
      "editable rule cards must surface a 'Configure →' affordance on hover",
    );
  });

  it("view-only cards show 'View' label for non-editable rules", () => {
    assert.ok(
      SRC.includes("isViewOnly") && SRC.includes("View"),
      "non-editable cards must branch on isViewOnly and render a 'View' label",
    );
  });
});

// ── ScopeSelector — Phase D app-shell enhancements ───────────────────────────

describe("ScopeSelector — Phase D connection status dot", () => {
  const SRC = read("scope-selector.tsx");

  it("has a connectionDotCls helper for status dots", () => {
    assert.ok(
      SRC.includes("connectionDotCls"),
      "scope selector must use a connectionDotCls helper for group header status dots",
    );
  });

  it("live connection maps to emerald dot", () => {
    assert.ok(
      SRC.includes("bg-emerald-400"),
      "connected_live status must show an emerald dot in the group header",
    );
  });

  it("selected account still uses amber border (regression guard)", () => {
    assert.ok(
      SRC.includes("border-amber"),
      "selected account item must still use an amber border (warm design regression guard)",
    );
  });

  it("selected starter badge still uses amber-600 (regression guard)", () => {
    assert.ok(
      SRC.includes("bg-amber-600"),
      "selected starter badge must still use amber-600 (warm design regression guard)",
    );
  });

  it("no stone-950 in selected state (regression guard)", () => {
    assert.ok(
      !SRC.includes("bg-stone-950") && !SRC.includes("border-stone-950"),
      "scope selector must not revert to stone-950 for selected states",
    );
  });
});
