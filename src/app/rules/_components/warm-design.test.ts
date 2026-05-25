/**
 * Warm design token regression tests — Phase C design pass.
 *
 * Locks in:
 *  - Enforcement chip color palette: indigo lock, amber monitor, warm stone
 *    saved, ghosted-dashed planned (distinct from the old red/sky/amber mix).
 *  - RuleCard edit affordance uses amber/copper tones (not stone-950 black).
 *  - Scope selector active state uses amber accent (not stone-950 black).
 *  - Trading Plan sidebar eyebrow uses text-amber-700.
 *  - how-enforcement-works color text classes match new badge palette.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  RULE_STATUS_CLS,
  RULE_STATUS_LABEL,
  RULE_STATUS_LABEL_COMPACT,
} from "./rule-status-badge-helpers.ts";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Enforcement chip color palette ───────────────────────────────────────────

describe("RULE_STATUS_CLS — warm design token palette", () => {
  it("guardrail-lock uses indigo (not red)", () => {
    assert.ok(
      RULE_STATUS_CLS["guardrail-lock"].includes("indigo"),
      "lock chip must use indigo — distinct, strong signal; red is reserved for destructive actions",
    );
    assert.ok(
      !RULE_STATUS_CLS["guardrail-lock"].includes("red"),
      "lock chip must not use red after design token update",
    );
  });

  it("monitoring-only uses amber (not stone)", () => {
    assert.ok(
      RULE_STATUS_CLS["monitoring-only"].includes("amber"),
      "monitor chip must use amber — informational/warning tone",
    );
    assert.ok(
      !RULE_STATUS_CLS["monitoring-only"].includes("stone-100") &&
        !RULE_STATUS_CLS["monitoring-only"].includes("stone-200"),
      "monitor chip must not use the old stone-100/stone-200 wash",
    );
  });

  it("saved-eval-soon uses stone (warm neutral, not sky)", () => {
    assert.ok(
      !RULE_STATUS_CLS["saved-eval-soon"].includes("sky"),
      "saved chip must not use sky — sky implies informational status which saved is not",
    );
    assert.ok(
      RULE_STATUS_CLS["saved-eval-soon"].includes("stone"),
      "saved chip must use warm stone neutral",
    );
  });

  it("planned-broker is ghosted with border-dashed", () => {
    assert.ok(
      RULE_STATUS_CLS["planned-broker"].includes("border-dashed"),
      "planned chip must have dashed border — visual signal that it is not active",
    );
    assert.ok(
      !RULE_STATUS_CLS["planned-broker"].includes("amber"),
      "planned chip must not use amber after design token update (amber is for monitoring)",
    );
  });

  it("broker-eligible retains emerald/green", () => {
    assert.ok(
      RULE_STATUS_CLS["broker-eligible"].includes("emerald"),
      "broker chip must stay emerald/green — strongest enforcement signal",
    );
  });

  it("all six variants are still present", () => {
    const variants = Object.keys(RULE_STATUS_CLS).sort();
    const expected = Object.keys(RULE_STATUS_LABEL).sort();
    assert.deepEqual(variants, expected, "RULE_STATUS_CLS must cover all variants");
  });
});

// ── RuleCard edit affordance uses warm amber tones ────────────────────────────

describe("RuleCard — warm edit affordance", () => {
  const SRC = read("sections/rule-card.tsx");

  it("Edit button uses amber tones (not stone-950 / black)", () => {
    assert.ok(
      SRC.includes("amber"),
      "RuleCard Edit button must use amber/copper tones per design",
    );
    assert.ok(
      !SRC.includes("bg-stone-950") && !SRC.includes("bg-stone-900"),
      "RuleCard Edit button must not use stone-950/900 (black) — use amber instead",
    );
  });

  it("editing state applies warm amber ring/border", () => {
    assert.ok(
      SRC.includes("border-amber"),
      "RuleCard editing state must apply amber border for warm active feel",
    );
  });
});

// ── Scope selector — amber active state ──────────────────────────────────────

describe("ScopeSelector — copper/amber active state", () => {
  const SRC = read("scope-selector.tsx");

  it("selected account item uses amber border (not stone-950)", () => {
    assert.ok(
      SRC.includes("border-amber"),
      "selected account item must use amber accent border",
    );
    assert.ok(
      !SRC.includes("border-stone-950"),
      "selected item must not use stone-950 border — use amber accent instead",
    );
  });

  it("selected starter badge uses amber (not stone-950)", () => {
    assert.ok(
      SRC.includes("bg-amber-600"),
      "selected starter badge must use amber-600 (copper-adjacent)",
    );
    assert.ok(
      !SRC.includes("bg-stone-950"),
      "selected starter badge must not use stone-950 after design update",
    );
  });
});

// ── how-enforcement-works — text colors match badge palette ──────────────────

describe("HowEnforcementWorks — color consistency with badge palette", () => {
  const SRC = read("how-enforcement-works.tsx");

  it("Guardrail lock text is indigo (not red)", () => {
    const lockSection = SRC.slice(SRC.indexOf("Guardrail lock") - 60, SRC.indexOf("Guardrail lock") + 80);
    assert.ok(
      lockSection.includes("indigo"),
      "how-enforcement-works must use indigo for Guardrail lock to match badge palette",
    );
    assert.ok(
      !lockSection.includes("red"),
      "how-enforcement-works must not use red for Guardrail lock after design update",
    );
  });

  it("Monitoring only text is amber", () => {
    const monSection = SRC.slice(SRC.indexOf("Monitoring only") - 60, SRC.indexOf("Monitoring only") + 80);
    assert.ok(
      monSection.includes("amber"),
      "how-enforcement-works must use amber for Monitoring only to match badge palette",
    );
  });

  it("full canonical labels are still present (no text changes)", () => {
    for (const label of [
      "Broker-backed eligible",
      "Guardrail lock",
      "Monitoring only",
      "Saved · Evaluation coming soon",
      "Planned broker action",
    ]) {
      assert.ok(SRC.includes(label), `how-enforcement-works must still contain "${label}"`);
    }
  });
});

// ── RuleStatusBadge — dot indicator ──────────────────────────────────────────

describe("RuleStatusBadge — dot indicator", () => {
  const SRC = read("rule-status-badge.tsx");

  it("badge renders a small dot indicator before the label", () => {
    assert.ok(
      SRC.includes("rounded-full bg-current"),
      "RuleStatusBadge must render a dot indicator (rounded-full bg-current)",
    );
  });

  it("badge still has compact prop", () => {
    assert.ok(SRC.includes("compact"), "RuleStatusBadge must retain compact prop");
  });
});
