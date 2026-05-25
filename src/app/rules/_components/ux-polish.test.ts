/**
 * UX polish regression tests — PR #35 pass.
 *
 * 1. Compact badge text on Trading Plan section cards:
 *    - Each section file uses the `compact` prop on RuleStatusBadge so only the
 *      short label is rendered in-form (e.g. "Lock" not "Guardrail lock").
 *    - HowEnforcementWorks still uses the full canonical labels — it is the
 *      authoritative disclosure surface.
 *
 * 2. Symbol limits empty state:
 *    - position-symbol-section hides the select/input/Add-limit controls by
 *      default when no limits exist (shows "+ Add symbol limit" trigger instead).
 *    - Once showSymbolEditor is true the full SymbolLimitsTable is rendered.
 *    - The SymbolLimitsTable is always reachable (not removed from source).
 *
 * 3. Locked fieldset readability:
 *    - account-rules-form fieldset does NOT apply section-wide opacity —
 *      already verified in account-rules-form-copy.test.ts; asserted here
 *      independently against the section-card wrapper too.
 *
 * 4. Compact label map completeness:
 *    - RULE_STATUS_LABEL_COMPACT covers all six variants.
 */
import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  RULE_STATUS_LABEL_COMPACT,
  RULE_STATUS_LABEL,
} from "./rule-status-badge-helpers.ts";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Compact badge map completeness ───────────────────────────────────────────

describe("RULE_STATUS_LABEL_COMPACT — compact label map", () => {
  it("covers all six variants", () => {
    const fullKeys = Object.keys(RULE_STATUS_LABEL);
    const compactKeys = Object.keys(RULE_STATUS_LABEL_COMPACT);
    assert.deepEqual(
      compactKeys.sort(),
      fullKeys.sort(),
      "compact map must have an entry for every canonical variant",
    );
  });

  it("broker-eligible compact label is 'Broker'", () => {
    assert.equal(RULE_STATUS_LABEL_COMPACT["broker-eligible"], "Broker");
  });

  it("guardrail-lock compact label is 'Lock'", () => {
    assert.equal(RULE_STATUS_LABEL_COMPACT["guardrail-lock"], "Lock");
  });

  it("monitoring-only compact label is 'Monitor'", () => {
    assert.equal(RULE_STATUS_LABEL_COMPACT["monitoring-only"], "Monitor");
  });

  it("saved-eval-soon compact label is 'Saved'", () => {
    assert.equal(RULE_STATUS_LABEL_COMPACT["saved-eval-soon"], "Saved");
  });

  it("planned-broker compact label is 'Planned'", () => {
    assert.equal(RULE_STATUS_LABEL_COMPACT["planned-broker"], "Planned");
  });

  it("compact labels are shorter than (or equal length to) full labels", () => {
    for (const [variant, full] of Object.entries(RULE_STATUS_LABEL)) {
      const compact = RULE_STATUS_LABEL_COMPACT[variant as keyof typeof RULE_STATUS_LABEL_COMPACT];
      assert.ok(
        compact.length <= full.length,
        `compact label for "${variant}" ('${compact}') must be ≤ full label ('${full}') in length`,
      );
    }
  });
});

// ── RuleStatusBadge component accepts compact prop ───────────────────────────

test("rule-status-badge: RuleStatusBadge accepts compact prop and uses RULE_STATUS_LABEL_COMPACT", () => {
  const src = read("rule-status-badge.tsx");
  assert.ok(
    src.includes("compact"),
    "RuleStatusBadge must have a compact prop",
  );
  assert.ok(
    src.includes("RULE_STATUS_LABEL_COMPACT"),
    "RuleStatusBadge must reference RULE_STATUS_LABEL_COMPACT when compact=true",
  );
});

// ── Section files use compact badges ─────────────────────────────────────────

const SECTION_FILES: Array<[string, string]> = [
  // After PR #37 the form composes:
  //   Core rules  ← absorbs Money limits, Trading behavior, Position-symbol's maxContracts
  //   Symbol limits row (collapsed) ← absorbs the per-symbol cap table
  //   Session cutoff row (collapsed)
  ["core-rules-section", "sections/core-rules-section.tsx"],
  ["symbol-limits-row", "sections/symbol-limits-row.tsx"],
  ["session-cutoff-section", "sections/session-cutoff-section.tsx"],
];

for (const [name, rel] of SECTION_FILES) {
  test(`${name}: renders compact-label status indicators`, () => {
    const src = read(rel);
    // Each file must either pass `compact` to RuleStatusBadge directly, or
    // pass a status variant to a RuleRow (which forwards compact internally).
    const usesCompactBadge =
      src.includes("RuleStatusBadge") && src.includes("compact");
    const usesRuleRowStatus = src.includes("RuleRow") && /\bstatus=/.test(src);
    assert.ok(
      usesCompactBadge || usesRuleRowStatus,
      `${name} must render status via compact RuleStatusBadge or RuleRow status prop`,
    );
  });
}

// ── HowEnforcementWorks keeps full labels ─────────────────────────────────────

test("how-enforcement-works: still has full canonical labels (not compact)", () => {
  const src = read("how-enforcement-works.tsx");
  for (const full of [
    "Broker-backed eligible",
    "Guardrail lock",
    "Monitoring only",
    "Saved · Evaluation coming soon",
    "Planned broker action",
  ]) {
    assert.ok(
      src.includes(full),
      `how-enforcement-works must still contain full label "${full}"`,
    );
  }
  assert.ok(
    !src.includes("compact"),
    "how-enforcement-works must NOT use compact badges — it is the full-disclosure surface",
  );
});

// ── symbol-limits-row: collapsed by default, empty state hides add-form ──────

test("symbol-limits-row: has symbolEditorOpen state for empty-state gate", () => {
  const src = read("sections/symbol-limits-row.tsx");
  assert.ok(
    src.includes("symbolEditorOpen"),
    "row must have local state controlling when the symbol editor is visible",
  );
  assert.ok(
    src.includes("useState"),
    "row must use useState to track editor visibility",
  );
});

test("symbol-limits-row: empty state shows '+ Add symbol limit' trigger", () => {
  const src = read("sections/symbol-limits-row.tsx");
  assert.ok(
    src.includes("Add symbol limit"),
    "empty state must have an 'Add symbol limit' call-to-action",
  );
});

test("symbol-limits-row: SymbolLimitsTable is still present in editor branch", () => {
  const src = read("sections/symbol-limits-row.tsx");
  assert.ok(
    src.includes("<SymbolLimitsTable"),
    "SymbolLimitsTable must remain in the editor branch (only hidden behind empty-state gate)",
  );
  assert.ok(
    src.includes("disabled={disabled}"),
    "SymbolLimitsTable must still honor disabled={disabled}",
  );
});

test("symbol-limits-row: empty state does NOT render select or limit input by default", () => {
  const src = read("sections/symbol-limits-row.tsx");
  assert.ok(
    src.includes("symbolEditorOpen || value.length > 0"),
    "showEditor gate must be: symbolEditorOpen || has existing rows",
  );
});

test("symbol-limits-row: is a client component (needs useState)", () => {
  const src = read("sections/symbol-limits-row.tsx");
  assert.ok(
    src.includes('"use client"'),
    "symbol-limits-row must be a client component to use useState",
  );
});

// ── Locked fieldset: no section-wide opacity ─────────────────────────────────

test("account-rules-form: SectionCard wrapper does not apply opacity to locked sections", () => {
  const sectionCard = read("sections/field-primitives.tsx");
  assert.ok(
    !sectionCard.includes("opacity-50") && !sectionCard.includes("opacity-40"),
    "SectionCard must not apply opacity — disabled state is input-level only",
  );
});

test("account-rules-form: fieldset disabled without opacity (text stays readable)", () => {
  const src = readFileSync(resolve(ROOT, "account-rules-form.tsx"), "utf8");
  const idx = src.indexOf("disabled={fieldsDisabled}");
  assert.ok(idx !== -1, "fieldset must have disabled={fieldsDisabled}");
  const block = src.slice(idx, idx + 400);
  assert.ok(
    !block.includes("opacity"),
    "fieldset must not apply any opacity class when disabled — labels and badges stay readable",
  );
});
