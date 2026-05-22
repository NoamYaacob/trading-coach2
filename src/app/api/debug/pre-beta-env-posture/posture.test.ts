/**
 * Behavioural tests for the pre-beta env-posture evaluator.
 *
 * `posture.ts` is a pure, import-free module, so it can be dynamically
 * imported and exercised directly by the `node --experimental-strip-types`
 * test runner — no Next.js handler or path-alias resolution required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimePosture,
  type EnvSource,
} from "./posture.ts";

/** Env that satisfies the guided-beta runbook exactly — expected GO. */
function runbookEnv(): EnvSource {
  return {
    // All guarded flags false/unset.
    BROKER_ENFORCEMENT_ENABLED: "false",
    ENABLE_TRADOVATE_ORDER_ACTIONS: "false",
    TRADOVATE_LISTENER_ENABLE_LIVE: "false",
    GUARDRAIL_INTERNAL_LOCK_ENABLED: "false",
    BILLING_ENABLED: "false",
    ENFORCEMENT_DRY_RUN: "true",
    // Required Tradovate OAuth/encryption env present.
    TRADOVATE_CLIENT_ID: "cid-value",
    TRADOVATE_CLIENT_SECRET: "csecret-value",
    TRADOVATE_TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };
}

describe("buildRuntimePosture: shape", () => {
  it("is a function", () => {
    assert.equal(typeof buildRuntimePosture, "function");
  });

  it("reports the 7 operational flags as interpreted booleans", () => {
    const { flags } = buildRuntimePosture(runbookEnv());
    for (const key of [
      "BROKER_ENFORCEMENT_ENABLED",
      "ENFORCEMENT_DRY_RUN",
      "BROKER_ENFORCEMENT_SIMULATION_ENABLED",
      "ENABLE_TRADOVATE_ORDER_ACTIONS",
      "TRADOVATE_LISTENER_ENABLE_LIVE",
      "GUARDRAIL_INTERNAL_LOCK_ENABLED",
      "BILLING_ENABLED",
    ]) {
      assert.equal(typeof flags[key], "boolean", `${key} must be a boolean`);
    }
  });

  it("interprets only the literal string 'true' as true", () => {
    const { flags } = buildRuntimePosture({
      BROKER_ENFORCEMENT_ENABLED: "TRUE",
      ENABLE_TRADOVATE_ORDER_ACTIONS: "1",
      BILLING_ENABLED: "yes",
    });
    assert.equal(flags.BROKER_ENFORCEMENT_ENABLED, false);
    assert.equal(flags.ENABLE_TRADOVATE_ORDER_ACTIONS, false);
    assert.equal(flags.BILLING_ENABLED, false);
  });

  it("reports the 9 secret-bearing vars as presence-only booleans", () => {
    const { secretsPresent } = buildRuntimePosture(runbookEnv());
    for (const key of [
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "TRADOVATE_TOKEN_ENCRYPTION_KEY",
      "TRADOVATE_CLIENT_ID",
      "TRADOVATE_CLIENT_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_STRIPE_PRICE_ID",
    ]) {
      assert.equal(
        typeof secretsPresent[key],
        "boolean",
        `${key} must be presence-only boolean`,
      );
    }
  });
});

describe("buildRuntimePosture: never exposes raw secret values", () => {
  it("does not copy any raw secret value into the result", () => {
    const secrets = {
      TELEGRAM_BOT_USERNAME: "RAW_telegram_username_XYZ",
      TELEGRAM_BOT_TOKEN: "RAW_telegram_token_XYZ",
      TELEGRAM_WEBHOOK_SECRET: "RAW_telegram_webhook_XYZ",
      TRADOVATE_TOKEN_ENCRYPTION_KEY: "RAW_encryption_key_XYZ",
      TRADOVATE_CLIENT_ID: "RAW_client_id_XYZ",
      TRADOVATE_CLIENT_SECRET: "RAW_client_secret_XYZ",
      STRIPE_SECRET_KEY: "RAW_stripe_secret_XYZ",
      STRIPE_WEBHOOK_SECRET: "RAW_stripe_webhook_XYZ",
      NEXT_PUBLIC_STRIPE_PRICE_ID: "RAW_price_id_XYZ",
    };
    const result = buildRuntimePosture(secrets);
    const serialised = JSON.stringify(result);
    for (const value of Object.values(secrets)) {
      assert.ok(
        !serialised.includes(value),
        `raw secret value "${value}" must never appear in the posture result`,
      );
    }
    // Presence is still reported as `true`.
    for (const key of Object.keys(secrets)) {
      assert.equal(result.secretsPresent[key], true);
    }
  });

  it("treats empty / whitespace-only values as not present", () => {
    const { secretsPresent } = buildRuntimePosture({
      TRADOVATE_CLIENT_ID: "",
      TRADOVATE_CLIENT_SECRET: "   ",
    });
    assert.equal(secretsPresent.TRADOVATE_CLIENT_ID, false);
    assert.equal(secretsPresent.TRADOVATE_CLIENT_SECRET, false);
  });
});

describe("buildRuntimePosture: NO_GO on dangerous flags", () => {
  it("returns NO_GO when BROKER_ENFORCEMENT_ENABLED is true", () => {
    const env = runbookEnv();
    env.BROKER_ENFORCEMENT_ENABLED = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.dangerousFlags.includes("BROKER_ENFORCEMENT_ENABLED"));
  });

  it("returns NO_GO when ENABLE_TRADOVATE_ORDER_ACTIONS is true", () => {
    const env = runbookEnv();
    env.ENABLE_TRADOVATE_ORDER_ACTIONS = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.dangerousFlags.includes("ENABLE_TRADOVATE_ORDER_ACTIONS"));
  });

  it("returns NO_GO when TRADOVATE_LISTENER_ENABLE_LIVE is true", () => {
    const env = runbookEnv();
    env.TRADOVATE_LISTENER_ENABLE_LIVE = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.dangerousFlags.includes("TRADOVATE_LISTENER_ENABLE_LIVE"));
  });

  it("returns NO_GO when GUARDRAIL_INTERNAL_LOCK_ENABLED is true", () => {
    const env = runbookEnv();
    env.GUARDRAIL_INTERNAL_LOCK_ENABLED = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.dangerousFlags.includes("GUARDRAIL_INTERNAL_LOCK_ENABLED"));
  });

  it("returns NO_GO when BILLING_ENABLED is true for the guided beta", () => {
    const env = runbookEnv();
    env.BILLING_ENABLED = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.dangerousFlags.includes("BILLING_ENABLED"));
  });

  it("collects every dangerous flag when several are enabled at once", () => {
    const { verdict } = buildRuntimePosture({
      ...runbookEnv(),
      BROKER_ENFORCEMENT_ENABLED: "true",
      ENABLE_TRADOVATE_ORDER_ACTIONS: "true",
      BILLING_ENABLED: "true",
    });
    assert.equal(verdict.status, "NO_GO");
    assert.equal(verdict.dangerousFlags.length, 3);
  });
});

describe("buildRuntimePosture: NO_GO on missing required env", () => {
  it("returns NO_GO and lists missing Tradovate OAuth/encryption env", () => {
    const env = runbookEnv();
    delete env.TRADOVATE_CLIENT_SECRET;
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "NO_GO");
    assert.ok(verdict.missingRequiredForBeta.includes("TRADOVATE_CLIENT_SECRET"));
  });
});

describe("buildRuntimePosture: GO when posture matches the runbook", () => {
  it("returns GO with no dangerous flags and nothing missing", () => {
    const { verdict } = buildRuntimePosture(runbookEnv());
    assert.equal(verdict.status, "GO");
    assert.deepEqual(verdict.dangerousFlags, []);
    assert.deepEqual(verdict.missingRequiredForBeta, []);
  });

  it("does not flag ENFORCEMENT_DRY_RUN when it is true", () => {
    const { verdict } = buildRuntimePosture(runbookEnv());
    assert.ok(
      !verdict.notes.some((n) => n.includes("ENFORCEMENT_DRY_RUN")),
      "no dry-run note expected when ENFORCEMENT_DRY_RUN is true",
    );
  });

  it("adds an advisory note (not a NO_GO) when ENFORCEMENT_DRY_RUN is not true", () => {
    const env = runbookEnv();
    env.ENFORCEMENT_DRY_RUN = "false";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "GO");
    assert.ok(
      verdict.notes.some((n) => n.includes("ENFORCEMENT_DRY_RUN")),
      "a dry-run advisory note is expected when ENFORCEMENT_DRY_RUN is not true",
    );
  });

  it("does not treat simulation-enabled as a dangerous flag", () => {
    const env = runbookEnv();
    env.BROKER_ENFORCEMENT_SIMULATION_ENABLED = "true";
    const { verdict } = buildRuntimePosture(env);
    assert.equal(verdict.status, "GO");
    assert.ok(!verdict.dangerousFlags.includes("BROKER_ENFORCEMENT_SIMULATION_ENABLED"));
  });
});

describe("buildRuntimePosture: separate-service reporting", () => {
  it("marks listener-worker and cron as unknown_from_web_runtime", () => {
    const { services } = buildRuntimePosture(runbookEnv());
    assert.equal(services.listenerWorker, "unknown_from_web_runtime");
    assert.equal(services.cron, "unknown_from_web_runtime");
    assert.match(services.note, /separate Railway services/i);
  });

  it("notes that listener-worker/cron must be verified separately", () => {
    const { verdict } = buildRuntimePosture(runbookEnv());
    assert.ok(
      verdict.notes.some((n) => /listener-worker and cron/i.test(n)),
      "verdict notes must mention verifying listener-worker/cron separately",
    );
  });
});

describe("buildRuntimePosture: purity (no env mutation)", () => {
  it("does not mutate the env source it is given", () => {
    const env = runbookEnv();
    const snapshot = JSON.stringify(env);
    buildRuntimePosture(env);
    assert.equal(JSON.stringify(env), snapshot, "env source must be untouched");
  });
});
