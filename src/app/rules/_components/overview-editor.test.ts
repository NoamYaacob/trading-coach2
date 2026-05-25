/**
 * Overview ↔ selected-rule-editor regression tests — PR #41.
 *
 * Locks in:
 *  - rule-meta.ts has exactly the 9 real Guardrail rules, no placeholders.
 *  - 6 categories: Capital, Discipline, Sizing, Schedule, Alerts, Enforcement.
 *  - RulesOverviewScreen renders RuleStatusBadge and groups by category.
 *  - RuleDetailPane wires the right editor per rule id.
 *  - DailyLossEditor uses the broker-eligible chip + mentions Tradovate.
 *  - SimpleRuleEditor surfaces honest enforcement status from rule-meta.
 *  - AccountRulesForm orchestrates overview/editor via selectedRuleId state.
 *  - No fake/placeholder rule names appear (Max Drawdown, Consistency, etc).
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  RULES,
  RULE_GROUPS,
  ruleDisplayValue,
  rulesInGroup,
  getRuleMeta,
  type RuleId,
} from "./rule-meta.ts";

const ROOT = resolve(import.meta.dirname);

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Rule metadata invariants ─────────────────────────────────────────────────

describe("rule-meta — canonical rule list", () => {
  it("contains exactly 9 real Guardrail rules", () => {
    assert.equal(RULES.length, 9, "RULES must list 9 real rules — no more, no less");
  });

  it("contains exactly the expected rule ids", () => {
    const expected: RuleId[] = [
      "daily-loss",
      "risk-per-trade",
      "max-trades-per-day",
      "tilt-protection",
      "max-contracts",
      "per-symbol-limits",
      "session-cutoff",
      "notifications",
      "advanced-broker-actions",
    ];
    assert.deepEqual(
      RULES.map((r) => r.id).sort(),
      expected.sort(),
      "RULES ids must match the canonical real-product list",
    );
  });

  it("declares exactly 6 categories", () => {
    assert.deepEqual(
      [...RULE_GROUPS],
      ["Capital", "Discipline", "Sizing", "Schedule", "Alerts", "Enforcement"],
      "RULE_GROUPS must be Capital/Discipline/Sizing/Schedule/Alerts/Enforcement",
    );
  });

  it("daily-loss is the only broker-eligible rule", () => {
    const eligible = RULES.filter((r) => r.status === "broker-eligible");
    assert.equal(eligible.length, 1, "exactly one rule may be broker-eligible");
    assert.equal(eligible[0]!.id, "daily-loss");
  });

  it("max-trades-per-day, tilt-protection, max-contracts are guardrail-lock", () => {
    const lockIds = RULES.filter((r) => r.status === "guardrail-lock").map((r) => r.id).sort();
    assert.deepEqual(
      lockIds,
      ["max-contracts", "max-trades-per-day", "tilt-protection"],
      "only those three rules create internal locks today",
    );
  });

  it("advanced-broker-actions is planned-broker (not active)", () => {
    assert.equal(getRuleMeta("advanced-broker-actions").status, "planned-broker");
  });

  it("notifications has saved-eval-soon status and is not editable", () => {
    const n = getRuleMeta("notifications");
    assert.equal(n.status, "saved-eval-soon");
    assert.equal(n.editable, false);
  });

  it("every group contains at least one rule", () => {
    for (const g of RULE_GROUPS) {
      assert.ok(rulesInGroup(g).length > 0, `group ${g} must contain at least one rule`);
    }
  });
});

// ── Honesty: no fake rules ───────────────────────────────────────────────────

describe("rule-meta — honesty / no fake rules", () => {
  // Names that the user explicitly called out as fake/placeholder names from
  // the design canvas that must not be surfaced unless implemented for real.
  const BANNED_LABELS = [
    "Max Drawdown",
    "Consistency Rule",
    "News Blackout",
    "Max Open Positions",
  ];

  it("RULES contains no banned/fake rule labels", () => {
    for (const banned of BANNED_LABELS) {
      assert.ok(
        !RULES.some((r) => r.label === banned),
        `rule-meta must not surface fake rule label '${banned}' — only real Guardrail rules`,
      );
    }
  });

  it("rules-overview-screen.tsx source contains no banned labels", () => {
    const src = read("rules-overview-screen.tsx");
    for (const banned of BANNED_LABELS) {
      assert.ok(
        !src.includes(banned),
        `rules-overview-screen.tsx must not surface fake rule label '${banned}'`,
      );
    }
  });
});

// ── Display value helpers ────────────────────────────────────────────────────

describe("ruleDisplayValue — value formatting", () => {
  const baseValues = {
    maxDailyLoss: "",
    riskPerTrade: "",
    maxTradesPerDay: "",
    stopAfterLosses: "",
    maxContracts: "",
    symbolLimits: [],
    allowedEndHour: "",
  };

  it("formats daily-loss as USD with thousands separators", () => {
    assert.equal(
      ruleDisplayValue("daily-loss", { ...baseValues, maxDailyLoss: "1200" }),
      "$1,200",
    );
  });

  it("returns empty string for unset values", () => {
    assert.equal(ruleDisplayValue("daily-loss", baseValues), "");
    assert.equal(ruleDisplayValue("max-trades-per-day", baseValues), "");
  });

  it("formats session-cutoff as 'Stops at HH:00 CME'", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...baseValues, allowedEndHour: "15" }),
      "Stops at 15:00 CME",
    );
  });

  it("formats per-symbol-limits as a dot-separated list", () => {
    const result = ruleDisplayValue("per-symbol-limits", {
      ...baseValues,
      symbolLimits: [
        { symbol: "es", maxContracts: "2" },
        { symbol: "nq", maxContracts: "1" },
      ],
    });
    assert.equal(result, "ES ≤ 2 · NQ ≤ 1");
  });

  it("notifications and advanced-broker-actions always return a static label", () => {
    assert.ok(ruleDisplayValue("notifications", baseValues).length > 0);
    assert.ok(ruleDisplayValue("advanced-broker-actions", baseValues).length > 0);
  });
});

// ── RulesOverviewScreen structure ────────────────────────────────────────────

describe("RulesOverviewScreen — overview screen structure", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("renders RuleStatusBadge for each card", () => {
    assert.ok(SRC.includes("RuleStatusBadge"), "overview must render enforcement chips on cards");
  });

  it("groups rules by RULE_GROUPS (Capital, Discipline, etc.)", () => {
    assert.ok(SRC.includes("RULE_GROUPS"), "overview must iterate over RULE_GROUPS");
  });

  it("uses rulesInGroup helper to filter per category", () => {
    assert.ok(SRC.includes("rulesInGroup"), "overview must use rulesInGroup helper");
  });

  it("each card is a clickable button (onSelect handler)", () => {
    assert.ok(SRC.includes("onSelect"), "overview cards must accept an onSelect handler");
    assert.ok(/<button\b/.test(SRC), "overview cards must be buttons for keyboard access");
  });

  it("renders helper copy for empty-value cards", () => {
    assert.ok(SRC.includes("Not set"), "overview must show 'Not set' placeholder for empty values");
  });

  it("exposes aria-label='Rules overview' on the outer group", () => {
    assert.ok(
      SRC.includes('aria-label="Rules overview"'),
      "outer group must have aria-label for screen readers",
    );
  });
});

// ── RuleDetailPane and editors ───────────────────────────────────────────────

describe("RuleDetailPane — sidebar rail + editor", () => {
  const SRC = read("rule-detail-pane.tsx");

  it("renders RulesRail on the left", () => {
    assert.ok(SRC.includes("RulesRail"), "detail pane must render the rules rail sidebar");
  });

  it("renders the right editor based on selectedId", () => {
    assert.ok(SRC.includes("DailyLossEditor"), "detail pane must route daily-loss to DailyLossEditor");
    assert.ok(SRC.includes("SimpleRuleEditor"), "detail pane must route other rules to SimpleRuleEditor");
  });

  it("supports an onBackToOverview callback", () => {
    assert.ok(SRC.includes("onBackToOverview"), "detail pane must expose a back-to-overview action");
  });

  it("uses a 2-column layout (rail + editor)", () => {
    assert.ok(
      /lg:grid-cols-\[260px_minmax\(0,1fr\)\]/.test(SRC),
      "detail pane must use the 260px rail + flex editor layout",
    );
  });

  it("switches on every rule id (exhaustive)", () => {
    for (const id of RULES.map((r) => r.id)) {
      assert.ok(
        SRC.includes(`case "${id}":`),
        `EditorSwitch must handle case "${id}" so every rule has an editor`,
      );
    }
  });
});

describe("DailyLossEditor — premium broker-backed editor", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("uses the broker-eligible enforcement chip", () => {
    assert.ok(
      SRC.includes('variant="broker-eligible"'),
      "Daily Loss editor must use the broker-eligible chip — it is the only broker-backed rule",
    );
  });

  it("references Tradovate as the broker", () => {
    assert.ok(
      SRC.includes("Tradovate"),
      "Daily Loss editor must name Tradovate — the only broker that can back this rule today",
    );
  });

  it("describes the broker-backed enforcement honestly (off by default / opt-in)", () => {
    assert.ok(
      SRC.includes("Opt-in") || SRC.includes("opt-in"),
      "Daily Loss editor must mention opt-in for broker-side enforcement",
    );
  });

  it("does NOT trigger any broker-side action (no liquidate / cancel / flatten)", () => {
    for (const banned of ["liquidate(", "cancelOrder(", "flattenPosition(", "sendOrder("]) {
      assert.ok(
        !SRC.includes(banned),
        `Daily Loss editor must not call broker action '${banned}'`,
      );
    }
  });

  it("planned actions section uses RuleStatusBadge variant='planned-broker'", () => {
    assert.ok(
      SRC.includes('variant="planned-broker"'),
      "Daily Loss editor must label planned broker actions with the planned-broker chip",
    );
  });
});

describe("SimpleRuleEditor — display + edit shell", () => {
  const SRC = read("editors/simple-rule-editor.tsx");

  it("uses RuleStatusBadge from the canonical helpers", () => {
    assert.ok(
      SRC.includes("RuleStatusBadge"),
      "SimpleRuleEditor must render the enforcement chip",
    );
  });

  it("uses canonical rule metadata via getRuleMeta()", () => {
    assert.ok(
      SRC.includes("getRuleMeta"),
      "SimpleRuleEditor must read label/group/status from rule-meta (no inline copies)",
    );
  });
});

// ── AccountRulesForm orchestration ───────────────────────────────────────────

describe("AccountRulesForm — overview/editor orchestration (PR #41)", () => {
  const SRC = read("account-rules-form.tsx");

  it("imports RulesOverviewScreen and RuleDetailPane", () => {
    assert.ok(SRC.includes("RulesOverviewScreen"));
    assert.ok(SRC.includes("RuleDetailPane"));
  });

  it("tracks selectedRuleId state", () => {
    assert.ok(
      SRC.includes("selectedRuleId"),
      "AccountRulesForm must own selectedRuleId state to toggle overview ↔ editor",
    );
    assert.ok(
      SRC.includes("setSelectedRuleId"),
      "AccountRulesForm must expose a setter",
    );
  });

  it("preserves single-form submit handler (handleSubmit)", () => {
    assert.ok(
      SRC.includes("handleSubmit"),
      "AccountRulesForm must keep its single handleSubmit — no per-rule save",
    );
    assert.ok(
      SRC.includes("validateRules"),
      "AccountRulesForm must keep cross-field validation via validateRules",
    );
  });

  it("submit payload still includes every existing field", () => {
    for (const key of [
      "maxDailyLoss: num",
      "riskPerTrade: num",
      "maxTradesPerDay: int",
      "stopAfterLosses: int",
      "maxContracts: int",
      "rawBrokerHardLimitEnabled:",
      "maxContractsBySymbolJson:",
    ]) {
      assert.ok(
        SRC.includes(key),
        `submit payload must still include '${key}' — PR #41 is UI-only`,
      );
    }
  });
});

// ── Safety: no broker write paths added by new code ──────────────────────────

describe("PR #41 safety — no broker writes / server-only modules", () => {
  const NEW_FILES = [
    "rule-meta.ts",
    "rules-overview-screen.tsx",
    "rule-detail-pane.tsx",
    "rules-rail.tsx",
    "editors/daily-loss-editor.tsx",
    "editors/simple-rule-editor.tsx",
  ];

  for (const rel of NEW_FILES) {
    test(`${rel}: imports no Tradovate / prisma / server-action / API code`, () => {
      const src = read(rel);
      for (const banned of [
        "TradovateClient",
        "prisma",
        "@/lib/db",
        "@/lib/env",
        '"server-only"',
        '"use server"',
      ]) {
        assert.ok(!src.includes(banned), `${rel} must not import '${banned}' — UI-only`);
      }
    });

    test(`${rel}: does not reference broker write/cancel/flatten actions`, () => {
      const src = read(rel);
      for (const banned of ["cancelOrder", "liquidate", "flattenPosition", "sendOrder"]) {
        // Allow string literal mentions in descriptive copy (e.g.
        // "Auto-flatten open positions" in the planned-actions UI), but not
        // function-call shape like cancelOrder( or liquidate(.
        const callPattern = new RegExp(`\\b${banned}\\(`);
        assert.ok(
          !callPattern.test(src),
          `${rel} must not call broker action ${banned}()`,
        );
      }
    });
  }
});
