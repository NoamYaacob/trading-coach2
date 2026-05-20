/**
 * Source-scan security tests for /api/debug/tradovate-event and related
 * validation-plan debug endpoints.
 *
 * These tests read the source files and assert the presence (or absence) of
 * critical security patterns. They catch accidental removal of guards during
 * future refactors without requiring a running server or DB.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "../../../.."); // = src/

function src(relPath: string): string {
  return readFileSync(join(SRC, relPath), "utf8");
}

// ── /api/debug/tradovate-event ────────────────────────────────────────────────

describe("debug/tradovate-event — security gates", () => {
  const route = src("app/api/debug/tradovate-event/route.ts");

  it("is gated on DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED=true", () => {
    assert.ok(
      route.includes("DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED"),
      "must check DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED env var",
    );
    assert.ok(
      route.includes('!== "true"'),
      "must reject when flag is not exactly 'true'",
    );
  });

  it("returns 404 in production (NODE_ENV guard)", () => {
    assert.ok(
      route.includes('NODE_ENV') && route.includes('"production"'),
      "must block when NODE_ENV=production",
    );
    assert.ok(route.includes("status: 404"), "must return 404 not a 4xx error");
  });

  it("requires authenticated user session", () => {
    assert.ok(
      route.includes("getCurrentUser"),
      "must call getCurrentUser()",
    );
    assert.ok(
      route.includes("status: 401"),
      "must return 401 when no session",
    );
  });

  it("requires admin email check", () => {
    assert.ok(
      route.includes("isAdminEmail"),
      "must call isAdminEmail()",
    );
    assert.ok(
      route.includes("status: 403"),
      "must return 403 for non-admin",
    );
  });

  it("requires account allowlist", () => {
    assert.ok(
      route.includes("DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST"),
      "must check DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST",
    );
    assert.ok(
      route.includes("allowlist"),
      "must enforce allowlist check",
    );
  });

  it("marks injected events as synthetic in rawPayload", () => {
    assert.ok(
      route.includes("_debugInjection"),
      "must embed _debugInjection marker in rawPayload",
    );
    assert.ok(
      route.includes("synthetic: true"),
      "must set synthetic flag",
    );
  });

  it("uses createMany skipDuplicates to honour dedup constraint", () => {
    assert.ok(
      route.includes("createMany") && route.includes("skipDuplicates"),
      "must use createMany+skipDuplicates — not bare create()",
    );
    assert.ok(
      !route.includes("normalizedTradeEvent.create("),
      "must NOT use bare .create() which throws on duplicate externalTradeId",
    );
  });

  it("does NOT import or call any Tradovate API client", () => {
    const brokerApiPatterns = [
      "tradovateApi",
      "userAccountAutoLiq",
      "liquidatepositions",
      "cancelOrder",
      "placeOrder",
      "order/liquidate",
    ];
    for (const pattern of brokerApiPatterns) {
      assert.ok(
        !route.includes(pattern),
        `must NOT import or call broker API pattern: ${pattern}`,
      );
    }
  });

  it("does NOT import order action modules", () => {
    // Check for actual import statements of broker action modules.
    const orderModuleImports = [
      "broker-order-action",
      "order-actions",
      "cancel-orders",
      "from.*flatten",
      "import.*flatten",
    ];
    for (const pattern of orderModuleImports) {
      const re = new RegExp(pattern, "i");
      assert.ok(
        !re.test(route),
        `must NOT import order action module matching: ${pattern}`,
      );
    }
  });
});

// ── /api/debug/tradovate-listener/dry-run-violations ─────────────────────────

describe("debug/dry-run-violations — auth gates", () => {
  const route = src("app/api/debug/tradovate-listener/dry-run-violations/route.ts");

  it("requires authenticated session", () => {
    assert.ok(route.includes("getCurrentUser"), "must call getCurrentUser()");
    assert.ok(route.includes("status: 401"), "must return 401");
  });

  it("requires x-cron-secret header", () => {
    assert.ok(route.includes("x-cron-secret"), "must check x-cron-secret header");
    assert.ok(route.includes("CRON_SECRET"), "must compare against CRON_SECRET env");
    assert.ok(route.includes("status: 403"), "must return 403");
  });

  it("is read-only — no create/update/delete calls", () => {
    assert.ok(!route.includes(".create("), "must not create rows");
    assert.ok(!route.includes(".update("), "must not update rows");
    assert.ok(!route.includes(".delete("), "must not delete rows");
  });

  it("does NOT call any Tradovate API", () => {
    assert.ok(!route.includes("tradovateApi"), "must not call Tradovate");
    assert.ok(!route.includes("userAccountAutoLiq"), "must not call broker lock");
  });
});

// ── /api/debug/broker-enforcement-gates ──────────────────────────────────────

describe("debug/broker-enforcement-gates — auth and safety", () => {
  const route = src("app/api/debug/broker-enforcement-gates/route.ts");

  it("requires authenticated session + x-cron-secret", () => {
    assert.ok(route.includes("getCurrentUser"), "session required");
    assert.ok(route.includes("x-cron-secret"), "cron secret required");
    assert.ok(route.includes("CRON_SECRET"), "compared against env");
  });

  it("is read-only", () => {
    assert.ok(!route.includes(".create("), "no create");
    assert.ok(!route.includes(".update("), "no update");
    assert.ok(!route.includes(".delete("), "no delete");
  });

  it("does NOT call Tradovate API", () => {
    assert.ok(!route.includes("tradovateApi"), "no broker API calls");
    assert.ok(!route.includes("userAccountAutoLiq"), "no lock endpoint");
    assert.ok(!route.includes("liquidatepositions"), "no flatten endpoint");
  });

  it("includes a read-only note in response", () => {
    assert.ok(
      route.includes("Read-only") || route.includes("read-only") || route.includes("no writes"),
      "must include read-only note in response",
    );
  });
});

// ── /api/debug/broker-enforcement-simulation ─────────────────────────────────

describe("debug/broker-enforcement-simulation — simulation gates", () => {
  const route = src("app/api/debug/broker-enforcement-simulation/route.ts");

  it("requires BROKER_ENFORCEMENT_SIMULATION_ENABLED=true", () => {
    assert.ok(
      route.includes("BROKER_ENFORCEMENT_SIMULATION_ENABLED"),
      "must check simulation flag",
    );
  });

  it("requires authenticated session + x-cron-secret", () => {
    assert.ok(route.includes("getCurrentUser"), "session required");
    assert.ok(route.includes("x-cron-secret"), "cron secret required");
  });

  it("is read-only — no DB writes", () => {
    assert.ok(!route.includes(".create("), "no create");
    assert.ok(!route.includes(".update("), "no update");
    assert.ok(!route.includes(".delete("), "no delete");
  });

  it("does NOT call Tradovate API", () => {
    assert.ok(!route.includes("tradovateApi"), "no broker calls");
    assert.ok(!route.includes("userAccountAutoLiq"), "no lock calls");
    assert.ok(!route.includes("liquidatepositions"), "no flatten calls");
  });

  it("BROKER_ENFORCEMENT_ENABLED is not set to true inside the handler", () => {
    assert.ok(
      !route.includes('BROKER_ENFORCEMENT_ENABLED" ] = "true"') &&
        !route.includes("BROKER_ENFORCEMENT_ENABLED=true"),
      "must never set BROKER_ENFORCEMENT_ENABLED=true",
    );
  });
});

// ── /api/debug/accounts/[accountId]/reset-session-state ──────────────────────

describe("debug/reset-session-state — auth and safety", () => {
  const route = src("app/api/debug/accounts/[accountId]/reset-session-state/route.ts");

  it("requires authenticated session", () => {
    assert.ok(route.includes("getCurrentUser"), "session required");
    assert.ok(route.includes("status: 401"), "401 on no session");
  });

  it("requires x-cron-secret in production", () => {
    assert.ok(route.includes("isProduction") || route.includes('NODE_ENV'), "checks production env");
    assert.ok(route.includes("x-cron-secret"), "requires cron secret in prod");
    assert.ok(route.includes("status: 403"), "403 on missing secret in prod");
  });

  it("enforces ownership — account must belong to current user", () => {
    assert.ok(
      route.includes("userId: currentUser.id"),
      "must filter by userId to enforce ownership",
    );
  });

  it("does NOT call Tradovate API or place broker writes", () => {
    assert.ok(!route.includes("tradovateApi"), "no Tradovate API calls");
    assert.ok(!route.includes("userAccountAutoLiq"), "no broker lock endpoint");
    assert.ok(!route.includes("liquidatepositions"), "no flatten endpoint");
    assert.ok(!route.includes("cancelOrder"), "no cancel order endpoint");
  });

  it("only resets riskState and lock state — does not touch P&L or trade history", () => {
    assert.ok(route.includes("riskState"), "sets riskState");
    assert.ok(
      !route.includes("dailyPnl") || route.indexOf("dailyPnl") > route.indexOf("What is NOT"),
      "must not overwrite dailyPnl",
    );
  });
});

// ── /api/guardian/enable + disable — normal user scope ───────────────────────

describe("guardian/enable + guardian/disable — user scope safety", () => {
  const enableRoute = src("app/api/guardian/enable/route.ts");
  const disableRoute = src("app/api/guardian/disable/route.ts");

  it("both routes require authenticated session", () => {
    assert.ok(enableRoute.includes("getCurrentUser"), "enable: session required");
    assert.ok(disableRoute.includes("getCurrentUser"), "disable: session required");
  });

  it("enable route sets guardianEnabled=true — not a broker write", () => {
    assert.ok(
      enableRoute.includes("guardianEnabled: true"),
      "enable: must set guardianEnabled=true",
    );
    assert.ok(!enableRoute.includes("tradovateApi"), "enable: no broker API calls");
    assert.ok(!enableRoute.includes("userAccountAutoLiq"), "enable: no lock calls");
  });

  it("disable route sets guardianEnabled=false — not a broker write", () => {
    assert.ok(
      disableRoute.includes("guardianEnabled: false"),
      "disable: must set guardianEnabled=false",
    );
    assert.ok(!disableRoute.includes("tradovateApi"), "disable: no broker API calls");
    assert.ok(!disableRoute.includes("userAccountAutoLiq"), "disable: no lock calls");
  });
});

// ── Cross-cutting: no validation endpoint can place/cancel/flatten orders ────

describe("no validation endpoint places or cancels orders", () => {
  const filesToCheck = [
    "app/api/debug/tradovate-event/route.ts",
    "app/api/debug/tradovate-listener/dry-run-violations/route.ts",
    "app/api/debug/broker-enforcement-gates/route.ts",
    "app/api/debug/broker-enforcement-simulation/route.ts",
    "app/api/debug/accounts/[accountId]/reset-session-state/route.ts",
    "app/api/guardian/enable/route.ts",
    "app/api/guardian/disable/route.ts",
  ];

  // These are the actual Tradovate API endpoint strings and order-action
  // function names. We check for these specifically, not generic words that
  // may appear in doc comments (e.g. "flatten" legitimately appears in
  // "Does NOT flatten positions").
  const forbiddenPatterns = [
    "userAccountAutoLiq",
    "liquidatepositions",
    "cancelOrder",
    "placeOrder",
    "order/place",
    "order/cancel",
    "order/liquidate",
    "broker-order-action",
  ];

  for (const file of filesToCheck) {
    it(`${file} contains no order/flatten/cancel patterns`, () => {
      const content = src(file);
      for (const pattern of forbiddenPatterns) {
        assert.ok(
          !content.toLowerCase().includes(pattern.toLowerCase()),
          `${file} must NOT contain: ${pattern}`,
        );
      }
    });
  }
});
