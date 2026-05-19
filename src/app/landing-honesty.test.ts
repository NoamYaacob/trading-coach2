/**
 * Landing page honesty audit.
 *
 * Customer-facing truth guards for the public landing page (`/`) and the
 * shared marketing copy it renders:
 *   1. Guardian is defined as the rule engine.
 *   2. Daily Loss is the only rule presented as broker-backed; the others
 *      are Guardrail-monitored, never broker-enforced.
 *   3. The rule list does not badge unbuilt rules (e.g. News Blackout) as
 *      active.
 *   4. Key objections are answered honestly (rule changes, financial
 *      advice, broker support).
 *   5. No internal implementation terms leak into marketing copy.
 *   6. CTAs branch correctly for logged-in vs logged-out visitors.
 *
 * Run: npm run test:unit
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { FAQS, RULES } from "../lib/marketing-data.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");
const MARKETING_SRC = readFileSync(join(__dirname, "../lib/marketing-data.ts"), "utf8");

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

function faqByQuestion(q: string) {
  return FAQS.find((f) => f.q === q);
}

// ── Guardian is defined ───────────────────────────────────────────────────────

describe("landing — Guardian is defined", () => {
  it("includes a 'What is Guardian?' FAQ that defines it as the rule engine", () => {
    const faq = faqByQuestion("What is Guardian?");
    assert.ok(faq, "FAQS must include a 'What is Guardian?' entry");
    assert.ok(
      /rule engine/i.test(faq!.a),
      "the Guardian FAQ must define Guardian as the rule engine",
    );
  });
});

// ── Daily Loss is the only broker-backed rule ─────────────────────────────────

describe("landing — only Daily Loss is broker-backed", () => {
  it("includes a FAQ answering which rules can be enforced at the broker", () => {
    assert.ok(
      faqByQuestion("Which rules can be enforced at the broker?"),
      "FAQS must answer which rules can be broker-enforced",
    );
  });

  it("states Daily Loss is the only broker-backed rule", () => {
    const faq = faqByQuestion("Which rules can be enforced at the broker?");
    assert.ok(
      faq && faq.a.includes("Daily Loss is the only"),
      "the broker-rules FAQ must state Daily Loss is the only broker-backed rule",
    );
  });

  it("states the other rules are Guardrail-monitored and never broker-enforced", () => {
    const faq = faqByQuestion("Which rules can be enforced at the broker?");
    assert.ok(
      faq && faq.a.includes("Guardrail-monitored") && faq.a.includes("never broker-enforced"),
      "the broker-rules FAQ must clarify the other rules are monitored, never broker-enforced",
    );
  });

  it("states no broker writes happen by default", () => {
    const faq = faqByQuestion("Which rules can be enforced at the broker?");
    assert.ok(
      faq && /no broker writes happen by default/i.test(faq.a),
      "the broker-rules FAQ must state no broker writes happen by default",
    );
  });

  it("the landing risk disclaimer scopes broker enforcement to Daily Loss", () => {
    const text = PAGE_SRC.replace(/\s+/g, " ");
    assert.ok(
      text.includes("broker-side enforcement applies only to Daily Loss"),
      "the landing disclaimer must scope broker-side enforcement to Daily Loss",
    );
  });
});

// ── Roadmap honesty: unbuilt rules are not badged active ──────────────────────

describe("landing — rule roadmap honesty", () => {
  it("News Blackout is not badged as an active rule", () => {
    const rule = RULES.find((r) => r.name === "News Blackout");
    assert.ok(rule, "RULES must still list News Blackout");
    assert.notEqual(rule!.badge, "active", "News Blackout has no live evaluation — must not be active");
  });

  it("there are exactly four active rules and the landing copy matches", () => {
    const activeCount = RULES.filter((r) => r.badge === "active").length;
    assert.equal(activeCount, 4, "expected exactly four active rules");
    assert.ok(
      PAGE_SRC.includes("Four active rules"),
      "the landing copy must say 'Four active rules'",
    );
    assert.ok(
      !PAGE_SRC.includes("Five active rules") && !PAGE_SRC.includes("News Blackout"),
      "the landing must not still claim five active rules or list News Blackout as active",
    );
  });
});

// ── Objections answered honestly ──────────────────────────────────────────────

describe("landing — FAQ answers match product behavior", () => {
  it("explains rule changes after trading has started", () => {
    const faq = faqByQuestion("Can I change my rules during a trading day?");
    assert.ok(
      faq && /edit rules at any time/i.test(faq.a),
      "FAQS must explain that rules can be edited after trading starts",
    );
  });

  it("answers whether Guardrail is financial advice", () => {
    const faq = faqByQuestion("Is Guardrail financial advice?");
    assert.ok(faq, "FAQS must include an 'Is Guardrail financial advice?' entry");
    assert.ok(
      /\bNo\b/.test(faq!.a) && /risk of loss/i.test(faq!.a),
      "the financial-advice FAQ must say it is not advice and note trading risk",
    );
  });

  it("does not claim broker order-blocking is live today", () => {
    const faq = faqByQuestion("Does Guardrail block my broker orders?");
    assert.ok(
      faq && /not yet/i.test(faq.a),
      "the broker-order FAQ must honestly say broker blocking is not live yet",
    );
  });
});

// ── No internal terms ─────────────────────────────────────────────────────────

describe("landing — no internal terms", () => {
  it("leaks no internal implementation terms in landing or marketing copy", () => {
    for (const [name, src] of [
      ["page.tsx", PAGE_SRC],
      ["marketing-data.ts", MARKETING_SRC],
    ] as const) {
      for (const term of INTERNAL_TERMS) {
        assert.ok(!src.includes(term), `internal term "${term}" must not appear in ${name}`);
      }
    }
  });
});

// ── CTA logic ─────────────────────────────────────────────────────────────────

describe("landing — CTAs branch by auth state", () => {
  it("branches CTAs on the signed-in user", () => {
    assert.ok(
      PAGE_SRC.includes("const user = await getCurrentUser()") && PAGE_SRC.includes("user ?"),
      "the landing page must branch its CTAs on whether a user is signed in",
    );
  });

  it("offers signup/login to logged-out visitors and the dashboard to logged-in users", () => {
    assert.ok(PAGE_SRC.includes('href="/signup"'), "logged-out visitors need a signup CTA");
    assert.ok(PAGE_SRC.includes('href="/login"'), "logged-out visitors need a login CTA");
    assert.ok(PAGE_SRC.includes('href="/dashboard"'), "logged-in users need a dashboard CTA");
  });
});
