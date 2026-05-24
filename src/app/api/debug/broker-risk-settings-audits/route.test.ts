/**
 * Source-scan tests for GET /api/debug/broker-risk-settings-audits.
 *
 * Verifies the safety contract without running the route:
 *   - Session auth + x-cron-secret gates
 *   - User-scoped account lookup (userId filter)
 *   - Read-only Prisma queries only
 *   - No TradovateClient import, no broker calls, no env mutations
 *   - No secret values returned
 *   - Sorted newest first (orderBy: createdAt desc)
 *   - limit capped at MAX_LIMIT
 *   - hasAnySuccess / hasAnyBrokerWrite computed from audit rows
 *   - latestRecoveryPreview derived from preview rows
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE, "utf8");
}

function codeOnly(): string {
  let s = src();
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/(^|[^:])\/\/.*$/gm, "$1");
  return s;
}

// ── Auth gates ──────────────────────────────────────────────────────────────

describe("broker-risk-settings-audits: auth gates", () => {
  it("requires authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"'));
    assert.ok(s.includes("401"));
  });

  it("requires x-cron-secret header matching CRON_SECRET (403)", () => {
    const s = src();
    assert.ok(s.includes("x-cron-secret"), "must check x-cron-secret header");
    assert.ok(s.includes("CRON_SECRET"), "must reference CRON_SECRET env var");
    assert.ok(s.includes('"forbidden"'));
    assert.ok(s.includes("403"));
  });

  it("requires accountId query param (400)", () => {
    const s = src();
    assert.ok(s.includes("accountId"), "must require accountId param");
    assert.ok(s.includes("400"));
  });

  it("does not assign to process.env.CRON_SECRET", () => {
    const s = src();
    assert.ok(!/process\.env\.CRON_SECRET\s*=/.test(s), "must not assign to CRON_SECRET");
  });
});

// ── User scope ──────────────────────────────────────────────────────────────

describe("broker-risk-settings-audits: user scope", () => {
  it("filters account lookup by userId from current session", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("userId: currentUser.id"),
      "account lookup must be scoped to currentUser.id",
    );
  });

  it("returns 404 when account not found for user", () => {
    const s = src();
    assert.ok(s.includes('"account not found for this user"'));
    assert.ok(s.includes("404"));
  });

  it("filters audit query by accountId (derived from user-owned account)", () => {
    const s = codeOnly();
    assert.ok(
      s.includes("where: { accountId }"),
      "audit query must filter by accountId",
    );
  });
});

// ── Read-only contract ──────────────────────────────────────────────────────

describe("broker-risk-settings-audits: read-only contract", () => {
  it("does not call any Prisma write methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.create"), "no create");
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.update"), "no update");
    assert.ok(!s.includes("prisma.brokerRiskSettingsSyncAudit.delete"), "no delete");
    assert.ok(!s.includes("prisma.connectedAccount.update"), "no account update");
    assert.ok(!s.includes("prisma.connectedAccount.create"), "no account create");
    assert.ok(!s.includes(".upsert("), "no upsert");
    assert.ok(!s.includes(".deleteMany("), "no deleteMany");
    assert.ok(!s.includes(".updateMany("), "no updateMany");
  });

  it("does not import TradovateClient", () => {
    const s = codeOnly();
    assert.ok(!s.includes("TradovateClient"), "must not import TradovateClient");
    assert.ok(!s.includes("tradovate-client\""), "must not import tradovate-client module");
  });

  it("does not call any broker API methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("readDailyLossAutoLiqRecord"), "no broker read");
    assert.ok(!s.includes("applyDailyLossRecoveryUpdate"), "no broker write");
    assert.ok(!s.includes("applyDailyLossLock"), "no lock call");
    assert.ok(!s.includes("initialize("), "no client initialize");
    assert.ok(!s.includes("fetchToken"), "no token fetch");
  });

  it("does not import or call enforcement methods", () => {
    const s = codeOnly();
    assert.ok(!s.includes("applyBrokerDayLockout"), "no enforcement");
    assert.ok(!s.includes("triggerEnforcement"), "no enforcement");
    assert.ok(!s.includes("writeBrokerRiskSettingsSyncAudit"), "no audit write");
  });
});

// ── No secrets returned ─────────────────────────────────────────────────────

describe("broker-risk-settings-audits: no secrets in response", () => {
  it("does not select or return token fields", () => {
    const s = src();
    assert.ok(!s.includes("accessTokenEncrypted"), "no access token");
    assert.ok(!s.includes("refreshTokenEncrypted"), "no refresh token");
    assert.ok(!s.includes("accessToken"), "no plain access token");
  });

  it("does not echo CRON_SECRET value in response", () => {
    const s = codeOnly();
    assert.ok(
      !/NextResponse\.json\([^)]*CRON_SECRET/.test(s),
      "must not include CRON_SECRET in response",
    );
  });

  it("does not select brokerUserId or other sensitive broker fields", () => {
    const s = src();
    assert.ok(!s.includes("brokerUserId"), "no brokerUserId");
  });
});

// ── Query behaviour ─────────────────────────────────────────────────────────

describe("broker-risk-settings-audits: query behaviour", () => {
  it("sorts audits newest first (orderBy createdAt desc)", () => {
    const s = src();
    assert.ok(
      s.includes('orderBy: { createdAt: "desc" }'),
      "must order by createdAt descending",
    );
  });

  it("applies a take/limit to the audit query", () => {
    const s = src();
    assert.ok(s.includes("take: limit"), "must use take: limit");
  });

  it("caps limit at MAX_LIMIT", () => {
    const s = src();
    assert.ok(s.includes("Math.min(parsedLimit, MAX_LIMIT)"), "must cap at MAX_LIMIT");
  });

  it("defaults limit to DEFAULT_LIMIT when not provided", () => {
    const s = src();
    assert.ok(s.includes("DEFAULT_LIMIT"), "must use DEFAULT_LIMIT");
  });

  it("DEFAULT_LIMIT is 20 and MAX_LIMIT is 100", () => {
    const s = src();
    assert.ok(s.includes("const DEFAULT_LIMIT = 20"), "DEFAULT_LIMIT must be 20");
    assert.ok(s.includes("const MAX_LIMIT = 100"), "MAX_LIMIT must be 100");
  });

  it("uses groupBy to compute summary counts across all rows", () => {
    const s = src();
    assert.ok(s.includes("groupBy"), "must use groupBy for summary counts");
  });
});

// ── Summary and derived fields ──────────────────────────────────────────────

describe("broker-risk-settings-audits: summary and derived fields", () => {
  it("returns summary with success / failed / preview / gate_blocked / dry_run counts", () => {
    const s = src();
    assert.ok(s.includes('"success"'), "must count success");
    assert.ok(s.includes('"failed"'), "must count failed");
    assert.ok(s.includes('"preview"'), "must count preview");
    assert.ok(s.includes('"gate_blocked"'), "must count gate_blocked");
    assert.ok(s.includes('"dry_run"'), "must count dry_run");
  });

  it("returns hasAnySuccess based on summary.success count", () => {
    const s = src();
    assert.ok(s.includes("hasAnySuccess"), "must return hasAnySuccess");
    assert.ok(s.includes("summary.success > 0"), "hasAnySuccess must check success count");
  });

  it("returns hasAnyBrokerWrite checking outcome=success AND brokerResponseJson AND non-probe ruleType", () => {
    const s = src();
    assert.ok(s.includes("hasAnyBrokerWrite"), "must return hasAnyBrokerWrite");
    assert.ok(s.includes('outcome === "success"'), "must check outcome success");
    assert.ok(s.includes("brokerResponseJson != null"), "must check brokerResponseJson present");
    assert.ok(
      s.includes('"daily_loss_recovery_probe"'),
      "must exclude daily_loss_recovery_probe ruleType",
    );
  });

  it("returns latestRecoveryPreview for the most recent preview row", () => {
    const s = src();
    assert.ok(s.includes("latestRecoveryPreview"), "must return latestRecoveryPreview");
    assert.ok(
      s.includes('outcome === "preview"') && s.includes('"daily_loss_recovery_probe"'),
      "must filter for preview + daily_loss_recovery_probe",
    );
  });

  it("returns query metadata including limit and cap values", () => {
    const s = src();
    assert.ok(s.includes("query:"), "must return query metadata");
    assert.ok(s.includes("defaultLimit"), "must include defaultLimit");
    assert.ok(s.includes("maxLimit"), "must include maxLimit");
  });
});

// ── Response shape ──────────────────────────────────────────────────────────

describe("broker-risk-settings-audits: response shape", () => {
  it("returns ok: true", () => {
    const s = src();
    assert.ok(s.includes("ok: true"), "must return ok: true");
  });

  it("returns account summary with id, label, externalAccountId, platform, env, connectionStatus, permissionLevel", () => {
    const s = src();
    assert.ok(s.includes("id: account.id"), "must return account.id");
    assert.ok(s.includes("label: account.label"), "must return label");
    assert.ok(s.includes("externalAccountId"), "must return externalAccountId");
    assert.ok(s.includes("platform"), "must return platform");
    assert.ok(s.includes("permissionLevel"), "must return permissionLevel");
    assert.ok(s.includes("connectionStatus"), "must return connectionStatus");
  });

  it("includes a read-only note in response", () => {
    const s = src();
    assert.ok(
      s.includes("Read-only") || s.includes("read-only"),
      "must include read-only note",
    );
  });

  it("returns audits array", () => {
    const s = src();
    assert.ok(s.includes("audits:"), "must return audits array");
  });
});

// ── No env mutations ────────────────────────────────────────────────────────

describe("broker-risk-settings-audits: no env mutations", () => {
  it("does not assign to any process.env variable", () => {
    const s = codeOnly();
    assert.ok(!/process\.env\.[A-Z_]+ *=/.test(s), "must not assign to process.env");
  });

  it("does not reference BROKER_ENFORCEMENT_ENABLED toggle", () => {
    const s = src();
    assert.ok(
      !s.includes("BROKER_ENFORCEMENT_ENABLED"),
      "must not reference enforcement toggle",
    );
  });
});
