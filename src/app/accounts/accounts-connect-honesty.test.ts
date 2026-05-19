/**
 * Accounts & Tradovate connection-flow honesty audit.
 *
 * Customer-facing truth guards for the Accounts page and broker
 * connection flow:
 *   1. No internal implementation terms or debug identifiers leak into
 *      customer-visible copy.
 *   2. No rule is falsely claimed as broker-enforced — Daily Loss is the
 *      only rule backed by Tradovate broker risk settings today.
 *   3. The connect flow warns users they will be redirected to Tradovate
 *      and makes Demo vs Live explicit.
 *   4. Expired connections expose an actionable reconnect path.
 *
 * Source-scan approach mirrors alerts-page-honesty.test.ts.
 *
 * Run: npm run test:unit
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const CONNECT_SRC = readFileSync(
  join(__dirname, "connect/tradovate/_components/connect-tradovate-client.tsx"),
  "utf8",
);
const RULES_SRC = readFileSync(join(__dirname, "connect/tradovate/rules/page.tsx"), "utf8");
const CARD_SRC = readFileSync(join(__dirname, "_components/account-card.tsx"), "utf8");
const NEW_SRC = readFileSync(join(__dirname, "new/page.tsx"), "utf8");
const SELECT_SRC = readFileSync(
  join(__dirname, "connect/tradovate/select/_components/select-accounts-form.tsx"),
  "utf8",
);

const CONNECT_FLOW_FILES: [string, string][] = [
  ["connect-tradovate-client.tsx", CONNECT_SRC],
  ["rules/page.tsx", RULES_SRC],
  ["account-card.tsx", CARD_SRC],
  ["new/page.tsx", NEW_SRC],
  ["select-accounts-form.tsx", SELECT_SRC],
];

// ── No leaked internal terms / debug identifiers ──────────────────────────────

describe("accounts flow — no internal terms in customer copy", () => {
  it("does not render the internal broker dedup key in the account card", () => {
    assert.ok(
      !CARD_SRC.includes("{item.listenerBrokerDedupKey}"),
      "the account card must not render the internal broker dedup key to users",
    );
  });

  it("leaks no internal infrastructure terms in connect-flow copy", () => {
    for (const [name, src] of CONNECT_FLOW_FILES) {
      for (const term of ["listener-worker", "BrokerRiskSettingsSyncAudit", "reconciliation"]) {
        assert.ok(!src.includes(term), `internal term "${term}" must not appear in ${name}`);
      }
    }
  });

  it("uses no false 'test mode' language", () => {
    for (const [name, src] of CONNECT_FLOW_FILES) {
      assert.ok(
        !src.toLowerCase().includes("test mode"),
        `"test mode" language must not appear in ${name}`,
      );
    }
  });
});

// ── No false broker-enforcement claims ────────────────────────────────────────

describe("accounts flow — only Daily Loss is broker-backed", () => {
  it("never claims profit target, max contracts, or order actions are broker-enforced", () => {
    const banned = [
      "Broker-backed: Profit target",
      "max contracts broker enforced",
      "order actions active",
    ];
    for (const [name, src] of CONNECT_FLOW_FILES) {
      for (const phrase of banned) {
        assert.ok(!src.includes(phrase), `"${phrase}" must not appear in ${name}`);
      }
    }
  });

  it("connect flow states Daily Loss is the only broker-backed rule", () => {
    assert.ok(
      CONNECT_SRC.includes("Daily Loss is the only"),
      "the connect flow must state Daily Loss is the only broker-backed rule",
    );
  });

  it("connect flow marks the other rules as monitored, not broker-enforced", () => {
    assert.ok(
      CONNECT_SRC.includes("not broker-enforced"),
      "the connect flow must clarify the other rules are monitored, not broker-enforced",
    );
  });

  it("rules step names Daily Loss as the only broker-backed rule", () => {
    assert.ok(
      RULES_SRC.includes("the only broker-backed rule"),
      "the rules assignment step must name Daily Loss as the only broker-backed rule",
    );
  });
});

// ── Connect flow is clear about redirect, Demo vs Live ────────────────────────

describe("accounts flow — connect clarity", () => {
  it("warns the user they will be redirected to Tradovate", () => {
    assert.ok(
      CONNECT_SRC.includes("redirected to Tradovate"),
      "the connect flow must tell the user they will be redirected to Tradovate",
    );
  });

  it("makes Demo vs Live explicit", () => {
    assert.ok(
      CONNECT_SRC.includes("Demo / Simulation") && /\bLive\b/.test(CONNECT_SRC),
      "the connect flow must label Demo and Live environments",
    );
  });

  it("explains Guardrail starts in monitoring mode", () => {
    assert.ok(
      CONNECT_SRC.includes("monitoring mode"),
      "the connect flow must explain Guardrail starts in monitoring mode",
    );
  });

  it("does not imply order placement is active under monitoring-only access", () => {
    assert.ok(
      CONNECT_SRC.includes("cannot place orders"),
      "the connect flow must state monitoring-only access cannot place orders",
    );
  });
});

// ── Expired / reconnect states are actionable ─────────────────────────────────

describe("accounts flow — reconnect copy is actionable", () => {
  it("the account card offers a reconnect action for expired connections", () => {
    assert.ok(
      CARD_SRC.includes("expired") &&
        (CARD_SRC.includes("Re-authorize Tradovate") || CARD_SRC.includes("reconnect")),
      "expired connections must show an actionable reconnect path",
    );
  });
});
