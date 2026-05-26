/**
 * Phase H — Claude Design implementation regression tests.
 *
 * Locks in:
 *  - globals.css contains the GR design tokens (--gr-bg, --gr-copper,
 *    --gr-broker, --gr-lock, --gr-mon, --gr-saved, --gr-plan, etc.) from
 *    the handoff bundle's gr-tokens.jsx spec.
 *  - RuleCard uses the copper halo for hover/selected states (matches
 *    HANDOFF §4 "selected: copper border + box-shadow 0 0 0 4px var(--copper-bg)").
 *  - Filter chips show a rule-count badge per group (HANDOFF §7 overview).
 *  - AccountRulesForm has a sticky save-state banner when isDirty
 *    (HANDOFF §5 "unsaved" mode — copper banner replaces floating bottom bar).
 *  - Daily Loss editor uses broker (green) palette via design tokens.
 *  - Honesty: no fake rule names appear in the rules surface (Max Drawdown,
 *    Consistency Rule, News Blackout, Max Open Positions). Only the 9 real
 *    Guardrail rules.
 *  - Daily Loss is the only broker-backed eligible rule (the existing rule-meta
 *    invariant — re-asserted here as part of the Phase H contract).
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

// ── Design tokens in globals.css ──────────────────────────────────────────────

describe("globals.css — Phase H GR design tokens", () => {
  const SRC = readRepo("src/app/globals.css");

  it("defines --gr-bg warm cream paper token", () => {
    assert.ok(SRC.includes("--gr-bg: #f3ece0"), "globals.css must define --gr-bg: #f3ece0 (GR warm cream)");
  });

  it("defines --gr-bg-elev elevated surface token", () => {
    assert.ok(SRC.includes("--gr-bg-elev: #f9f4ea"), "globals.css must define --gr-bg-elev: #f9f4ea");
  });

  it("defines --gr-copper primary accent token", () => {
    assert.ok(SRC.includes("--gr-copper: #a23d10"), "globals.css must define --gr-copper: #a23d10");
  });

  it("defines --gr-copper-bg halo token (used by selected card halo)", () => {
    assert.ok(
      SRC.includes("--gr-copper-bg"),
      "globals.css must define --gr-copper-bg for the selected/hover halo",
    );
  });

  it("defines enforcement palette tokens (broker/lock/mon/saved/plan)", () => {
    for (const tok of ["--gr-broker", "--gr-lock", "--gr-mon", "--gr-saved", "--gr-plan"]) {
      assert.ok(SRC.includes(tok), `globals.css must define enforcement token ${tok}`);
    }
  });

  it("defines ink (warm charcoal, not pure black)", () => {
    assert.ok(SRC.includes("--gr-ink: #1b1812"), "globals.css must define --gr-ink: #1b1812 (warm charcoal)");
  });
});

// ── RuleCard copper halo (HANDOFF §4) ─────────────────────────────────────────

describe("RulesOverviewScreen — Phase H card states", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("card uses copper halo on hover (box-shadow halo from HANDOFF §4)", () => {
    assert.ok(
      SRC.includes("var(--gr-copper-bg)"),
      "RuleCard must use the copper-bg halo (box-shadow: 0 0 0 4px var(--gr-copper-bg)) on hover",
    );
  });

  it("card uses copper border on hover/focus (selected halo)", () => {
    assert.ok(
      SRC.includes("var(--gr-copper)"),
      "RuleCard must use the copper border on hover/focus",
    );
  });

  it("filter chips show a rule-count badge per group", () => {
    assert.ok(
      SRC.includes("rulesInGroup(g).length"),
      "filter chips must show a numeric count of rules per group",
    );
  });

  it("filter chips have aria-pressed for active state (a11y)", () => {
    assert.ok(
      SRC.includes("aria-pressed"),
      "filter chips must signal toggled state via aria-pressed",
    );
  });
});

// ── Sticky SaveStateBar in AccountRulesForm ───────────────────────────────────

describe("AccountRulesForm — Phase H sticky save-state banner", () => {
  const SRC = read("account-rules-form.tsx");

  it("renders a sticky save-state banner when isDirty (HANDOFF §5 unsaved)", () => {
    assert.ok(
      SRC.includes("data-save-state=\"unsaved\""),
      "form must render a copper-tinted sticky banner with data-save-state=unsaved when isDirty",
    );
  });

  it("save-state banner uses the GR copper background token", () => {
    assert.ok(
      SRC.includes("var(--gr-copper-bg)"),
      "save-state banner must use the GR copper-bg token to match the design",
    );
  });

  it("bottom save button uses GR copper color (not stone-950)", () => {
    assert.ok(
      SRC.includes("bg-[color:var(--gr-copper)]"),
      "save button must use the GR copper color (replaces previous stone-950)",
    );
    assert.ok(
      !SRC.includes("bg-stone-950 px-5 py-2.5"),
      "save button must not regress to bg-stone-950 (legacy black button)",
    );
  });
});

// ── Daily Loss editor uses GR broker palette ──────────────────────────────────

describe("DailyLossEditor — Phase H broker palette", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("broker-backed explainer uses GR broker tokens", () => {
    assert.ok(
      SRC.includes("var(--gr-broker)"),
      "broker-backed explainer must use the GR --gr-broker token (replaces emerald-200)",
    );
  });

  it("still renders the 'Broker-backed eligible' headline (honesty contract)", () => {
    assert.ok(
      SRC.includes("Broker-backed eligible"),
      "Daily Loss editor must keep the 'Broker-backed eligible' explainer headline",
    );
  });
});

// ── Honesty: no fake rules in rules surface ───────────────────────────────────

describe("Trading Plan — Phase H rule honesty (no invented rules)", () => {
  /**
   * The Claude Design mockup includes several rules that DO NOT exist in
   * Guardrail's backend. We must never present them as configurable in the
   * UI, even if the visual design shows them.
   *
   * Forbidden rule names (from the Claude Design that aren't real backend rules):
   *  - Max Drawdown
   *  - Consistency Rule
   *  - News Blackout
   *  - Max Open Positions
   *  - Daily Profit Target (as a rule label — exists only as the dashboard target)
   */
  // Rendering surfaces only — rule-meta.ts is intentionally excluded because
  // its top-of-file honesty comment lists the forbidden labels to document
  // what is NOT in the Guardrail rule set.
  const FILES = [
    "src/app/rules/_components/rules-overview-screen.tsx",
    "src/app/rules/_components/rules-rail.tsx",
    "src/app/rules/_components/rule-detail-pane.tsx",
    "src/app/rules/page.tsx",
  ];

  // The phrase may appear in tests, comments, or honesty footnotes elsewhere
  // — that's fine. We scan the rendering surfaces only.
  const FORBIDDEN_LABELS = [
    "Max Drawdown",
    "Consistency Rule",
    "News Blackout",
    "Max Open Positions",
  ];

  for (const rel of FILES) {
    it(`${rel} does not surface any invented rule labels`, () => {
      const src = readRepo(rel);
      for (const label of FORBIDDEN_LABELS) {
        assert.ok(
          !src.includes(label),
          `${rel} must not include forbidden rule label "${label}" — only real Guardrail rules`,
        );
      }
    });
  }
});

// ── Honesty: Daily Loss is the only broker-backed rule ────────────────────────

describe("Trading Plan — Phase H enforcement honesty", () => {
  it("rule-meta marks only daily-loss as broker-eligible", () => {
    const SRC = readRepo("src/app/rules/_components/rule-meta.ts");
    // Match the literal status assignment for the daily-loss rule.
    // We look for "broker-eligible" appearing in proximity to "daily-loss"
    // and not on any other rule id.
    const dailyLossIdx = SRC.indexOf('id: "daily-loss"');
    assert.ok(dailyLossIdx !== -1, "rule-meta must declare the daily-loss rule");
    const dailyLossBlock = SRC.slice(dailyLossIdx, dailyLossIdx + 600);
    assert.ok(
      dailyLossBlock.includes("broker-eligible"),
      "daily-loss must be marked broker-eligible in rule-meta",
    );
  });

  it("rule-meta does not mark any non-daily-loss rule as broker-eligible", () => {
    const SRC = readRepo("src/app/rules/_components/rule-meta.ts");
    // Count occurrences of "broker-eligible"; the only acceptable use is on daily-loss.
    // We allow it to appear up to 2 times (type union + the one assignment).
    const occurrences = (SRC.match(/broker-eligible/g) ?? []).length;
    assert.ok(
      occurrences <= 2,
      `broker-eligible must only appear in the type union and once on daily-loss (got ${occurrences} occurrences)`,
    );
  });

  it("rule-meta keeps advanced broker actions in planned-broker status", () => {
    const SRC = readRepo("src/app/rules/_components/rule-meta.ts");
    const advIdx = SRC.indexOf('id: "advanced-broker-actions"');
    assert.ok(advIdx !== -1, "rule-meta must declare advanced-broker-actions");
    const block = SRC.slice(advIdx, advIdx + 600);
    assert.ok(
      block.includes("planned-broker"),
      "advanced-broker-actions must remain status planned-broker (not active)",
    );
  });
});

// ── Honesty: no forbidden phrasing on the rules surface ───────────────────────

describe("Trading Plan — Phase H forbidden phrasing (HANDOFF §11)", () => {
  /**
   * The HANDOFF explicitly forbids language that claims Guardrail can act
   * inside the broker today. These phrases may only appear inside a
   * "Planned · not active" disclosure.
   *
   * We scan the OVERVIEW + RAIL surfaces, which must never use these as
   * present-tense actions. The Daily Loss editor's PLANNED block is allowed
   * to contain them (it explicitly labels them as Planned · not active).
   */
  const FILES = [
    "src/app/rules/_components/rules-overview-screen.tsx",
    "src/app/rules/_components/rules-rail.tsx",
  ];
  const FORBIDDEN = [
    "Cancel all open orders",
    "Lock account at broker",
  ];

  for (const rel of FILES) {
    it(`${rel} does not use forbidden present-tense broker-action phrasing`, () => {
      const src = readRepo(rel);
      for (const phrase of FORBIDDEN) {
        assert.ok(
          !src.includes(phrase),
          `${rel} must not include forbidden phrase "${phrase}" outside Planned · not active context`,
        );
      }
    });
  }
});
