/**
 * Legal / risk-copy honesty audit.
 *
 * Guards that the Terms, Privacy, and Risk Disclaimer pages stay
 * consistent with how the product actually behaves:
 *   1. Futures risk is disclosed and Guardrail is stated not to be
 *      financial advice or a guarantee against losses.
 *   2. Broker-side enforcement is described as monitoring-first and off
 *      by default; Daily Loss is the only broker-eligible rule.
 *   3. No legal page claims profit target / max trades / position size /
 *      session cutoff are broker-enforced.
 *   4. Rule-change limits and audit records are disclosed.
 *   5. Tradovate is not represented as endorsing the product.
 *   6. No internal implementation terms leak into legal copy.
 *
 * Run: npm run test:unit
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const TERMS = readFileSync(join(__dirname, "terms/page.tsx"), "utf8").replace(/\s+/g, " ");
const PRIVACY = readFileSync(join(__dirname, "privacy/page.tsx"), "utf8").replace(/\s+/g, " ");
const RISK = readFileSync(join(__dirname, "risk-disclaimer/page.tsx"), "utf8").replace(/\s+/g, " ");

const LEGAL_PAGES: [string, string][] = [
  ["terms/page.tsx", TERMS],
  ["privacy/page.tsx", PRIVACY],
  ["risk-disclaimer/page.tsx", RISK],
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
  "brokerEndpoint",
];

// ── Risk disclosure ───────────────────────────────────────────────────────────

describe("legal — risk disclosure", () => {
  it("the Risk Disclaimer states futures trading carries substantial risk of loss", () => {
    assert.ok(
      RISK.includes("substantial risk of loss"),
      "the Risk Disclaimer must state trading involves substantial risk of loss",
    );
  });

  it("the Risk Disclaimer and Terms state Guardrail is not financial advice", () => {
    assert.ok(
      /not (a |an )?(trading advisory|financial)/i.test(RISK) || RISK.includes("not provide financial advice"),
      "the Risk Disclaimer must state Guardrail is not financial advice",
    );
    assert.ok(
      TERMS.includes("not a trading advisory") || /financial.{0,40}advice/i.test(TERMS),
      "the Terms must state Guardrail is not financial advice",
    );
  });

  it("the Risk Disclaimer states Guardrail does not guarantee outcomes or prevent losses", () => {
    assert.ok(
      /does not guarantee/i.test(RISK) && /does not (predict|prevent)/i.test(RISK),
      "the Risk Disclaimer must state Guardrail does not guarantee outcomes or prevent losses",
    );
  });

  it("the Risk Disclaimer states the user remains responsible for trading decisions", () => {
    assert.ok(
      /responsible for your trading decisions/i.test(RISK),
      "the Risk Disclaimer must state the user remains responsible for their trading decisions",
    );
  });
});

// ── Monitoring-first / broker enforcement off by default ──────────────────────

describe("legal — monitoring-first and broker-enforcement scope", () => {
  it("Terms and Risk Disclaimer state Guardrail starts in monitoring mode", () => {
    assert.ok(TERMS.includes("monitoring mode"), "Terms must say Guardrail starts in monitoring mode");
    assert.ok(RISK.includes("monitoring mode"), "Risk Disclaimer must say Guardrail starts in monitoring mode");
  });

  it("Terms and Risk Disclaimer state broker-side enforcement is not active by default", () => {
    assert.ok(
      TERMS.includes("not active by default"),
      "Terms must state broker-side enforcement is not active by default",
    );
    assert.ok(
      RISK.includes("off by default") || RISK.includes("not active by default"),
      "Risk Disclaimer must state broker-side enforcement is off by default",
    );
  });

  it("states Daily Loss is the only rule eligible for broker-side enforcement", () => {
    assert.ok(
      TERMS.includes("only the Daily Loss limit is eligible"),
      "Terms must state Daily Loss is the only broker-eligible rule",
    );
    assert.ok(
      RISK.includes("Only the Daily Loss limit is eligible") ||
        RISK.includes("limited to the Daily Loss limit"),
      "Risk Disclaimer must state Daily Loss is the only broker-eligible rule",
    );
  });

  it("states the other rules are app-level only, never broker-enforced", () => {
    for (const [name, src] of [["terms", TERMS], ["risk-disclaimer", RISK]] as const) {
      assert.ok(
        /Profit target, max trades, loss streak, position size, and session cutoff are evaluated at the app level only/.test(src),
        `${name} must state profit target / max trades / loss streak / position size / session cutoff are app-level only`,
      );
    }
  });

  it("no longer claims broker lockout and position flatten are active automated actions", () => {
    assert.ok(
      !RISK.includes("the following automated actions are active"),
      "the Risk Disclaimer must not claim broker lockout / flatten are active automated actions",
    );
  });

  it("describes order cancellation and position flattening as planned, not active", () => {
    assert.ok(
      /not active/.test(RISK) && /planned/.test(RISK),
      "the Risk Disclaimer must describe cancel / flatten as not active and planned",
    );
  });
});

// ── Rule changes / audit records ──────────────────────────────────────────────

describe("legal — rule changes and audit records", () => {
  it("Terms disclose that in-session rule changes may be limited or deferred", () => {
    assert.ok(
      TERMS.includes("Rule changes and audit records") &&
        TERMS.includes("next trading day"),
      "Terms must disclose that some rule changes apply from the next trading day",
    );
  });

  it("Terms disclose that Guardrail keeps audit records of rule and blocked changes", () => {
    assert.ok(
      /audit records of rule changes/.test(TERMS) && /blocked or deferred/.test(TERMS),
      "Terms must disclose audit records of rule changes and blocked/deferred changes",
    );
  });

  it("Privacy lists audit records among the data it stores", () => {
    assert.ok(
      PRIVACY.includes("Audit records:"),
      "the Privacy policy must list audit records among stored data",
    );
  });
});

// ── Connection limitations ────────────────────────────────────────────────────

describe("legal — limitations are disclosed", () => {
  it("Risk Disclaimer explains outages, the need to stay connected, and non-retroactivity", () => {
    assert.ok(
      /API outages/.test(RISK) &&
        /keep your broker account connected/.test(RISK) &&
        /not applied retroactively/.test(RISK),
      "the Risk Disclaimer must explain outages, staying connected, and non-retroactive rules",
    );
  });
});

// ── Tradovate not endorsing ───────────────────────────────────────────────────

describe("legal — broker is not represented as endorsing Guardrail", () => {
  it("Terms and Risk Disclaimer state Guardrail is independent and not endorsed by any broker", () => {
    for (const [name, src] of [["terms", TERMS], ["risk-disclaimer", RISK]] as const) {
      assert.ok(
        src.includes("independent product") && /not endorsed by/.test(src),
        `${name} must state Guardrail is independent and not endorsed by any broker`,
      );
    }
  });
});

// ── No internal terms ─────────────────────────────────────────────────────────

describe("legal — no internal terms", () => {
  it("leaks no internal implementation terms in any legal page", () => {
    for (const [name, src] of LEGAL_PAGES) {
      for (const term of INTERNAL_TERMS) {
        assert.ok(!src.includes(term), `internal term "${term}" must not appear in ${name}`);
      }
    }
  });
});
