/**
 * Phase G — Trading-plan workspace design-pass regression tests.
 *
 * Locks in:
 *  - AppShell has workspaceMode?: boolean prop
 *  - rules page uses workspaceMode on AppShell
 *  - rules page uses denseHero (Phase A invariant still holds)
 *  - Workspace panel renders left panel + main workspace structure
 *  - WorkspaceHeader exists in page source
 *  - All prior Phase F assertions still pass (see phase-f-workspace.test.ts)
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

describe("AppShell — workspaceMode", () => {
  const SRC = readRepo("src/components/ui/app-shell.tsx");

  it("declares a workspaceMode prop on AppShellProps", () => {
    assert.ok(
      SRC.includes("workspaceMode"),
      "AppShell must accept a workspaceMode prop for the trading-plan workspace layout",
    );
  });

  it("workspaceMode skips the white hero section", () => {
    assert.ok(
      SRC.includes("if (workspaceMode)"),
      "AppShell must branch on workspaceMode to skip the white rounded hero card",
    );
  });

  it("still has denseHero?: boolean (Phase A invariant preserved)", () => {
    assert.match(SRC, /denseHero\?:\s*boolean/, "AppShell must still have denseHero?: boolean");
  });
});

describe("rules page — Phase G workspace layout", () => {
  const SRC = readRepo("src/app/rules/page.tsx");

  it("uses GrShell as wrapper (Phase 2: replaced AppShell workspaceMode)", () => {
    // Phase 2 replaced AppShell (with its workspaceMode prop) with GrShell.
    assert.ok(
      SRC.includes("GrShell"),
      "rules page must use GrShell as wrapper (not AppShell with workspaceMode)",
    );
  });

  it("passes hideSidebar prop to GrShell (Phase 2: replaced denseHero/workspaceMode)", () => {
    // In GrShell, hideSidebar collapses the sidebar for the rule-editor mode,
    // replacing the old denseHero + workspaceMode AppShell props.
    assert.ok(SRC.includes("hideSidebar"), "rules page must pass hideSidebar to GrShell");
  });

  it("has WorkspaceHeader sub-component", () => {
    assert.ok(
      SRC.includes("WorkspaceHeader"),
      "rules page must render WorkspaceHeader to show account context in the workspace strip",
    );
  });

  it("left panel uses elevated warm bg (#f9f4ea)", () => {
    assert.ok(
      SRC.includes("#f9f4ea"),
      "workspace left panel must use the elevated warm surface bg (#f9f4ea) matching Claude Design bgElev token",
    );
  });

  it("GrShell uses var(--gr-bg) token for the page background (Phase 2: replaces #f3ece0 literal)", () => {
    // Phase 2: the warm canvas bg is now expressed as var(--gr-bg) in gr-shell.tsx.
    // The rules page itself no longer needs to set the canvas color.
    const shell = readRepo("src/components/ui/gr-shell.tsx");
    assert.ok(
      shell.includes("var(--gr-bg)"),
      "GrShell must use var(--gr-bg) for the warm canvas background",
    );
  });

  it("GrShell sidebar is 240px wide (Phase 2: sidebar moved into GrShell)", () => {
    // Phase 2: the 240px sidebar moved from the rules page aside into GrShell itself.
    const shell = readRepo("src/components/ui/gr-shell.tsx");
    assert.ok(
      shell.includes("240"),
      "GrShell must define the 240px sidebar width internally",
    );
  });
});

describe("RulesOverviewScreen — Phase G visual (updated for Phase I)", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("overview uses GR design tokens for type/surface colors", () => {
    // Phase I structural redesign moved the stats-strip from a warm-bg card to
    // an inline horizontal text strip. The bg-[#f9f4ea] selector is no longer
    // in this file; the overview now uses --gr-ink and --gr-text-mute tokens
    // alongside the workspace canvas which sits directly on #f3ece0 (page bg).
    assert.ok(
      SRC.includes("--gr-ink") || SRC.includes("--gr-text-mute"),
      "overview must reference GR design tokens (--gr-ink or --gr-text-mute)",
    );
  });
});
