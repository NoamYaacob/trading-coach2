/**
 * Unit tests for the pre-beta env-posture verdict (posture.ts).
 *
 * Pure-function tests — no process.env, no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  derivePreBetaEnvVerdict,
  type EnvFlags,
  type EnvPresence,
} from "./posture.ts";

// Guided-beta-correct baseline: all dangerous flags off, every required var present.
const SAFE_FLAGS: EnvFlags = {
  brokerEnforcementEnabled: false,
  enforcementDryRun: true,
  brokerEnforcementSimulationEnabled: false,
  enableTradovateOrderActions: false,
  tradovateListenerEnableLive: false,
  guardrailInternalLockEnabled: false,
  billingEnabled: false,
};

const FULL_PRESENCE: EnvPresence = {
  telegramBotUsername: true,
  telegramBotToken: true,
  telegramWebhookSecret: true,
  tradovateTokenEncryptionKey: true,
  tradovateClientId: true,
  tradovateClientSecret: true,
  stripeSecretKey: true,
  stripeWebhookSecret: true,
  stripePriceId: true,
};

function verdict(
  flags: Partial<EnvFlags> = {},
  presence: Partial<EnvPresence> = {},
  telegramScopedOut = false,
) {
  return derivePreBetaEnvVerdict({
    flags: { ...SAFE_FLAGS, ...flags },
    presence: { ...FULL_PRESENCE, ...presence },
    telegramScopedOut,
  });
}

// ── GO when the posture matches the runbook ──────────────────────────────────

describe("derivePreBetaEnvVerdict — GO", () => {
  it("returns GO when posture matches the guided-beta runbook", () => {
    const v = verdict();
    assert.equal(v.status, "GO");
    assert.deepEqual(v.dangerousFlags, []);
    assert.deepEqual(v.missingRequiredForBeta, []);
    assert.deepEqual(v.reasons, []);
  });
});

// ── NO_GO on each dangerous flag ─────────────────────────────────────────────

describe("derivePreBetaEnvVerdict — dangerous flags", () => {
  it("NO_GO when BROKER_ENFORCEMENT_ENABLED is true", () => {
    const v = verdict({ brokerEnforcementEnabled: true });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.dangerousFlags.includes("BROKER_ENFORCEMENT_ENABLED"));
    assert.ok(v.reasons.some((r) => r.includes("BROKER_ENFORCEMENT_ENABLED")));
  });

  it("NO_GO when ENABLE_TRADOVATE_ORDER_ACTIONS is true", () => {
    const v = verdict({ enableTradovateOrderActions: true });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.dangerousFlags.includes("ENABLE_TRADOVATE_ORDER_ACTIONS"));
  });

  it("NO_GO when TRADOVATE_LISTENER_ENABLE_LIVE is true", () => {
    const v = verdict({ tradovateListenerEnableLive: true });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.dangerousFlags.includes("TRADOVATE_LISTENER_ENABLE_LIVE"));
  });

  it("NO_GO when GUARDRAIL_INTERNAL_LOCK_ENABLED is true", () => {
    const v = verdict({ guardrailInternalLockEnabled: true });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.dangerousFlags.includes("GUARDRAIL_INTERNAL_LOCK_ENABLED"));
  });

  it("NO_GO when BILLING_ENABLED is true (guided beta requires false)", () => {
    const v = verdict({ billingEnabled: true });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.dangerousFlags.includes("BILLING_ENABLED"));
  });

  it("collects every dangerous flag when several are on", () => {
    const v = verdict({
      brokerEnforcementEnabled: true,
      enableTradovateOrderActions: true,
      billingEnabled: true,
    });
    assert.equal(v.status, "NO_GO");
    assert.equal(v.dangerousFlags.length, 3);
  });
});

// ── Missing required-for-beta env ────────────────────────────────────────────

describe("derivePreBetaEnvVerdict — missing required env", () => {
  it("NO_GO when Tradovate OAuth env is incomplete", () => {
    const v = verdict({}, { tradovateClientSecret: false });
    assert.equal(v.status, "NO_GO");
    assert.ok(v.missingRequiredForBeta.includes("TRADOVATE_CLIENT_SECRET"));
  });

  it("lists every missing Tradovate OAuth var", () => {
    const v = verdict(
      {},
      {
        tradovateTokenEncryptionKey: false,
        tradovateClientId: false,
        tradovateClientSecret: false,
      },
    );
    assert.equal(v.status, "NO_GO");
    assert.equal(v.missingRequiredForBeta.length, 3);
  });
});

// ── Non-blocking notes ───────────────────────────────────────────────────────

describe("derivePreBetaEnvVerdict — non-blocking notes", () => {
  it("ENFORCEMENT_DRY_RUN false is a note, not a NO_GO (master gate already off)", () => {
    const v = verdict({ enforcementDryRun: false });
    assert.equal(v.status, "GO");
    assert.ok(v.notes.some((n) => n.includes("ENFORCEMENT_DRY_RUN")));
  });

  it("incomplete Telegram env is a note, not a NO_GO", () => {
    const v = verdict({}, { telegramBotToken: false });
    assert.equal(v.status, "GO");
    assert.ok(v.notes.some((n) => n.includes("Telegram env is incomplete")));
  });

  it("telegramScopedOut marks incomplete Telegram env as acceptable", () => {
    const v = verdict({}, { telegramBotToken: false }, true);
    assert.equal(v.status, "GO");
    assert.ok(v.notes.some((n) => n.includes("explicitly scoped out")));
  });

  it("billing off adds a Stripe-inert note", () => {
    const v = verdict();
    assert.ok(v.notes.some((n) => n.includes("Stripe env is inert")));
  });

  it("always notes the listener/cron web-runtime caveat", () => {
    const v = verdict();
    assert.ok(v.notes.some((n) => n.includes("separate Railway services")));
  });
});
