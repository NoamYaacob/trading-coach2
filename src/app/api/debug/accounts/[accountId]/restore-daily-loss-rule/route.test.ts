/**
 * Source-scan tests for POST /api/debug/accounts/[accountId]/restore-daily-loss-rule
 *
 * Verifies the route's safety contract without running it (no DB or network).
 * All assertions read the route source and check for structural patterns.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

/**
 * Returns the route source with all block and line comments stripped.
 * Used by forbidden-string scans so documentation can mention identifiers
 * (e.g. "No Tradovate API calls") without tripping the assertion.
 */
function codeOnly(): string {
  let s = src();
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return s;
}

// ── No Tradovate or broker calls ───────────────────────────────────────────────

describe("restore-daily-loss-rule: no Tradovate or broker calls", () => {
  it("route does NOT import TradovateClient", () => {
    const s = codeOnly();
    assert.ok(
      !s.includes("TradovateClient"),
      "route must not import or instantiate TradovateClient",
    );
  });

  it("route does NOT import from tradovate-client module", () => {
    const s = codeOnly();
    assert.ok(
      !s.includes("tradovate-client"),
      "route must not import from tradovate-client",
    );
  });

  it("route does NOT call Tradovate API paths", () => {
    const s = codeOnly();
    const forbidden = [
      "applyDailyLoss",
      "readDailyLossAutoLiq",
      "userAccountAutoLiq",
      "order/placeorder",
      "order/cancelorder",
      "order/liquidatepositions",
      "flattenOpenPositions",
      "applyBrokerDayLockout",
    ];
    for (const token of forbidden) {
      assert.ok(!s.includes(token), `route must not reference broker method: ${token}`);
    }
  });

  it("route does NOT call TradovateClient.initialize()", () => {
    const s = codeOnly();
    assert.ok(!s.includes(".initialize()"), "route must not call client.initialize()");
  });
});

// ── Authorization gates ────────────────────────────────────────────────────────

describe("restore-daily-loss-rule: authorization gates", () => {
  it("requires authenticated user via getCurrentUser() → 401", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"'), "must return unauthorized error string");
    assert.ok(s.includes("status: 401"), "must return HTTP 401");
  });

  it("requires admin email via isAdminEmail() → 403", () => {
    const s = src();
    assert.ok(s.includes("isAdminEmail"), "must call isAdminEmail");
    assert.ok(s.includes("admin_required"), "must return admin_required reason");
    assert.ok(s.includes("status: 403"), "must return HTTP 403 for non-admin");
  });

  it("requires x-cron-secret header matching CRON_SECRET → 403", () => {
    const s = src();
    assert.ok(s.includes('"x-cron-secret"'), "must read x-cron-secret header");
    assert.ok(s.includes("process.env.CRON_SECRET"), "must compare against CRON_SECRET env var");
    assert.ok(s.includes("cron_secret_required"), "must return cron_secret_required reason");
  });

  it("admin gate runs before cron-secret gate (non-admin cannot probe even with valid secret)", () => {
    const s = src();
    const adminIdx = s.indexOf("isAdminEmail(currentUser.email)");
    const cronIdx = s.indexOf('"x-cron-secret"');
    assert.ok(adminIdx !== -1 && cronIdx !== -1, "both gates must be present");
    assert.ok(adminIdx < cronIdx, "isAdminEmail must appear before x-cron-secret check");
  });

  it("requires account ownership (userId: currentUser.id filters the query)", () => {
    const s = src();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "account query must filter by userId to prevent cross-account access",
    );
  });

  it("requires explicit confirm phrase in body", () => {
    const s = src();
    assert.ok(
      s.includes("restore-daily-loss-rule"),
      "route must check for the confirm phrase string",
    );
    assert.ok(
      s.includes("confirm_phrase_required"),
      "route must return confirm_phrase_required when phrase is absent or wrong",
    );
  });
});

// ── Demo-only gate ─────────────────────────────────────────────────────────────

describe("restore-daily-loss-rule: demo-only enforcement", () => {
  it("fetches BrokerConnection.env to enforce demo vs live", () => {
    const s = src();
    assert.ok(
      s.includes("brokerConnection") && s.includes("env"),
      "route must fetch brokerConnection.env",
    );
    assert.ok(s.includes('"demo"'), "route must compare env against 'demo'");
  });

  it("blocks live accounts with 403 and live_accounts_blocked reason", () => {
    const s = src();
    assert.ok(s.includes("live_accounts_blocked"), "must return live_accounts_blocked for live accounts");
    assert.ok(s.includes("status: 403"), "live block must use HTTP 403");
  });

  it("demo_only reason covers non-live non-demo env (e.g. null)", () => {
    const s = src();
    assert.ok(s.includes("demo_only"), "must return demo_only reason for unknown/null env");
  });
});

// ── AccountRiskRules existence gate ───────────────────────────────────────────

describe("restore-daily-loss-rule: AccountRiskRules must already exist", () => {
  it("returns 404 when no AccountRiskRules row exists (no implicit creation)", () => {
    const s = src();
    assert.ok(
      s.includes("no_account_risk_rules"),
      "route must return no_account_risk_rules error when riskRules is absent",
    );
    assert.ok(
      s.includes("Cannot restore"),
      "error message must explain that the rule cannot be created by this endpoint",
    );
  });
});

// ── DB-only update ─────────────────────────────────────────────────────────────

describe("restore-daily-loss-rule: DB-only update to AccountRiskRules", () => {
  it("calls prisma.accountRiskRules.update (not create/upsert)", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("accountRiskRules.update"),
      "must call prisma.accountRiskRules.update",
    );
    assert.ok(
      !s.includes("accountRiskRules.create"),
      "must not call prisma.accountRiskRules.create",
    );
    assert.ok(
      !s.includes("accountRiskRules.upsert"),
      "must not call prisma.accountRiskRules.upsert",
    );
  });

  it("restores maxDailyLoss to 40 000", () => {
    const s = src();
    assert.ok(
      s.includes("40_000") || s.includes("40000"),
      "must restore maxDailyLoss to 40000",
    );
    assert.ok(
      s.includes("maxDailyLoss"),
      "update data must set the maxDailyLoss field",
    );
  });

  it("does NOT update liveSessionState", () => {
    const s = codeOnly();
    assert.ok(!s.includes("liveSessionState.update"), "must not modify liveSessionState");
  });

  it("does NOT update user-level riskRules", () => {
    const s = codeOnly();
    assert.ok(
      !s.includes("riskRules.update"),
      "must not modify user-level riskRules (only accountRiskRules)",
    );
  });

  it("does NOT update connectedAccount", () => {
    const s = codeOnly();
    assert.ok(!s.includes("connectedAccount.update"), "must not modify connectedAccount");
  });

  it("does NOT delete NormalizedTradeEvent rows", () => {
    const s = codeOnly();
    assert.ok(!s.includes("normalizedTradeEvent.delete"), "must not delete trade history");
  });

  it("does NOT delete GuardianIntervention rows", () => {
    const s = codeOnly();
    assert.ok(!s.includes("guardianIntervention.delete"), "must not delete intervention history");
  });

  it("does NOT update tradesCount, dailyPnl, or consecutiveLosses", () => {
    const s = codeOnly();
    assert.ok(!s.includes("tradesCount:"), "must not write tradesCount");
    assert.ok(!s.includes("dailyPnl:"), "must not write dailyPnl");
    assert.ok(!s.includes("consecutiveLosses:"), "must not write consecutiveLosses");
  });
});

// ── Response shape ─────────────────────────────────────────────────────────────

describe("restore-daily-loss-rule: response shape", () => {
  it("returns ok: true on success", () => {
    const s = src();
    assert.ok(s.includes("ok: true"), "success response must include ok: true");
  });

  it("returns before.maxDailyLoss (value before the update)", () => {
    const s = src();
    assert.ok(s.includes("before"), "response must include before field");
    assert.ok(s.includes("beforeMaxDailyLoss"), "must read and return the previous value");
  });

  it("returns after.maxDailyLoss set to RESTORE_MAX_DAILY_LOSS", () => {
    const s = src();
    assert.ok(s.includes("after"), "response must include after field");
    assert.ok(s.includes("RESTORE_MAX_DAILY_LOSS"), "after.maxDailyLoss must reference the restore constant");
  });

  it("note field confirms no Tradovate API calls were made", () => {
    const s = src();
    assert.ok(
      s.includes("No Tradovate") || s.includes("DB-only"),
      "response note must confirm no Tradovate API calls",
    );
  });
});

// ── No token fields in source ──────────────────────────────────────────────────

describe("restore-daily-loss-rule: no token fields referenced", () => {
  const FORBIDDEN_TOKENS = [
    "accessToken",
    "refreshToken",
    "tokenEncrypted",
    "accessTokenEncrypted",
    "refreshTokenEncrypted",
  ];

  for (const field of FORBIDDEN_TOKENS) {
    it(`does not reference token field '${field}'`, () => {
      assert.ok(
        !src().includes(field),
        `route must not reference token field: ${field}`,
      );
    });
  }
});
