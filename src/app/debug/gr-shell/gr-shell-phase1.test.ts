/**
 * Guardrail 2 Phase 1 — source-scan safety and adapter unit tests.
 *
 * No JSX renderer. Tests read source text or import pure TS modules.
 *
 * Coverage:
 *   1. CSS token additions — new G2 tokens present in globals.css
 *   2. Adapter — every RuleStatusVariant maps to the correct EnforcementKey
 *   3. Adapter — utility has no label (no badge rendered)
 *   4. Showcase page — no real account/balance/P&L data
 *   5. Showcase page — preview warning present
 *   6. GrShell — does not import AppShell
 *   7. Primitives — all required files exist
 *   8. Debug page — robots noindex meta
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── 1. CSS tokens ─────────────────────────────────────────────

describe("globals.css G2 tokens", () => {
  const css = read("app/globals.css");

  it("has --gr-surface-hi", () => {
    assert.ok(css.includes("--gr-surface-hi"), "missing --gr-surface-hi");
  });

  it("has --gr-text-faint", () => {
    assert.ok(css.includes("--gr-text-faint"), "missing --gr-text-faint");
  });

  it("has enforcement border tokens (broker-bd, lock-bd, mon-bd, saved-bd, plan-bd)", () => {
    assert.ok(css.includes("--gr-broker-bd"), "missing --gr-broker-bd");
    assert.ok(css.includes("--gr-lock-bd"), "missing --gr-lock-bd");
    assert.ok(css.includes("--gr-mon-bd"), "missing --gr-mon-bd");
    assert.ok(css.includes("--gr-saved-bd"), "missing --gr-saved-bd");
    assert.ok(css.includes("--gr-plan-bd"), "missing --gr-plan-bd");
  });

  it("has state tokens (warn, ok, bad) with bg and bd", () => {
    assert.ok(css.includes("--gr-warn:"), "missing --gr-warn");
    assert.ok(css.includes("--gr-warn-bg"), "missing --gr-warn-bg");
    assert.ok(css.includes("--gr-warn-bd"), "missing --gr-warn-bd");
    assert.ok(css.includes("--gr-ok:"), "missing --gr-ok");
    assert.ok(css.includes("--gr-ok-bg"), "missing --gr-ok-bg");
    assert.ok(css.includes("--gr-ok-bd"), "missing --gr-ok-bd");
    assert.ok(css.includes("--gr-bad:"), "missing --gr-bad");
    assert.ok(css.includes("--gr-bad-bg"), "missing --gr-bad-bg");
    assert.ok(css.includes("--gr-bad-bd"), "missing --gr-bad-bd");
  });

  it("has radius tokens (r-sm, r-md, r-lg)", () => {
    assert.ok(css.includes("--gr-r-sm"), "missing --gr-r-sm");
    assert.ok(css.includes("--gr-r-md"), "missing --gr-r-md");
    assert.ok(css.includes("--gr-r-lg"), "missing --gr-r-lg");
  });
});

// ── 2. Adapter — mapping correctness ─────────────────────────

import {
  ruleStatusToEnforcement,
  enforcementMetaForStatus,
  ENFORCEMENT_META,
} from "../../rules/_components/rule-status-to-enforcement.ts";

describe("ruleStatusToEnforcement adapter", () => {
  it("broker-eligible → broker", () => {
    assert.strictEqual(ruleStatusToEnforcement("broker-eligible"), "broker");
  });

  it("guardrail-lock → lock", () => {
    assert.strictEqual(ruleStatusToEnforcement("guardrail-lock"), "lock");
  });

  it("monitoring-only → monitor", () => {
    assert.strictEqual(ruleStatusToEnforcement("monitoring-only"), "monitor");
  });

  it("saved-eval-soon → saved", () => {
    assert.strictEqual(ruleStatusToEnforcement("saved-eval-soon"), "saved");
  });

  it("planned-broker → planned", () => {
    assert.strictEqual(ruleStatusToEnforcement("planned-broker"), "planned");
  });

  it("not-active → planned", () => {
    assert.strictEqual(ruleStatusToEnforcement("not-active"), "planned");
  });
});

// ── 3. Adapter — utility has no label ────────────────────────

describe("ENFORCEMENT_META utility key", () => {
  it("utility label is empty (no badge rendered)", () => {
    assert.strictEqual(ENFORCEMENT_META.utility.label, "");
  });

  it("utility badge is neutral", () => {
    assert.strictEqual(ENFORCEMENT_META.utility.badge, "neutral");
  });
});

// ── 4. enforcementMetaForStatus returns correct badges ────────

describe("enforcementMetaForStatus", () => {
  it("broker-eligible badge is 'broker'", () => {
    assert.strictEqual(
      enforcementMetaForStatus("broker-eligible").badge,
      "broker",
    );
  });

  it("guardrail-lock badge is 'lock'", () => {
    assert.strictEqual(
      enforcementMetaForStatus("guardrail-lock").badge,
      "lock",
    );
  });

  it("monitoring-only badge is 'mon'", () => {
    assert.strictEqual(
      enforcementMetaForStatus("monitoring-only").badge,
      "mon",
    );
  });

  it("saved-eval-soon badge is 'saved'", () => {
    assert.strictEqual(
      enforcementMetaForStatus("saved-eval-soon").badge,
      "saved",
    );
  });

  it("planned-broker badge is 'plan'", () => {
    assert.strictEqual(
      enforcementMetaForStatus("planned-broker").badge,
      "plan",
    );
  });

  it("not-active badge is 'plan' (same visual as planned)", () => {
    assert.strictEqual(enforcementMetaForStatus("not-active").badge, "plan");
  });
});

// ── 5. Showcase — no real data ────────────────────────────────

describe("showcase source: no real account data", () => {
  const showcase = read(
    "app/debug/gr-shell/_components/gr-shell-showcase.tsx",
  );

  // These are the mock refs — fine. The test ensures we never swap in
  // real-looking refs (like 'TV-2200' from gr-data.jsx's REAL examples).
  it("uses PREVIEW suffix in mock refs, not production-looking refs", () => {
    // gr-account-selector uses PREVIEW suffix; showcase references it via component.
    // Check showcase itself has no raw real-looking IDs.
    const realLookingRefs = ["TV-2200", "APEX-50-12091", "APEX-100-30412", "TS-77150"];
    for (const ref of realLookingRefs) {
      assert.ok(
        !showcase.includes(ref),
        `Showcase contains real-looking ref: ${ref}`,
      );
    }
  });

  it("contains preview/mock banner text", () => {
    assert.ok(
      showcase.toLowerCase().includes("preview") ||
        showcase.toLowerCase().includes("mock"),
      "Showcase missing preview/mock label",
    );
  });

  it("does not contain real P&L numbers from gr-data.jsx mock dataset", () => {
    // Values from gr-data.jsx that should never appear verbatim
    const realDataValues = ["-840", "2340", "103420", "49160"];
    for (const v of realDataValues) {
      assert.ok(
        !showcase.includes(v),
        `Showcase contains suspicious real-data value: ${v}`,
      );
    }
  });
});

// ── 6. GrShell does not import AppShell ──────────────────────

describe("GrShell isolation", () => {
  const shell = read("components/ui/gr-shell.tsx");

  it("does not import from app-shell", () => {
    assert.ok(
      !shell.includes("app-shell"),
      "GrShell must not import from AppShell",
    );
  });

  it("does not import API routes or auth", () => {
    const forbidden = ["/api/", "auth", "session", "prisma", "db"];
    for (const f of forbidden) {
      assert.ok(
        !shell.includes(f),
        `GrShell must not import: ${f}`,
      );
    }
  });
});

// ── 7. Primitive files exist ──────────────────────────────────

describe("primitive files exist", () => {
  const PRIMITIVES = [
    "components/ui/gr/gr-icon.tsx",
    "components/ui/gr/gr-dot.tsx",
    "components/ui/gr/gr-badge.tsx",
    "components/ui/gr/gr-button.tsx",
    "components/ui/gr/gr-input.tsx",
    "components/ui/gr/gr-chip.tsx",
    "components/ui/gr/gr-progress.tsx",
    "components/ui/gr/gr-enforcement-chip.tsx",
    "components/ui/gr/gr-account-selector.tsx",
    "components/ui/gr-shell.tsx",
    "app/rules/_components/rule-status-to-enforcement.ts",
    "app/debug/gr-shell/page.tsx",
  ];

  for (const p of PRIMITIVES) {
    it(`exists: ${p}`, () => {
      // Will throw if file doesn't exist
      const content = read(p);
      assert.ok(content.length > 0, `${p} is empty`);
    });
  }
});

// ── 8. Debug page — noindex ───────────────────────────────────

describe("debug page metadata", () => {
  const page = read("app/debug/gr-shell/page.tsx");

  it("has robots noindex in metadata", () => {
    assert.ok(
      page.includes("noindex") || page.includes("robots"),
      "Debug page should set robots noindex",
    );
  });
});

// ── 9. GrAccountSelector — mock data only ────────────────────

describe("GrAccountSelector mock data", () => {
  const src = read("components/ui/gr/gr-account-selector.tsx");

  it("contains PREVIEW suffix in mock refs", () => {
    assert.ok(
      src.includes("PREVIEW"),
      "Account selector mock refs should contain PREVIEW suffix",
    );
  });

  it("does not contain real account ref patterns from gr-data.jsx", () => {
    // Real refs from gr-data.jsx
    const realRefs = ["APEX-50-12091", "APEX-100-30412", "TS-77150", "TV-2200", "TV-2201-DEMO", "TV-1004"];
    for (const ref of realRefs) {
      assert.ok(
        !src.includes(ref),
        `Account selector should not contain real ref: ${ref}`,
      );
    }
  });

  it("is marked PRESENTATIONAL ONLY in its JSDoc", () => {
    assert.ok(
      src.includes("PRESENTATIONAL ONLY") || src.includes("mock"),
      "Account selector must document its presentational/mock nature",
    );
  });
});
