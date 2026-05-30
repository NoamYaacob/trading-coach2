/**
 * Phase K — Visual polish regression tests.
 *
 * Locks in:
 *  - ScopeSelector: copper selected account state (GR copper tokens)
 *  - ScopeSelector: GR design tokens on group headers (--gr-ink, --gr-text-mute)
 *  - RuleCard: warmer base background (--gr-surface-warm) + stronger border (--gr-border-hi)
 *  - RuleCard footer: richer state labels (From template / Saved / Planned / Configured)
 *  - Status strip: chip-style with colored dot indicators
 *  - Daily Loss editor: "Active now" label above active actions block
 *  - Daily Loss editor: planned section has opacity-60 disabled treatment
 *  - Honesty: no fake data introduced by these changes
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── ScopeSelector — Phase K copper selected state ─────────────────────────────

describe("ScopeSelector — Phase K copper selected account", () => {
  const SRC = read("scope-selector.tsx");

  it("selected account item uses GR copper token border", () => {
    assert.ok(
      SRC.includes("var(--gr-copper-bd)"),
      "selected account must use --gr-copper-bd border for the active indicator",
    );
  });

  it("selected account item uses GR copper token background", () => {
    assert.ok(
      SRC.includes("var(--gr-copper-bg)"),
      "selected account must use --gr-copper-bg fill for the active state",
    );
  });

  it("account name uses --gr-ink (strong legible hierarchy)", () => {
    assert.ok(
      SRC.includes("var(--gr-ink)"),
      "selected account name must use --gr-ink for strong legible hierarchy",
    );
  });

  it("account metadata sub-text uses --gr-text-mute (not stone-400)", () => {
    assert.ok(
      SRC.includes("var(--gr-text-mute)"),
      "account metadata sub-text must use --gr-text-mute (GR token, not hardcoded stone-400)",
    );
  });

  it("warm-design regression guards still pass (copper selected, amber starter)", () => {
    assert.ok(SRC.includes("var(--gr-copper-bd)"), "selected account must use the copper border token");
    assert.ok(SRC.includes("var(--gr-copper-bg)"), "selected account must use the copper fill token");
    assert.ok(SRC.includes("border-amber"), "starter item must keep amber border (regression guard)");
  });
});

// ── RuleCard — Phase K richer card treatment ──────────────────────────────────

describe("RulesOverviewScreen — Phase K richer rule cards", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("card base uses --gr-surface-warm background (warm, not plain white)", () => {
    assert.ok(
      SRC.includes("var(--gr-surface-warm)"),
      "rule card must use --gr-surface-warm as the base background for warmth",
    );
  });

  it("card uses --gr-border-hi for a stronger resting border", () => {
    assert.ok(
      SRC.includes("var(--gr-border-hi)"),
      "rule card must use --gr-border-hi for the resting border (stronger than --gr-border)",
    );
  });

  it("footer shows 'From template' state when pendingNote is set", () => {
    assert.ok(
      SRC.includes("From template"),
      "card footer must show 'From template' state when a pendingNote is present",
    );
  });

  it("footer shows 'Saved' state for saved-eval-soon rules", () => {
    assert.ok(
      SRC.includes("Saved"),
      "card footer must show 'Saved' state for saved-eval-soon rules",
    );
  });

  it("footer shows 'Planned' state for planned/not-active rules", () => {
    assert.ok(
      SRC.includes("Planned"),
      "card footer must show 'Planned' state for planned-broker / not-active rules",
    );
  });

  it("footer shows 'Configured' state with copper dot for active rules", () => {
    assert.ok(
      SRC.includes("Configured"),
      "card footer must show 'Configured' state for set rules",
    );
  });
});

// ── Status strip — Phase K chip style ────────────────────────────────────────

describe("RulesOverviewScreen — Phase K chip-style status strip", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("status strip chips use rounded-full border styling", () => {
    assert.ok(
      SRC.includes("rounded-full border"),
      "status strip chips must use rounded-full border (chip style)",
    );
  });

  it("session chip has emerald dot for open state", () => {
    assert.ok(
      SRC.includes("bg-emerald-400"),
      "open session chip must include an emerald dot indicator",
    );
  });

  it("real data labels still present (Rules set, Session, Pending)", () => {
    for (const label of ["Rules set", "Session", "Pending"]) {
      assert.ok(SRC.includes(label), `status strip must still show "${label}"`);
    }
  });

  it("no fake metrics introduced", () => {
    for (const fake of ["Today P&L", "Compliance", "Balance:", "P&L:"]) {
      assert.ok(!SRC.includes(fake), `status strip must not surface "${fake}"`);
    }
  });
});

// ── Daily Loss editor — Phase K Active now / Planned separation ───────────────

describe("DailyLossEditor — Phase K Active now vs Planned", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("renders an 'Active now' section header above the active actions", () => {
    assert.ok(
      SRC.includes("Active now"),
      "editor must clearly label the active actions block as 'Active now'",
    );
  });

  it("planned section is visually disabled via opacity-60", () => {
    assert.ok(
      SRC.includes("opacity-60"),
      "planned actions block must use opacity-60 to signal disabled / not-yet-active state",
    );
  });

  it("planned section still renders planned-broker badges", () => {
    assert.ok(
      SRC.includes("planned-broker"),
      "planned section must still render planned-broker enforcement badges",
    );
  });

  it("forbidden phrasing not present in planned block", () => {
    for (const phrase of ["Auto-flatten positions", "Cancel all open orders", "Lock account at broker"]) {
      assert.ok(!SRC.includes(phrase), `editor must not use forbidden phrase "${phrase}"`);
    }
  });
});
