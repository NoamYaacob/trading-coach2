/**
 * Phase J — Claude Design visual contract regression tests.
 *
 * Locks in the visual upgrades from Phase J:
 *  - Editorial serif headline ("Your guardrails, watching every tick.")
 *  - Copper underline halo on the headline keyword
 *  - Daily Loss editor uses editorial serif for h2
 *  - AppShell workspaceMode has paper-grain background texture
 *  - Honesty contract preserved
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

describe("Phase J — editorial hero headline", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("renders the 'watching every tick' headline", () => {
    assert.ok(
      SRC.includes("watching every tick"),
      "overview must render the editorial headline 'Your guardrails, watching every tick.'",
    );
  });

  it("headline uses Instrument Serif with system fallback", () => {
    assert.ok(
      SRC.includes("Instrument Serif"),
      "headline must declare Instrument Serif (with safe local fallback) for the editorial feel",
    );
  });

  it("headline keyword has a copper underline halo", () => {
    assert.ok(
      SRC.includes("var(--gr-copper-bg)"),
      "headline keyword must have a copper-bg underline halo",
    );
  });

  it("headline subtitle states the honest broker-backed truth", () => {
    assert.ok(
      SRC.includes("Daily Loss is the only broker-backed rule"),
      "headline subtitle must state the honest broker-backed enforcement claim",
    );
  });
});

describe("Phase J — Daily Loss editor serif", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("editor h2 uses Instrument Serif", () => {
    assert.ok(
      SRC.includes("Instrument Serif"),
      "Daily Loss editor h2 must use Instrument Serif for the editorial title",
    );
  });
});

describe("Phase J — paper-grain background", () => {
  const SRC = readRepo("src/components/ui/app-shell.tsx");

  it("workspaceMode includes a paper-grain radial-gradient", () => {
    const idx = SRC.indexOf("if (workspaceMode)");
    const end = SRC.indexOf("\n  return (", idx);
    const block = SRC.slice(idx, end);
    assert.ok(
      block.includes("radial-gradient"),
      "workspaceMode must include the paper-grain radial-gradient texture",
    );
    assert.ok(
      block.includes("rgba(180,160,120"),
      "paper-grain must use the warm (180,160,120) tone from the design",
    );
  });
});

describe("Phase J — honesty contract still holds", () => {
  it("no fake rules introduced on rendering surfaces", () => {
    const overview = read("rules-overview-screen.tsx");
    for (const fake of ["Max Drawdown", "Consistency Rule", "News Blackout", "Max Open Positions"]) {
      assert.ok(!overview.includes(fake), `overview must not surface fake rule "${fake}"`);
    }
  });

  it("no fake live metrics in overview hero/summary", () => {
    const overview = read("rules-overview-screen.tsx");
    for (const fake of ["Today P&L", "Compliance %", "Recent triggers"]) {
      assert.ok(!overview.includes(fake), `overview must not surface fake metric "${fake}"`);
    }
  });
});
