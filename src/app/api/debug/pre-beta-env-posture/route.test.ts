/**
 * Source-scan tests for GET /api/debug/pre-beta-env-posture.
 *
 * Assert, without running the route, that it is auth-gated, read-only, never
 * emits a raw secret value, and makes no broker / DB calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("pre-beta-env-posture: auth", () => {
  it("requires an authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"') && s.includes("{ status: 401 }"));
  });

  it("requires the x-cron-secret header (403)", () => {
    const s = src();
    assert.ok(s.includes('"x-cron-secret"'), "must read the x-cron-secret header");
    assert.ok(s.includes("process.env.CRON_SECRET"), "must compare against CRON_SECRET");
    assert.ok(s.includes('"forbidden"') && s.includes("{ status: 403 }"));
  });
});

// ── Read-only ─────────────────────────────────────────────────────────────────

describe("pre-beta-env-posture: read-only", () => {
  it("performs no Prisma operations at all", () => {
    const s = src();
    assert.ok(!s.includes("prisma"), "endpoint must not touch the database");
    for (const op of [".create(", ".update(", ".upsert(", ".delete(", ".findFirst(", ".findUnique("]) {
      assert.ok(!s.includes(op), `endpoint must not call ${op}`);
    }
  });

  it("makes no broker calls", () => {
    const s = src();
    for (const forbidden of [
      "TradovateClient",
      "applyMaxPositionSize",
      "executeDailyLossSync",
      "tradovate-sync",
    ]) {
      assert.ok(!s.includes(forbidden), `endpoint must not reference "${forbidden}"`);
    }
  });

  it("does not mutate process.env", () => {
    const s = src();
    assert.ok(
      !/process\.env\.\w+\s*=[^=]/.test(s) && !/process\.env\[[^\]]+\]\s*=[^=]/.test(s),
      "endpoint must only read process.env, never assign to it",
    );
  });
});

// ── No secret values exposed ─────────────────────────────────────────────────

describe("pre-beta-env-posture: no secret exposure", () => {
  it("reads flags as interpreted booleans, not raw values", () => {
    assert.ok(
      src().includes('=== "true"'),
      "flags must be interpreted as process.env.X === \"true\"",
    );
  });

  it("reads secrets as presence booleans, not raw values", () => {
    assert.ok(
      src().includes("Boolean(process.env["),
      "secret env vars must be reported as Boolean(process.env[...]) presence only",
    );
  });

  it("never dot-accesses a secret env var (which would risk leaking it)", () => {
    const s = src();
    // Secrets are read via the present() helper with a string-literal name and
    // bracket access — never `process.env.SECRET_NAME`.
    for (const secret of [
      "process.env.TELEGRAM_BOT_TOKEN",
      "process.env.TELEGRAM_WEBHOOK_SECRET",
      "process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY",
      "process.env.TRADOVATE_CLIENT_SECRET",
      "process.env.STRIPE_SECRET_KEY",
      "process.env.STRIPE_WEBHOOK_SECRET",
    ]) {
      assert.ok(!s.includes(secret), `must not dot-access ${secret}`);
    }
  });

  it("the response embeds only the flags/presence boolean maps", () => {
    const s = src();
    assert.ok(s.includes("webRuntime: { flags, presence }"), "response must embed the boolean maps");
  });
});

// ── Verdict + structure ───────────────────────────────────────────────────────

describe("pre-beta-env-posture: verdict", () => {
  it("delegates the verdict to the pure derivePreBetaEnvVerdict helper", () => {
    const s = src();
    assert.ok(s.includes("derivePreBetaEnvVerdict"), "must use the pure verdict helper");
    assert.ok(s.includes('from "./posture"'), "must import the posture helper");
  });

  it("reports listener-worker and cron as unknown_from_web_runtime", () => {
    const s = src();
    assert.ok(
      s.includes('listenerWorker: "unknown_from_web_runtime"'),
      "listener-worker env is not visible from the web runtime",
    );
    assert.ok(
      s.includes('cron: "unknown_from_web_runtime"'),
      "cron env is not visible from the web runtime",
    );
  });

  it("interprets every required guided-beta flag", () => {
    const s = src();
    for (const name of [
      "BROKER_ENFORCEMENT_ENABLED",
      "ENFORCEMENT_DRY_RUN",
      "BROKER_ENFORCEMENT_SIMULATION_ENABLED",
      "ENABLE_TRADOVATE_ORDER_ACTIONS",
      "TRADOVATE_LISTENER_ENABLE_LIVE",
      "GUARDRAIL_INTERNAL_LOCK_ENABLED",
      "BILLING_ENABLED",
    ]) {
      assert.ok(s.includes(`"${name}"`), `route must read ${name}`);
    }
  });
});
