/**
 * Trading Plan — inline-edit affordance regression tests.
 *
 * Locks in the production-polish pass that made core-rule editing feel direct:
 *  - No standalone bottom "Edit" / "Set value" action button on a core card.
 *  - The value row itself is the click target (value + small pencil icon),
 *    so clicking the number or the pencil enters edit mode.
 *  - Save / Cancel only appear while editing.
 *  - The "?" help button lives in the card header (top-right, next to the
 *    enforcement chip), not floating between the title and the value.
 *  - The account form's bottom page-level Save button is gated on page-level
 *    changes (it is not an always-on disabled control next to inline saves).
 *  - Server-side rule-edit lock copy is unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const OVERVIEW = read("rules-overview-screen.tsx");
const FORM = read("account-rules-form.tsx");

// ── Direct, value-driven editing ──────────────────────────────────────────────

describe("InlineRuleCard — value is the edit affordance", () => {
  it("the value row is a clickable button that enters edit mode", () => {
    assert.ok(
      OVERVIEW.includes("aria-label={`Edit ${rule.label}`}"),
      "the value row must be a labelled button ('Edit <rule>') so the value itself is clickable",
    );
    assert.ok(
      OVERVIEW.includes("onClick={startEdit}"),
      "clicking the value/pencil must call startEdit to enter inline edit mode",
    );
  });

  it("renders a small pencil icon next to the value (not a big bottom button)", () => {
    // A compact SVG pencil sits at the right edge of the value row.
    assert.ok(
      /<svg[\s\S]*?M11\.5 2\.5/.test(OVERVIEW),
      "the value row must include a small pencil SVG icon as the edit affordance",
    );
  });

  it("no standalone bottom 'Set value' / 'Edit' action button remains on the card", () => {
    // The old footer rendered `{isEmpty ? "Set value" : "Edit"}` as a button.
    assert.ok(
      !OVERVIEW.includes(`{isEmpty ? "Set value" : "Edit"}`),
      "the standalone bottom Edit/Set value button must be removed",
    );
    // Empty state now uses the value slot itself ("Set value" as the value text).
    assert.ok(
      OVERVIEW.includes(`{isEmpty ? "Set value" : display}`),
      "empty cards should show 'Set value' in the value slot, not a separate button",
    );
  });

  it("Save and Cancel only render while editing", () => {
    const editingIdx = OVERVIEW.indexOf("editing ? (");
    const saveIdx = OVERVIEW.indexOf('{saving ? "Saving…" : "Save"}');
    const cancelIdx = OVERVIEW.indexOf(">\n                Cancel");
    assert.ok(editingIdx !== -1, "InlineRuleCard must branch on `editing`");
    assert.ok(saveIdx > editingIdx, "Save button must live inside the editing branch");
    assert.ok(
      OVERVIEW.includes("onClick={cancel}"),
      "a Cancel action must exist while editing",
    );
    assert.ok(cancelIdx === -1 || cancelIdx > editingIdx, "Cancel must live inside the editing branch");
  });

  it("hover on the value row reveals a light border/background (editability cue)", () => {
    assert.ok(
      OVERVIEW.includes("hover:border-[color:var(--gr-border-hi)]") &&
        OVERVIEW.includes("hover:bg-[color:var(--gr-bg-elev)]"),
      "the value row must show a hover border + background to signal it is editable",
    );
  });
});

// ── Help button placement ─────────────────────────────────────────────────────

describe("InlineRuleCard — help button in the header, not the middle", () => {
  it("the '?' help button sits in the header next to the enforcement chip", () => {
    // The help button must appear in the same header block as GrEnforcementChip,
    // BEFORE the rule title <h3>, not between the title and the value.
    const helpIdx = OVERVIEW.indexOf("aria-label={`Help for ${rule.label}`}");
    const chipIdx = OVERVIEW.indexOf("<GrEnforcementChip variant={rule.status} />");
    const titleIdx = OVERVIEW.indexOf("{rule.label}\n      </h3>");
    assert.ok(helpIdx !== -1, "InlineRuleCard must render a help button");
    assert.ok(chipIdx !== -1, "InlineRuleCard must render the enforcement chip");
    assert.ok(titleIdx !== -1, "InlineRuleCard must render the rule title");
    assert.ok(
      helpIdx > chipIdx && helpIdx < titleIdx,
      "the help button must sit between the enforcement chip and the rule title (i.e. in the header)",
    );
  });

  it("clicking '?' still toggles inline help", () => {
    assert.ok(
      OVERVIEW.includes("onClick={() => setShowHelp((v) => !v)}"),
      "the help button must still toggle the inline help disclosure",
    );
    assert.ok(
      OVERVIEW.includes("{showHelp && ("),
      "inline help must render conditionally on showHelp",
    );
  });
});

// ── Bottom page-level Save button ─────────────────────────────────────────────

describe("AccountRulesForm — bottom Save gated on page-level changes", () => {
  it("computes hasPageLevelSave from dirty / first-time / consent", () => {
    assert.ok(
      FORM.includes("const hasPageLevelSave ="),
      "the form must compute hasPageLevelSave",
    );
    assert.ok(
      /hasPageLevelSave =\s*\n?\s*isDirty \|\| !hasExistingRules \|\| \(!hasValidConsent && consentChecked\)/.test(
        FORM,
      ),
      "hasPageLevelSave must be derived from isDirty / first-time create / freshly-checked consent",
    );
  });

  it("only renders the bottom submit button when there is a page-level save", () => {
    assert.ok(
      FORM.includes("{hasPageLevelSave && (() => {"),
      "the bottom Save button must be gated behind hasPageLevelSave",
    );
  });

  it("does not show a disabled 'No changes to save.' hint on the account form", () => {
    assert.ok(
      !FORM.includes("No changes to save."),
      "the account form must not show the disabled 'No changes to save.' hint",
    );
  });
});

// ── Server-side lock copy unchanged (safety) ──────────────────────────────────

describe("Inline edit preserves the server-side lock message", () => {
  it("the canonical session-already-traded copy is still surfaced inline", () => {
    assert.ok(
      OVERVIEW.includes(
        "You already started trading this account today. To protect your rules, changes will be available next trading day.",
      ),
      "the inline locked-card fallback must keep the canonical lock copy",
    );
  });
});
