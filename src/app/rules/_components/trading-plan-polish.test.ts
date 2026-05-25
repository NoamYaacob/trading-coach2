/**
 * Trading Plan polish pass — source-scan invariants for the dense-hero /
 * help-consolidation / contrast tweaks made after PR #37.
 *
 * These tests lock in:
 *  - AppShell exposes a `denseHero` mode and the rules page uses it.
 *  - The Core rules card no longer wires per-row info disclosures (the "?"
 *    circles are gone) and instead surfaces explanations via a single
 *    "About these rules" section-level disclosure.
 *  - The MaxPositionSizeConversionTable lives behind a "View contract sizing"
 *    expander rather than rendering inline.
 *  - The five collapsed advanced rows use the higher-contrast border-stone-200
 *    border style introduced in this pass.
 *  - The locked-fieldset readability invariant from PR #35 still holds — no
 *    section-wide opacity dimming.
 */
import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RULES_ROOT = resolve(import.meta.dirname);
const REPO_ROOT = resolve(RULES_ROOT, "../../../..");

function readRules(rel: string): string {
  return readFileSync(resolve(RULES_ROOT, rel), "utf8");
}

// ── AppShell dense hero ──────────────────────────────────────────────────────

describe("AppShell — denseHero mode", () => {
  const SRC = readFileSync(resolve(REPO_ROOT, "src/components/ui/app-shell.tsx"), "utf8");

  it("declares a denseHero prop on AppShellProps", () => {
    assert.match(
      SRC,
      /denseHero\?:\s*boolean/,
      "AppShell must accept a `denseHero?: boolean` prop",
    );
  });

  it("denseHero applies smaller hero padding than the default", () => {
    // The dense variant shrinks the hero section's padding so the page body
    // reaches the top of the viewport faster.
    assert.match(
      SRC,
      /denseHero\s*\?\s*"p-2\.5/,
      "denseHero must shrink the hero section padding (expected p-2.5 ... branch)",
    );
  });

  it("denseHero shrinks the gap between hero and page body", () => {
    // The default main gap is gap-10 — denseHero must use gap-5 so the rules
    // editor sits closer to the hero.
    assert.match(
      SRC,
      /denseHero\s*\?\s*"gap-5"/,
      "denseHero must use gap-5 on the main element (default is gap-10)",
    );
  });
});

test("rules page: uses denseHero on the AppShell", () => {
  const src = readFileSync(resolve(REPO_ROOT, "src/app/rules/page.tsx"), "utf8");
  assert.match(src, /\bdenseHero\b/, "rules page must opt into the AppShell's denseHero mode");
  assert.ok(
    !/compactHero\s*$/m.test(src),
    "rules page must not also set the looser compactHero prop",
  );
});

// ── CoreRulesSection — no per-row "?" disclosures ────────────────────────────

describe("CoreRulesSection — help is centralised, not per-row", () => {
  const SRC = readRules("sections/core-rules-section.tsx");

  it("no RuleRow passes the `info` prop (per-row help disclosures removed)", () => {
    assert.ok(
      !/\binfo=\{/.test(SRC),
      "CoreRulesSection must not pass info={...} to any RuleRow — per-row '?' buttons were removed",
    );
  });

  it("surfaces a single section-level 'About these rules' disclosure", () => {
    assert.ok(
      SRC.includes("About these rules"),
      "CoreRulesSection must include a single 'About these rules' disclosure summarising all rules",
    );
  });

  it("still references MAX_POSITION_SIZE_COPY for the consolidated explanation", () => {
    assert.ok(
      SRC.includes("MAX_POSITION_SIZE_COPY.hint"),
      "the consolidated explanation list must surface the standard-equivalent hint",
    );
  });
});

// ── Conversion table hidden behind a trigger ─────────────────────────────────

describe("MaxPositionSizeConversionTable — hidden behind 'View contract sizing'", () => {
  const SRC = readRules("sections/core-rules-section.tsx");

  it("renders the table inside a <details> disclosure, not inline", () => {
    // The previous version rendered <MaxPositionSizeConversionTable .../>
    // directly under the row grid. The polish pass tucks it behind a
    // collapsed trigger so the always-visible card stays compact.
    const tableIdx = SRC.indexOf("<MaxPositionSizeConversionTable");
    assert.ok(tableIdx !== -1, "CoreRulesSection must still render the conversion table");
    const preceding = SRC.slice(0, tableIdx);
    const lastDetails = preceding.lastIndexOf("<details");
    const lastSectionCardClose = preceding.lastIndexOf("</SectionCard>");
    assert.ok(
      lastDetails > lastSectionCardClose,
      "MaxPositionSizeConversionTable must sit inside a <details> wrapper (not rendered inline)",
    );
  });

  it("uses a 'View contract sizing' summary on the trigger", () => {
    assert.ok(
      SRC.includes("View contract sizing"),
      "the conversion table trigger must say 'View contract sizing'",
    );
  });
});

// ── Higher-contrast collapsed accordion rows ─────────────────────────────────

const COLLAPSED_ROW_FILES = [
  "sections/symbol-limits-row.tsx",
  "sections/session-cutoff-section.tsx",
  "sections/notifications-section.tsx",
  "sections/advanced-broker-actions-section.tsx",
  "sections/planned-rules-section.tsx",
] as const;

for (const rel of COLLAPSED_ROW_FILES) {
  test(`${rel}: uses higher-contrast border-stone-200 border`, () => {
    const src = readRules(rel);
    // The collapsed-row wrapper sits BEFORE the aria-label attribute we use
    // to identify it. Tightening the regex to the same line as aria-label
    // would miss the class definition, which lives on the line before.
    const ariaIdx = src.search(/aria-label="(Contract limits by symbol|Session cutoff|Notifications|Advanced broker actions|Planned rules)"/);
    assert.ok(ariaIdx !== -1, `${rel} must declare an aria-label so this assertion can find the row`);
    const block = src.slice(Math.max(0, ariaIdx - 240), ariaIdx);
    assert.ok(
      block.includes("border-stone-200"),
      `${rel} collapsed wrapper must use border-stone-200 for stronger contrast`,
    );
    assert.ok(
      !block.includes("border-stone-100"),
      `${rel} collapsed wrapper must not regress to border-stone-100 (too washed out)`,
    );
  });
}

// ── Locked-fieldset readability still preserved ──────────────────────────────

test("account form: locked fieldset still avoids section-wide opacity (regression guard)", () => {
  const src = readFileSync(resolve(RULES_ROOT, "account-rules-form.tsx"), "utf8");
  const idx = src.indexOf("disabled={fieldsDisabled}");
  assert.ok(idx !== -1, "form must still propagate fieldsDisabled through the fieldset");
  const block = src.slice(idx, idx + 400);
  assert.ok(
    !block.includes("opacity"),
    "fieldset disabled wrapper must not apply opacity classes — text must remain readable",
  );
  assert.ok(
    block.includes("cursor-not-allowed"),
    "fieldset disabled wrapper must keep cursor-not-allowed to signal the lock",
  );
});
