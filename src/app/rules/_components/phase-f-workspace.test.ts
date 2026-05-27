/**
 * Phase F — Trading-plan workspace design-pass regression tests.
 *
 * Locks in:
 *  - rules-overview-screen: flat all-rules 3-col grid (no section headers when
 *    no group filter is active). Section headers appear only in filtered view.
 *  - page.tsx: SectionCard is NOT wrapping AccountRulesForm (flat workspace feel).
 *  - page.tsx: denseHero still set (Phase A invariant preserved).
 *  - All prior Phase D/E assertions still pass (see their respective test files).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const REPO_ROOT = resolve(ROOT, "../../../..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

// ── Flat all-rules grid ────────────────────────────────────────────────────────

describe("RulesOverviewScreen — Phase F flat grid", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("uses flatMap to render all rules in a single grid when no group filter is active", () => {
    assert.ok(
      SRC.includes("flatMap"),
      "overview must use flatMap to flatten all groups into one grid when activeGroup === null",
    );
  });

  it("flat grid still uses 3-column responsive layout", () => {
    assert.ok(
      SRC.includes("lg:grid-cols-3"),
      "all-rules flat grid must use lg:grid-cols-3 for desktop three-column layout",
    );
  });

  it("filtered view still renders section group headers", () => {
    assert.ok(
      SRC.includes("tracking-[0.22em]"),
      "filtered group view must still render a styled group header for context",
    );
  });

  it("activeGroup null check guards the flat vs grouped rendering", () => {
    assert.ok(
      SRC.includes("activeGroup === null"),
      "overview must branch on activeGroup === null to choose flat vs grouped rendering",
    );
  });
});

// ── Workspace layout (no SectionCard double-card) ─────────────────────────────

describe("rules page — Phase F workspace layout", () => {
  const SRC = readRepo("src/app/rules/page.tsx");

  it("does not import SectionCard (flat workspace, no double-card)", () => {
    // The SectionCard import line is removed — content sits flat on the canvas.
    assert.ok(
      !SRC.includes('from "@/components/ui/section-card"'),
      "rules page must not import SectionCard — account form content sits flat on the workspace canvas",
    );
  });

  it("uses GrShell as page wrapper (Phase 2: replaced AppShell + denseHero)", () => {
    // Phase 2 replaced AppShell (with its denseHero prop) with GrShell.
    // denseHero was an AppShell-specific prop that no longer applies.
    assert.ok(
      SRC.includes("GrShell"),
      "rules page must use GrShell as wrapper (not AppShell)",
    );
  });

  it("AccountRulesForm is wrapped in a plain div with min-w-0", () => {
    assert.ok(
      SRC.includes('className="min-w-0"'),
      "AccountRulesForm workspace container must use min-w-0 to prevent overflow in narrow grid column",
    );
  });
});
