/**
 * Source-scan tests for GET /api/debug/pre-beta-env-posture.
 *
 * The route imports the `@/lib/auth` path alias, which the project test
 * runner (`node --experimental-strip-types`) does not resolve, so the handler
 * cannot be dynamically imported. These tests inspect the route source
 * directly to lock down auth, read-only safety, and the no-broker contract —
 * the same audit pattern used by the other debug route tests. Behavioural
 * coverage of the verdict logic lives in `posture.test.ts`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_PATH = resolve(import.meta.dirname, "./route.ts");
const POSTURE_PATH = resolve(import.meta.dirname, "./posture.ts");

const ROUTE_SRC = readFileSync(ROUTE_PATH, "utf8");
const POSTURE_SRC = readFileSync(POSTURE_PATH, "utf8");

/** Route source with comments stripped — for write/mutation scans. */
function routeCode(): string {
  return ROUTE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Posture source with comments stripped. */
function postureCode(): string {
  return POSTURE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("pre-beta-env-posture: route files exist", () => {
  it("route.ts exists", () => {
    assert.ok(existsSync(ROUTE_PATH), "src/app/api/debug/pre-beta-env-posture/route.ts must exist");
  });

  it("posture.ts exists", () => {
    assert.ok(
      existsSync(POSTURE_PATH),
      "src/app/api/debug/pre-beta-env-posture/posture.ts must exist",
    );
  });
});

describe("pre-beta-env-posture: auth gate", () => {
  it("requires an authenticated user via getCurrentUser and returns 401", () => {
    assert.ok(ROUTE_SRC.includes("getCurrentUser"), "route must call getCurrentUser");
    assert.ok(/status:\s*401/.test(ROUTE_SRC), "unauthenticated callers must get 401");
  });

  it("requires the x-cron-secret header matching CRON_SECRET and returns 403", () => {
    assert.ok(ROUTE_SRC.includes("x-cron-secret"), "route must read the x-cron-secret header");
    assert.ok(ROUTE_SRC.includes("CRON_SECRET"), "route must compare against CRON_SECRET");
    assert.ok(/status:\s*403/.test(ROUTE_SRC), "missing/mismatched secret must get 403");
  });

  it("rejects when CRON_SECRET itself is unset (no open-by-default)", () => {
    assert.ok(
      /!expected/.test(ROUTE_SRC),
      "route must 403 when CRON_SECRET is unset, never fall open",
    );
  });
});

describe("pre-beta-env-posture: HTTP surface", () => {
  it("exports a GET handler", () => {
    assert.ok(/export\s+async\s+function\s+GET\b/.test(ROUTE_SRC), "route must export GET");
  });

  it("exports no mutating HTTP verbs", () => {
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.ok(
        !new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`).test(ROUTE_SRC),
        `route must not export a ${verb} handler — it is read-only`,
      );
    }
  });
});

describe("pre-beta-env-posture: read-only safety", () => {
  it("does not touch the database (no prisma usage at all)", () => {
    assert.ok(!/\bprisma\b/.test(routeCode()), "read-only diagnostic must not use prisma");
    assert.ok(!/\bprisma\b/.test(postureCode()), "posture module must not use prisma");
  });

  it("does not mutate process.env", () => {
    assert.ok(
      !/process\.env\.[A-Za-z0-9_]+\s*=[^=]/.test(routeCode()),
      "route must never assign to process.env",
    );
    assert.ok(
      !/process\.env\b/.test(postureCode()),
      "posture module must not reach into process.env — env is passed in",
    );
  });

  it("does not import Tradovate / broker modules", () => {
    // Inspect import statements only — prose strings may mention "Tradovate"
    // (e.g. "required for the Tradovate OAuth flow") and that is fine. What
    // must never happen is pulling in broker code that could place orders.
    const importLines = [
      ...ROUTE_SRC.matchAll(/^\s*import\b.*$/gm),
      ...POSTURE_SRC.matchAll(/^\s*import\b.*$/gm),
    ].map((m) => m[0]);
    for (const line of importLines) {
      assert.ok(
        !/tradovate|broker|guardian-engine/i.test(line),
        `import must not reference Tradovate/broker code: ${line.trim()}`,
      );
    }
  });

  it("does not call broker / Tradovate functions", () => {
    const combined = routeCode() + "\n" + postureCode();
    assert.ok(
      !/\b(ensureTradovateAccessToken|placeOrder|syncDailyLoss|evaluateBrokerEnforcement)\b/.test(
        combined,
      ),
      "neither file may invoke broker enforcement / order / sync functions",
    );
  });
});

describe("pre-beta-env-posture: delegates verdict logic to posture.ts", () => {
  it("imports buildRuntimePosture from the sibling posture module", () => {
    assert.ok(
      /import\s*\{[^}]*buildRuntimePosture[^}]*\}\s*from\s*["']\.\/posture["']/.test(ROUTE_SRC),
      "route must import buildRuntimePosture from ./posture",
    );
    assert.ok(
      ROUTE_SRC.includes("buildRuntimePosture(process.env)"),
      "route must evaluate posture from process.env",
    );
  });

  it("returns the verdict shape (status/reasons/dangerousFlags/missing/notes)", () => {
    for (const field of [
      "status",
      "reasons",
      "dangerousFlags",
      "missingRequiredForBeta",
      "notes",
    ]) {
      assert.ok(ROUTE_SRC.includes(field), `response must include the '${field}' field`);
    }
  });

  it("reports interpreted flags and presence-only secrets, not raw values", () => {
    assert.ok(ROUTE_SRC.includes("flags:"), "response must include interpreted flags");
    assert.ok(
      ROUTE_SRC.includes("secretsPresent:"),
      "response must include presence-only secret booleans",
    );
  });
});

describe("pre-beta-env-posture: posture module covers the documented env", () => {
  it("interprets all 7 operational flags", () => {
    for (const flag of [
      "BROKER_ENFORCEMENT_ENABLED",
      "ENFORCEMENT_DRY_RUN",
      "BROKER_ENFORCEMENT_SIMULATION_ENABLED",
      "ENABLE_TRADOVATE_ORDER_ACTIONS",
      "TRADOVATE_LISTENER_ENABLE_LIVE",
      "GUARDRAIL_INTERNAL_LOCK_ENABLED",
      "BILLING_ENABLED",
    ]) {
      assert.ok(POSTURE_SRC.includes(flag), `posture must cover the ${flag} flag`);
    }
  });

  it("checks presence of all 9 secret-bearing vars", () => {
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
      assert.ok(POSTURE_SRC.includes(key), `posture must check presence of ${key}`);
    }
  });

  it("marks listener-worker / cron as unknown_from_web_runtime", () => {
    assert.ok(
      POSTURE_SRC.includes("unknown_from_web_runtime"),
      "posture must report listener-worker/cron as unknown_from_web_runtime",
    );
  });
});
