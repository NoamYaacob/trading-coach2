/**
 * Trading Plan control-panel redesign — source-scan invariants.
 *
 * Phase A (PR #38): dense-hero, help-consolidation, contrast tweaks.
 * Phase B (PR #39): Core rules replaced by a 2-column card grid; six rules
 *   stay honest; secondary rows upgraded with value summaries.
 *
 * These tests lock in:
 *  - AppShell exposes a `denseHero` mode and the rules page uses it.
 *  - CoreRulesSection uses RuleCard / RuleCardGroup, not the old RuleRow list.
 *  - Three section groups: Money limits / Trading behavior / Position & symbols.
 *  - stopAfterLosses is labelled "Tilt protection" in the card.
 *  - All five rule field keys appear in the section source.
 *  - Status variants are honest: broker-eligible, monitoring-only, guardrail-lock,
 *    saved-eval-soon.
 *  - "About these rules" consolidated disclosure still present.
 *  - MaxPositionSizeConversionTable still hidden behind "View contract sizing".
 *  - MAX_POSITION_SIZE_COPY.hint still surfaces in the explanation.
 *  - Five collapsed advanced rows use border-stone-200 (contrast regression guard).
 *  - Locked-fieldset readability: no section-wide opacity dimming.
 *  - AccountRulesForm passes symbolLimits and disabled to CoreRulesSection.
 *  - Submit payload and validation are untouched.
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
    assert.match(
      SRC,
      /denseHero\s*\?\s*"p-2\.5/,
      "denseHero must shrink the hero section padding (expected p-2.5 ... branch)",
    );
  });

  it("denseHero shrinks the gap between hero and page body", () => {
    assert.match(
      SRC,
      /denseHero\s*\?\s*"gap-5"/,
      "denseHero must use gap-5 on the main element (default is gap-10)",
    );
  });
});

test("rules page: uses GrShell as wrapper (Phase 2: replaced AppShell + denseHero)", () => {
  // Phase 2 replaced AppShell (with its denseHero prop) with GrShell.
  // denseHero was an AppShell-only prop that is not present in GrShell.
  const src = readFileSync(resolve(REPO_ROOT, "src/app/rules/page.tsx"), "utf8");
  assert.ok(src.includes("GrShell"), "rules page must use GrShell as root wrapper");
  assert.ok(!src.includes("AppShell"), "rules page must not reference AppShell");
});

// ── CoreRulesSection — card grid layout ─────────────────────────────────────

describe("CoreRulesSection — card grid layout (not RuleRow list)", () => {
  const SRC = readRules("sections/core-rules-section.tsx");

  it("imports and uses RuleCard (new card primitive)", () => {
    assert.ok(
      SRC.includes("RuleCard"),
      "CoreRulesSection must use RuleCard components",
    );
  });

  it("does NOT use the old RuleRow list primitive", () => {
    assert.ok(
      !SRC.includes("RuleRow"),
      "CoreRulesSection must not use RuleRow — the old list layout has been replaced by RuleCard",
    );
  });

  it("renders the 'Money limits' section group", () => {
    assert.ok(SRC.includes("Money limits"), "must render the Money limits section heading");
  });

  it("renders the 'Trading behavior' section group", () => {
    assert.ok(SRC.includes("Trading behavior"), "must render the Trading behavior section heading");
  });

  it("renders the 'Position & symbols' section group", () => {
    assert.ok(
      SRC.includes("Position") && SRC.includes("symbols"),
      "must render the Position & symbols section heading",
    );
  });

  it("stopAfterLosses card is labelled 'Tilt protection'", () => {
    assert.ok(
      SRC.includes("Tilt protection"),
      "stopAfterLosses must be labelled Tilt protection in the card — field key is unchanged",
    );
  });

  it("all five rule field keys are referenced", () => {
    const keys = ["maxDailyLoss", "riskPerTrade", "maxTradesPerDay", "stopAfterLosses", "maxContracts"];
    for (const key of keys) {
      assert.ok(SRC.includes(key), `CoreRulesSection must reference field key: ${key}`);
    }
  });

  it("uses correct status variants for each rule", () => {
    assert.ok(SRC.includes("broker-eligible"), "daily loss must use broker-eligible");
    assert.ok(SRC.includes("monitoring-only"), "risk per trade must use monitoring-only");
    assert.ok(SRC.includes("guardrail-lock"), "trade limits must use guardrail-lock");
    assert.ok(SRC.includes("saved-eval-soon"), "per-symbol limits must use saved-eval-soon");
  });

  it("no RuleRow passes the `info` prop (per-row help disclosures removed)", () => {
    assert.ok(
      !/\binfo=\{/.test(SRC),
      "CoreRulesSection must not pass info={...} to any RuleRow",
    );
  });

  it("surfaces a single section-level 'About these rules' disclosure", () => {
    assert.ok(
      SRC.includes("About these rules"),
      "CoreRulesSection must include a single 'About these rules' disclosure",
    );
  });

  it("still references MAX_POSITION_SIZE_COPY.hint for the consolidated explanation", () => {
    assert.ok(
      SRC.includes("MAX_POSITION_SIZE_COPY.hint"),
      "the consolidated explanation list must surface MAX_POSITION_SIZE_COPY.hint",
    );
  });
});

// ── Conversion table hidden behind a trigger ─────────────────────────────────

describe("MaxPositionSizeConversionTable — hidden behind 'View contract sizing'", () => {
  const SRC = readRules("sections/core-rules-section.tsx");

  it("renders the table inside a <details> disclosure, not inline", () => {
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

// ── AccountRulesForm wires new CoreRulesSection props ────────────────────────

test("account form: passes symbolLimits and disabled to CoreRulesSection", () => {
  const src = readFileSync(resolve(RULES_ROOT, "account-rules-form.tsx"), "utf8");
  const coreIdx = src.indexOf("<CoreRulesSection");
  assert.ok(coreIdx !== -1, "AccountRulesForm must render <CoreRulesSection");
  // Extract the block from <CoreRulesSection up to <SymbolLimitsRow (the next sibling)
  const symRowIdx = src.indexOf("<SymbolLimitsRow", coreIdx);
  const block = src.slice(coreIdx, symRowIdx > coreIdx ? symRowIdx : coreIdx + 2000);
  assert.ok(
    block.includes("symbolLimits={values.symbolLimits}"),
    "CoreRulesSection must receive symbolLimits={values.symbolLimits}",
  );
  assert.ok(
    block.includes("disabled={fieldsDisabled}"),
    "CoreRulesSection must receive disabled={fieldsDisabled}",
  );
});

// ── Submit payload and validation untouched ───────────────────────────────────

test("submit payload and validateRules call are unchanged", () => {
  const src = readFileSync(resolve(RULES_ROOT, "account-rules-form.tsx"), "utf8");
  assert.ok(
    src.includes("maxDailyLoss: num(values.maxDailyLoss)"),
    "submit payload must include maxDailyLoss",
  );
  assert.ok(
    src.includes("riskPerTrade: num(values.riskPerTrade)"),
    "submit payload must include riskPerTrade",
  );
  assert.ok(
    src.includes("validateRules({"),
    "form must still call validateRules before submit",
  );
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
    const ariaIdx = src.search(
      /aria-label="(Contract limits by symbol|Session cutoff|Notifications|Advanced broker actions|Planned rules)"/,
    );
    assert.ok(
      ariaIdx !== -1,
      `${rel} must declare an aria-label so this assertion can find the row`,
    );
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
  // Look at the fieldset className — not just any occurrence of disabled={fieldsDisabled}
  const fieldsetIdx = src.indexOf("<fieldset");
  const fieldsetBlock = src.slice(fieldsetIdx, fieldsetIdx + 400);
  assert.ok(
    !fieldsetBlock.includes("opacity"),
    "fieldset disabled wrapper must not apply opacity classes — text must remain readable",
  );
  assert.ok(
    fieldsetBlock.includes("cursor-not-allowed"),
    "fieldset disabled wrapper must keep cursor-not-allowed to signal the lock",
  );
});
