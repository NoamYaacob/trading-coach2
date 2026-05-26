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

  it("uses workspaceMode on AppShell", () => {
    assert.ok(
      SRC.includes("workspaceMode"),
      "rules page must set workspaceMode on AppShell to enable flat workspace layout",
    );
  });

  it("denseHero still set (Phase A invariant)", () => {
    assert.ok(/\bdenseHero\b/.test(SRC), "rules page must still use denseHero");
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

  it("main workspace uses warm canvas bg (#f3ece0)", () => {
    assert.ok(
      SRC.includes("#f3ece0"),
      "main workspace must use warm cream canvas bg (#f3ece0) matching Claude Design bg token",
    );
  });

  it("left panel is 240px wide", () => {
    assert.ok(
      SRC.includes("w-[240px]"),
      "workspace left panel must be 240px wide matching Claude Design sidebar spec",
    );
  });
});

describe("RulesOverviewScreen — Phase G visual", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("stats strip uses warm elevated background", () => {
    assert.ok(
      SRC.includes("f9f4ea"),
      "stats strip must use the elevated warm bg (#f9f4ea) to match workspace visual hierarchy",
    );
  });
});
