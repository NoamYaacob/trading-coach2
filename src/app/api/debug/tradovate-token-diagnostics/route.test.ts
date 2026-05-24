/**
 * Tests for GET /api/debug/tradovate-token-diagnostics.
 *
 * Source-scan tests — no DB, no network, no credentials required.
 * Verifies the structural guarantees of the endpoint:
 *   - admin-gated (getCurrentUser + isAdminEmail)
 *   - read-only (no DB writes, no Tradovate calls)
 *   - never returns encrypted token fields
 *   - correct case A/B/C classification logic
 *   - no Tradovate client import or write path
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE_FILE, "utf8");
}

// ── Auth gate ────────────────────────────────────────────────────────────────

describe("GET /api/debug/tradovate-token-diagnostics: auth gate", () => {
  it("calls getCurrentUser for session auth", () => {
    const s = src();
    assert.ok(s.includes("getCurrentUser"), "route must call getCurrentUser");
  });

  it("calls isAdminEmail to enforce admin-only access", () => {
    const s = src();
    assert.ok(s.includes("isAdminEmail"), "route must call isAdminEmail");
  });

  it("returns 401 for unauthenticated requests", () => {
    const s = src();
    assert.ok(s.includes('status: 401'), "route must return 401 when not authenticated");
  });

  it("returns 403 for non-admin authenticated requests", () => {
    const s = src();
    assert.ok(s.includes('status: 403'), "route must return 403 for non-admin users");
  });

  it("also accepts x-cron-secret as alternative auth", () => {
    const s = src();
    assert.ok(s.includes('"x-cron-secret"'), "route must accept x-cron-secret header");
    assert.ok(s.includes("process.env.CRON_SECRET"), "route must validate against CRON_SECRET env var");
  });

  it("imports getCurrentUser from @/lib/auth", () => {
    const s = src();
    assert.ok(
      s.includes('"@/lib/auth"') || s.includes("'@/lib/auth'"),
      "must import getCurrentUser from @/lib/auth",
    );
  });

  it("imports isAdminEmail from @/lib/subscription", () => {
    const s = src();
    assert.ok(
      s.includes('"@/lib/subscription"') || s.includes("'@/lib/subscription'"),
      "must import isAdminEmail from @/lib/subscription",
    );
  });
});

// ── Read-only guarantee ───────────────────────────────────────────────────────

describe("GET /api/debug/tradovate-token-diagnostics: read-only", () => {
  it("does not call prisma.create, update, updateMany, delete, or upsert", () => {
    const s = src();
    const writeMethods = ["prisma.brokerConnection.create", "prisma.brokerConnection.update",
      "prisma.connectedAccount.update", ".delete(", ".upsert("];
    for (const method of writeMethods) {
      assert.ok(!s.includes(method), `route must not call ${method}`);
    }
  });

  it("only calls findMany on prisma (read-only DB operations)", () => {
    const s = src();
    // Strip comments to avoid false positives
    const noComments = s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(noComments.includes("findMany"), "route must use findMany to read connections");
    // updateMany must not appear (outside of comments)
    assert.ok(!noComments.includes(".updateMany("), "route must not call updateMany");
    assert.ok(!noComments.includes(".update("), "route must not call update");
  });

  it("does not use HTTP methods that write (no POST/PUT/PATCH/DELETE exports)", () => {
    const s = src();
    // The file should export GET only
    assert.ok(s.includes("export async function GET"), "route must export GET handler");
    assert.ok(!s.includes("export async function POST"), "route must not export POST handler");
    assert.ok(!s.includes("export async function PUT"), "route must not export PUT handler");
    assert.ok(!s.includes("export async function PATCH"), "route must not export PATCH handler");
    assert.ok(!s.includes("export async function DELETE"), "route must not export DELETE handler");
  });
});

// ── No encrypted token fields ────────────────────────────────────────────────

describe("GET /api/debug/tradovate-token-diagnostics: token field safety", () => {
  it("never includes accessTokenEncrypted in the response", () => {
    const s = src();
    // accessTokenEncrypted must NOT appear in any select or return shape
    const selectIdx = s.indexOf("select:");
    assert.ok(selectIdx !== -1, "route must have a prisma select block");
    // Check that accessTokenEncrypted is never used in a select
    assert.ok(
      !s.includes("accessTokenEncrypted: true"),
      "must not select accessTokenEncrypted — it must never be fetched",
    );
  });

  it("never includes refreshTokenEncrypted in the response object", () => {
    const s = src();
    // refreshTokenEncrypted may be fetched to derive refreshTokenExists, but
    // must never appear in the returned JSON object
    assert.ok(
      !s.includes("refreshTokenEncrypted:") || s.includes("refreshTokenExists"),
      "must derive refreshTokenExists from refreshTokenEncrypted rather than returning the field itself",
    );
    // The response object must not pass refreshTokenEncrypted through
    const returnIdx = s.indexOf("return {");
    assert.ok(returnIdx !== -1, "route must have a return statement");
    const returnBlock = s.slice(returnIdx);
    assert.ok(
      !returnBlock.includes("refreshTokenEncrypted"),
      "refreshTokenEncrypted must not appear in the returned response object",
    );
  });

  it("never includes accessTokenEncrypted in the returned response object", () => {
    const s = src();
    const returnIdx = s.indexOf("return {");
    assert.ok(returnIdx !== -1, "route must have a return statement");
    const returnBlock = s.slice(returnIdx);
    assert.ok(
      !returnBlock.includes("accessTokenEncrypted"),
      "accessTokenEncrypted must not appear in the returned response object",
    );
  });
});

// ── Case classification logic ────────────────────────────────────────────────

describe("GET /api/debug/tradovate-token-diagnostics: case classification", () => {
  it("defines case A as expired status with valid token", () => {
    const s = src();
    assert.ok(
      s.includes("A_valid_token_but_expired_status"),
      "must define Case A label 'A_valid_token_but_expired_status'",
    );
  });

  it("defines case B as expired token with refresh present and no auth failure", () => {
    const s = src();
    assert.ok(
      s.includes("B_expired_token_refresh_exists_transient"),
      "must define Case B label 'B_expired_token_refresh_exists_transient'",
    );
  });

  it("defines case C as genuine auth failure requiring reconnect", () => {
    const s = src();
    assert.ok(
      s.includes("C_true_auth_failure_reconnect_required"),
      "must define Case C label 'C_true_auth_failure_reconnect_required'",
    );
  });

  it("checks for invalid_grant as an auth-invalid marker (Case C trigger)", () => {
    const s = src();
    assert.ok(s.includes('"invalid_grant"'), "must check for invalid_grant in lastRenewError");
  });

  it("checks for revoked as an auth-invalid marker (Case C trigger)", () => {
    const s = src();
    assert.ok(s.includes('"revoked"'), "must check for revoked in lastRenewError");
  });

  it("checks for re-authorize as an auth-invalid marker (Case C trigger)", () => {
    const s = src();
    assert.ok(s.includes('"re-authorize"'), "must check for re-authorize in lastRenewError");
  });

  it("checks for reconnect as an auth-invalid marker (Case C trigger)", () => {
    const s = src();
    assert.ok(s.includes('"reconnect"'), "must check for reconnect in lastRenewError");
  });

  it("checks for refresh_token grant as an auth-invalid marker (Case C trigger)", () => {
    const s = src();
    assert.ok(
      s.includes('"refresh_token grant"'),
      "must check for 'refresh_token grant' in lastRenewError to catch the explicit rejection message",
    );
  });

  it("classifies 'Tradovate rejected the OAuth refresh_token grant. Re-authorize to reconnect.' as Case C", () => {
    const s = src();
    // Verify all substrings that appear in this real error message are covered by markers
    const errorMsg = "Tradovate rejected the OAuth refresh_token grant. Re-authorize to reconnect.";
    const markers = ["re-authorize", "reconnect", "refresh_token grant"];
    for (const marker of markers) {
      assert.ok(errorMsg.toLowerCase().includes(marker.toLowerCase()), `marker "${marker}" matches the real error message`);
      assert.ok(s.includes(`"${marker}"`), `route must include marker "${marker}"`);
    }
  });

  it("Case C also fires when no refresh token is stored", () => {
    const s = src();
    // Must have a path where refreshTokenExists=false leads to Case C
    assert.ok(
      s.includes("!refreshTokenExists") || s.includes("refreshTokenExists === false"),
      "Case C must trigger when no refresh token exists",
    );
  });

  it("includes selfHealEligible field computed per connection", () => {
    const s = src();
    assert.ok(s.includes("selfHealEligible"), "must compute and return selfHealEligible");
  });

  it("classifies non-expired connections as null (no case)", () => {
    const s = src();
    // classifyCase must return null when connectionStatus !== "expired"
    assert.ok(
      s.includes("connectionStatus !== \"expired\""),
      "must return null for non-expired connections",
    );
  });

  it("self-heal uses 25-minute lookahead and 2-hour window", () => {
    const s = src();
    // 25 * 60 * 1000 = 1,500,000 ms
    assert.ok(
      s.includes("25 * 60 * 1000") || s.includes("SELF_HEAL_LOOKAHEAD_MS"),
      "must use 25-minute lookahead for self-heal eligibility",
    );
    // 2 * 60 * 60 * 1000 = 7,200,000 ms
    assert.ok(
      s.includes("2 * 60 * 60 * 1000") || s.includes("SELF_HEAL_WINDOW_MS"),
      "must use 2-hour window for self-heal eligibility",
    );
  });
});

// ── No Tradovate client import or write path ─────────────────────────────────

describe("GET /api/debug/tradovate-token-diagnostics: no Tradovate client", () => {
  it("does not import from tradovate-client or tradovate-ensure-token", () => {
    const s = src();
    assert.ok(
      !s.includes("tradovate-client"),
      "must not import tradovate-client — no Tradovate API calls allowed",
    );
    assert.ok(
      !s.includes("tradovate-ensure-token"),
      "must not import tradovate-ensure-token — no token renewal calls allowed",
    );
  });

  it("does not import from tradovate-listener or tradovate-sync", () => {
    const s = src();
    assert.ok(
      !s.includes("tradovate-listener"),
      "must not import tradovate-listener",
    );
    assert.ok(
      !s.includes("tradovate-sync") && !s.includes("tradovate-account-sync"),
      "must not import tradovate-sync",
    );
  });

  it("does not call fetch or any HTTP client (no outbound requests)", () => {
    const s = src();
    // Strip comments
    const noComments = s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // Should not call global fetch (Tradovate calls go through tradovate-client)
    assert.ok(
      !noComments.includes("await fetch("),
      "must not call fetch — endpoint is purely DB-read with no outbound HTTP",
    );
  });

  it("scopes prisma query to tradovate platform only", () => {
    const s = src();
    assert.ok(
      s.includes('platform: "tradovate"'),
      "findMany must be scoped to platform: tradovate",
    );
  });
});
