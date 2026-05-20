/**
 * Onboarding flow honesty audit.
 *
 * Customer-facing truth guards for a first-time trader's setup path:
 *   1. Guardian is clearly defined as the rule engine.
 *   2. The flow states Guardrail starts in monitoring mode, and that
 *      Daily Loss is the only rule eligible for broker-side enforcement.
 *   3. The profile step is honest that it is personalization context —
 *      it does not configure rules or enforcement.
 *   4. No internal implementation terms leak into onboarding copy.
 *   5. Every onboarding CTA points to a route that exists.
 *
 * Source-scan approach mirrors alerts-page-honesty.test.ts.
 *
 * Run: npm run test:unit
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const APP_ROOT = join(__dirname, "..");

const ONBOARDING_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");
const PROFILE_SRC = readFileSync(join(__dirname, "profile/page.tsx"), "utf8");

// Whitespace-normalized copy — JSX text wraps across lines, so phrase checks
// must collapse runs of whitespace before matching.
const ONBOARDING_TEXT = ONBOARDING_SRC.replace(/\s+/g, " ");
const PROFILE_TEXT = PROFILE_SRC.replace(/\s+/g, " ");
const FORM_SRC = readFileSync(
  join(__dirname, "profile/_components/trading-profile-form.tsx"),
  "utf8",
);

const ALL_ONBOARDING_FILES: [string, string][] = [
  ["page.tsx", ONBOARDING_SRC],
  ["profile/page.tsx", PROFILE_SRC],
  ["profile/_components/trading-profile-form.tsx", FORM_SRC],
];

const INTERNAL_TERMS = [
  "dry_run",
  "DryRunViolation",
  "GuardianIntervention",
  "InternalLockEvent",
  "BrokerRiskSettingsSyncAudit",
  "listener-worker",
  "reconciliation",
  "dedup",
];

// ── Guardian is defined ───────────────────────────────────────────────────────

describe("onboarding — Guardian definition", () => {
  it("defines Guardian as the rule engine that watches the account", () => {
    assert.ok(
      ONBOARDING_TEXT.includes("Guardian is the rule engine") &&
        ONBOARDING_TEXT.includes("watches your account"),
      "onboarding must define Guardian as the rule engine that watches the account",
    );
  });
});

// ── Monitoring mode first, Daily Loss the only broker-backed rule ─────────────

describe("onboarding — monitoring vs broker-backed honesty", () => {
  it("states Guardrail starts in monitoring mode", () => {
    assert.ok(
      ONBOARDING_TEXT.includes("monitoring mode"),
      "onboarding must state Guardrail starts in monitoring mode",
    );
  });

  it("states Daily Loss is the only rule eligible for broker-side enforcement", () => {
    assert.ok(
      ONBOARDING_TEXT.includes("Daily Loss is the only"),
      "onboarding must state Daily Loss is the only broker-backed-eligible rule",
    );
  });

  it("marks the other rules as Guardrail-monitored", () => {
    assert.ok(
      ONBOARDING_TEXT.includes("Guardrail-monitored"),
      "onboarding must clarify profit target / max trades / loss streak / position size / session cutoff are Guardrail-monitored",
    );
  });

  it("states no broker writes happen unless explicitly enabled", () => {
    assert.ok(
      ONBOARDING_TEXT.includes("No broker writes"),
      "onboarding must state no broker writes happen unless the user turns them on",
    );
  });
});

// ── Profile step does not overpromise ─────────────────────────────────────────

describe("onboarding — profile step is personalization only", () => {
  it("states the profile is personalization, not rule/enforcement configuration", () => {
    assert.ok(
      PROFILE_TEXT.includes("personalization only") &&
        PROFILE_TEXT.includes("does not set your trading rules"),
      "the profile step must state it is personalization and does not set rules or enforcement",
    );
  });
});

// ── No internal terms ─────────────────────────────────────────────────────────

describe("onboarding — no internal terms", () => {
  it("leaks no internal implementation terms in any onboarding file", () => {
    for (const [name, src] of ALL_ONBOARDING_FILES) {
      for (const term of INTERNAL_TERMS) {
        assert.ok(!src.includes(term), `internal term "${term}" must not appear in ${name}`);
      }
    }
  });
});

// ── Every CTA points to an existing route ─────────────────────────────────────

describe("onboarding — all CTAs point to existing routes", () => {
  it("every internal route referenced by the onboarding page resolves to a page file", () => {
    const routes = new Set(
      [...ONBOARDING_SRC.matchAll(/"(\/[^"\s]*)"/g)].map((m) => m[1]!),
    );
    assert.ok(routes.size > 0, "expected the onboarding page to reference internal routes");

    for (const route of routes) {
      const clean = route.split("#")[0]!.split("?")[0]!;
      const pageFile =
        clean === "/"
          ? join(APP_ROOT, "page.tsx")
          : join(APP_ROOT, clean.replace(/^\//, ""), "page.tsx");
      assert.ok(
        existsSync(pageFile),
        `onboarding CTA route "${route}" has no page file at ${pageFile}`,
      );
    }
  });

  it("the Turn on Guardian CTA anchor exists on the rules page", () => {
    const rulesSrc = readFileSync(join(APP_ROOT, "rules/page.tsx"), "utf8");
    assert.ok(
      ONBOARDING_SRC.includes("/rules#guardian-toggle") &&
        rulesSrc.includes('id="guardian-toggle"'),
      "the Guardian CTA anchor (#guardian-toggle) must exist on the rules page",
    );
  });
});
