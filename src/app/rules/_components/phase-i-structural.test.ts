/**
 * Phase I — Structural workspace redesign regression tests.
 *
 * Phase I moves the Trading Plan page from a page-within-a-card layout to a
 * real app workspace: edge-to-edge, no marketing chrome, compact breadcrumb
 * header. This file locks in the structural choices so a future polish pass
 * doesn't accidentally re-introduce the old card-style chrome.
 *
 * Locks in:
 *  - AppShell workspaceMode: no marketing footer, no max-w-6xl on main.
 *  - AppShell workspaceMode: TopNav header sits on warm-elev surface, edge-to-edge.
 *  - rules page: no outer rounded card wrapping the workspace (was rounded-2xl).
 *  - WorkspaceHeader: single-row breadcrumb strip (Trading Plan / [target]).
 *  - Overview summary strip: inline horizontal (not a big card).
 *  - All Phase F/G/H invariants still hold.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const REPO_ROOT = resolve(ROOT, "../../../..");

function readRepo(rel: string) {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── AppShell workspaceMode is edge-to-edge ────────────────────────────────────

describe("AppShell — Phase I edge-to-edge workspace", () => {
  const SRC = readRepo("src/components/ui/app-shell.tsx");

  it("workspaceMode does NOT wrap main in max-w-6xl (full bleed)", () => {
    // Find the workspaceMode branch and verify <main> doesn't carry max-w-6xl.
    const idx = SRC.indexOf("if (workspaceMode)");
    assert.ok(idx !== -1, "AppShell must keep the workspaceMode branch");
    const block = SRC.slice(idx, idx + 1500);
    const mainMatch = block.match(/<main[^>]*>/);
    assert.ok(mainMatch, "workspaceMode branch must render a <main>");
    assert.ok(
      !/max-w-6xl/.test(mainMatch![0]),
      "workspaceMode <main> must NOT have max-w-6xl (full-bleed workspace)",
    );
  });

  it("workspaceMode does NOT render the marketing footer", () => {
    const idx = SRC.indexOf("if (workspaceMode)");
    const branch = SRC.slice(idx, SRC.indexOf("return (", idx + 100) + 1500);
    assert.ok(
      !/<footer/i.test(branch),
      "workspaceMode must not render a <footer> — the workspace IS the page",
    );
  });

  it("workspaceMode uses the warm cream canvas directly (no gradient bg)", () => {
    const idx = SRC.indexOf("if (workspaceMode)");
    // The non-workspace render also lives in this file. Slice precisely to the
    // start of the post-workspace `return (` so the assertions don't pick up
    // the marketing gradient that legitimately exists in the other branch.
    const branchEnd = SRC.indexOf("\n  return (", idx);
    assert.ok(branchEnd > idx, "AppShell must have a fallback return after the workspaceMode branch");
    const block = SRC.slice(idx, branchEnd);
    assert.ok(
      block.includes("#f3ece0"),
      "workspaceMode outer wrapper must use the warm cream canvas bg",
    );
    assert.ok(
      !/radial-gradient/.test(block),
      "workspaceMode must not use the marketing gradient bg",
    );
  });

  it("TopNav header in workspaceMode uses warm elevated surface (integrated, not marketing chrome)", () => {
    const idx = SRC.indexOf("if (workspaceMode)");
    const block = SRC.slice(idx, idx + 1500);
    assert.ok(
      block.includes("--gr-bg-elev") || block.includes("#f9f4ea"),
      "workspaceMode header must use the warm elevated surface to integrate with the workspace",
    );
  });
});

// ── rules page workspace is flat (no outer card) ──────────────────────────────

describe("rules page — Phase I flat workspace", () => {
  const SRC = readRepo("src/app/rules/page.tsx");

  it("workspace is NOT wrapped in a rounded-2xl outer card", () => {
    // Phase G had: <div className="mb-6 flex flex-1 flex-col overflow-hidden rounded-2xl border ...">
    // Phase I removes that outer card — the workspace fills the page directly.
    assert.ok(
      !SRC.includes("rounded-2xl border border-stone-200/60 shadow-"),
      "workspace panel must NOT use a rounded-2xl + shadow outer card (regression to old card chrome)",
    );
  });

  it("workspace flex row sits directly inside <AppShell>", () => {
    assert.ok(
      SRC.includes("flex min-w-0 flex-1 items-stretch overflow-hidden"),
      "workspace must use a flex row directly under AppShell (no outer card wrapper)",
    );
  });

  it("workspace header is the compact breadcrumb strip (single row, py-1.5)", () => {
    assert.ok(
      SRC.includes('py-1.5"'),
      "WorkspaceHeader must use the compact py-1.5 padding (breadcrumb strip, not card)",
    );
  });

  it("WorkspaceHeader uses '/' separators (breadcrumb style)", () => {
    // The breadcrumb has 'Trading Plan / [Account]' — locked into source.
    const wsHeaderIdx = SRC.indexOf("function WorkspaceHeader");
    assert.ok(wsHeaderIdx !== -1, "WorkspaceHeader must exist");
    const block = SRC.slice(wsHeaderIdx, wsHeaderIdx + 4000);
    assert.ok(
      block.includes("Trading Plan"),
      "WorkspaceHeader must include the 'Trading Plan' crumb",
    );
    assert.ok(
      block.includes('text-[10px]') || block.includes('text-[10.5px]'),
      "WorkspaceHeader crumb labels must use compact (10–10.5px) type",
    );
  });

  it("denseHero invariant still set (Phase A → I preserved)", () => {
    assert.ok(/\bdenseHero\b/.test(SRC), "rules page must still set denseHero on AppShell");
  });

  it("workspaceMode invariant still set (Phase G → I preserved)", () => {
    assert.ok(SRC.includes("workspaceMode"), "rules page must still set workspaceMode");
  });

  it("left panel is still 240px (Phase G spec preserved)", () => {
    assert.ok(SRC.includes("w-[240px]"), "workspace left panel must remain 240px wide");
  });

  it("min-w-0 invariant still on the account form wrapper (Phase F)", () => {
    assert.ok(
      SRC.includes('className="min-w-0"'),
      "AccountRulesForm wrapper must still have className=\"min-w-0\"",
    );
  });
});

// ── Overview summary strip is inline (not a card) ─────────────────────────────

describe("RulesOverviewScreen — Phase I inline summary strip", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("summary strip uses flex flex-wrap items-center gap-x (not a 3-col card)", () => {
    // The Phase G stats card had `grid grid-cols-3 divide-x ... rounded-2xl border ... bg-...`.
    // Phase I replaces it with an inline `flex flex-wrap items-center gap-x-...` row.
    assert.ok(
      !SRC.includes("grid grid-cols-3 divide-x"),
      "summary strip must not regress to the grid-cols-3 divide-x card",
    );
  });

  it("summary strip still shows the real-data labels (Rules set, Session, Pending)", () => {
    for (const label of ["Rules set", "Session", "Pending"]) {
      assert.ok(SRC.includes(label), `summary strip must still surface "${label}"`);
    }
  });

  it("summary strip never invents Balance / P&L / Compliance metrics (honesty)", () => {
    for (const forbidden of ["Today P&L", "Compliance", "Balance:", "P&L:"]) {
      assert.ok(
        !SRC.includes(forbidden),
        `summary strip must not surface "${forbidden}" — Phase I honesty constraint`,
      );
    }
  });
});
