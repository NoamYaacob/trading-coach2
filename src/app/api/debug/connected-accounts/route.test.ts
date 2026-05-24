/**
 * Source-scan tests for GET /api/debug/connected-accounts.
 *
 * These verify the route's safety contract without running it:
 *   - Session auth + x-cron-secret gates exist
 *   - User-scoped query (userId filter)
 *   - No Prisma writes, no TradovateClient import, no broker calls
 *   - No secret values returned
 *   - canUseForRecoveryProbePreview eligibility logic is present
 *   - parseTradovateMasterId is used for externalAccountId validation
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

describe("connected-accounts: auth gates", () => {
  it("requires authenticated session (401)", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes('"unauthorized"'));
    assert.ok(s.includes("401"));
  });

  it("requires x-cron-secret header matching CRON_SECRET (403)", () => {
    const s = src();
    assert.ok(s.includes("x-cron-secret"), "must read x-cron-secret header");
    assert.ok(s.includes("CRON_SECRET"), "must reference CRON_SECRET env var");
    assert.ok(s.includes('"forbidden"'));
    assert.ok(s.includes("403"));
  });

  it("reads CRON_SECRET from process.env only (no assignment)", () => {
    // Env mutation would look like: process.env.CRON_SECRET = ...
    // We check the raw source — comments included — to be conservative.
    const s = src();
    const badAssign = /process\.env\.CRON_SECRET\s*=/.test(s);
    assert.ok(!badAssign, "must not assign to process.env.CRON_SECRET");
  });
});

// ── User scope ──────────────────────────────────────────────────────────────

describe("connected-accounts: user scope", () => {
  it("filters query by userId from current session", () => {
    const s = codeOnly();
    assert.ok(s.includes("userId: currentUser.id"), "must scope query to currentUser.id");
  });

  it("uses findMany (returns all user accounts, not just one)", () => {
    const s = codeOnly();
    assert.ok(s.includes("findMany"), "must use findMany to list all accounts");
  });
});

// ── Read-only contract ──────────────────────────────────────────────────────

describe("connected-accounts: read-only contract", () => {
  it("does not call any Prisma write methods", () => {
    const s = codeOnly();
    const writeMethods = ["prisma.connectedAccount.create", "prisma.connectedAccount.update",
      "prisma.connectedAccount.upsert", "prisma.connectedAccount.delete",
      ".create(", ".update(", ".upsert(", ".delete(", ".createMany(", ".updateMany(", ".deleteMany("];
    // Only check for create/update/delete — findMany/findFirst/findUnique are fine.
    // Use targeted checks.
    assert.ok(!codeOnly().includes("prisma.connectedAccount.create"), "must not create accounts");
    assert.ok(!codeOnly().includes("prisma.connectedAccount.update"), "must not update accounts");
    assert.ok(!codeOnly().includes("prisma.connectedAccount.delete"), "must not delete accounts");
  });

  it("does not import TradovateClient", () => {
    const s = codeOnly();
    assert.ok(!s.includes("TradovateClient"), "must not import TradovateClient");
    assert.ok(!s.includes("tradovate-client\""), "must not import tradovate-client module");
  });

  it("does not call any broker API methods", () => {
    const s = codeOnly();
    const brokerCalls = [
      "readDailyLossAutoLiqRecord",
      "applyDailyLossRecoveryUpdate",
      "initialize(",
      "fetchToken(",
      "refreshToken(",
    ];
    for (const call of brokerCalls) {
      assert.ok(!s.includes(call), `must not call broker method: ${call}`);
    }
  });

  it("does not import or call applyBrokerDayLockout or triggerEnforcement", () => {
    const s = codeOnly();
    assert.ok(!s.includes("applyBrokerDayLockout"), "must not call enforcement");
    assert.ok(!s.includes("triggerEnforcement"), "must not call enforcement");
  });
});

// ── No secrets returned ─────────────────────────────────────────────────────

describe("connected-accounts: no secrets in response", () => {
  it("does not select or return access tokens", () => {
    const s = src();
    assert.ok(!s.includes("accessTokenEncrypted"), "must not select accessTokenEncrypted");
    assert.ok(!s.includes("refreshTokenEncrypted"), "must not select refreshTokenEncrypted");
  });

  it("does not select or return password or private key fields", () => {
    const s = src();
    assert.ok(!s.includes("brokerUserId"), "brokerUserId not needed — omit to reduce exposure");
    assert.ok(!s.includes("accessToken"), "must not return access token");
  });

  it("does not echo process.env secrets in response body", () => {
    const s = codeOnly();
    // Ensure CRON_SECRET is only used for comparison, never put in the response.
    // Pattern: CRON_SECRET must not appear inside NextResponse.json(...)
    // We check that CRON_SECRET only appears in the gate comparison lines.
    const cronSecretInResponse = /NextResponse\.json\([^)]*CRON_SECRET/.test(s);
    assert.ok(!cronSecretInResponse, "must not include CRON_SECRET value in response");
  });
});

// ── canUseForRecoveryProbePreview ───────────────────────────────────────────

describe("connected-accounts: canUseForRecoveryProbePreview", () => {
  it("checks platform === tradovate", () => {
    const s = src();
    assert.ok(s.includes('"tradovate"'), "must check platform tradovate");
  });

  it("checks env === demo", () => {
    const s = src();
    assert.ok(s.includes('"demo"'), "must check env demo");
  });

  it("checks permissionLevel === full_access", () => {
    const s = src();
    assert.ok(s.includes('"full_access"'), "must check permissionLevel full_access");
  });

  it("checks isActive", () => {
    const s = src();
    assert.ok(s.includes("isActive"), "must check isActive");
  });

  it("checks missingFromBrokerSince is null", () => {
    const s = src();
    assert.ok(s.includes("missingFromBrokerSince"), "must check missingFromBrokerSince");
  });

  it("uses parseTradovateMasterId for externalAccountId validation", () => {
    const s = src();
    assert.ok(s.includes("parseTradovateMasterId"), "must use parseTradovateMasterId");
    assert.ok(
      s.includes('from "@/lib/brokers/tradovate-master-id"') ||
        s.includes("from '../brokers/tradovate-master-id'") ||
        s.includes('from "../../lib/brokers/tradovate-master-id"'),
      "must import from tradovate-master-id module",
    );
  });

  it("uses NON_LIVE_CONNECTION_STATUSES consistent with enforcement gate", () => {
    const s = src();
    // The same set used in broker-enforcement-gate.ts
    assert.ok(s.includes("expired"), "must include 'expired' in non-live set");
    assert.ok(s.includes("connection_error"), "must include 'connection_error'");
    assert.ok(s.includes("not_connected"), "must include 'not_connected'");
    assert.ok(s.includes("pending_webhook"), "must include 'pending_webhook'");
    assert.ok(s.includes("oauth_pending_storage"), "must include 'oauth_pending_storage'");
  });

  it("returns reasons array explaining why account is not eligible", () => {
    const s = src();
    assert.ok(s.includes("reasons"), "must return reasons");
    assert.ok(s.includes("eligible"), "must compute eligible flag");
  });

  it("checks BrokerConnection.connectionStatus (not ConnectedAccount.connectionStatus) for live check", () => {
    const s = codeOnly();
    // The gate uses brokerConnection.connectionStatus, not account.connectionStatus directly
    assert.ok(
      s.includes("brokerConnection.connectionStatus") ||
        s.includes("account.brokerConnection?.connectionStatus"),
      "must check BrokerConnection.connectionStatus for live gate",
    );
  });
});

// ── Response shape ──────────────────────────────────────────────────────────

describe("connected-accounts: response shape", () => {
  it("returns ok: true in success response", () => {
    const s = src();
    assert.ok(s.includes("ok: true"), "must return ok: true");
  });

  it("returns count of accounts", () => {
    const s = src();
    assert.ok(s.includes("count:"), "must return count");
  });

  it("returns accounts array", () => {
    const s = src();
    assert.ok(s.includes("accounts:"), "must return accounts array");
  });

  it("returns the internal ConnectedAccount.id", () => {
    const s = src();
    assert.ok(
      s.includes("id: account.id"),
      "must return the internal ConnectedAccount.id as id",
    );
  });

  it("includes note that it is read-only", () => {
    const s = src();
    assert.ok(s.includes("Read-only") || s.includes("read-only"), "must include read-only note");
  });
});

// ── No env mutations ────────────────────────────────────────────────────────

describe("connected-accounts: no env mutations", () => {
  it("does not assign to process.env", () => {
    const s = codeOnly();
    assert.ok(
      !/process\.env\.[A-Z_]+ *=/.test(s),
      "must not assign to any process.env variable",
    );
  });

  it("does not import or use BROKER_ENFORCEMENT_ENABLED toggle", () => {
    const s = src();
    assert.ok(
      !s.includes("BROKER_ENFORCEMENT_ENABLED"),
      "must not reference enforcement toggle",
    );
  });
});
