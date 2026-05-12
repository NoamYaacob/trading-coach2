/**
 * Source-scan tests for broker-side Max Position Size enforcement.
 *
 * These tests verify structural guarantees without a DB, network, or real
 * credentials. They guard against regressions where:
 *
 *  1. Broker sync logs leak token values.
 *  2. PATCH /api/accounts/[id] fails to trigger broker sync when maxContracts
 *     is included in the payload.
 *  3. POST /api/accounts/[id]/apply-pending fails to trigger broker sync after
 *     a successful promotion.
 *  4. The debug endpoint GET /api/debug/tradovate-position-limit has the
 *     required structural fields.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ACCOUNT_ROUTE = resolve(import.meta.dirname, "./route.ts");
const APPLY_PENDING_ROUTE = resolve(import.meta.dirname, "./apply-pending/route.ts");
const DEBUG_ENDPOINT = resolve(
  import.meta.dirname,
  "../../debug/tradovate-position-limit/route.ts",
);

function src(f: string): string {
  return readFileSync(f, "utf8");
}

// ── 1. Logging safety: tokens must never appear in logs ──────────────────────

describe("broker sync log safety", () => {
  it("PATCH /api/accounts/[id] broker sync log does not log token fields", () => {
    const s = src(ACCOUNT_ROUTE);
    // Find the accounts/patch broker sync log block
    const logIdx = s.indexOf("[accounts/patch] broker max position size synced");
    assert.ok(logIdx !== -1, "patch broker sync log must exist");
    // Grab a conservative window around the log statement
    const logBlock = s.slice(logIdx, logIdx + 500);
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted", "accessTokenEncrypted", "refreshTokenEncrypted"];
    for (const field of forbidden) {
      assert.ok(
        !logBlock.includes(field),
        `broker sync log must not include token field: ${field}`,
      );
    }
  });

  it("apply-pending broker sync log does not log token fields", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const logIdx = s.indexOf("[accounts/apply-pending] broker max position size synced");
    assert.ok(logIdx !== -1, "apply-pending broker sync log must exist");
    const logBlock = s.slice(logIdx, logIdx + 500);
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted", "accessTokenEncrypted", "refreshTokenEncrypted"];
    for (const field of forbidden) {
      assert.ok(
        !logBlock.includes(field),
        `apply-pending broker sync log must not include token field: ${field}`,
      );
    }
  });
});

// ── 2. PATCH route fires broker sync when maxContracts is in the payload ─────

describe("PATCH /api/accounts/[id]: broker max position size sync", () => {
  it("imports TradovateClient", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("TradovateClient"),
      "route must import TradovateClient",
    );
  });

  it("calls applyMaxPositionSize", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes("applyMaxPositionSize("),
      "route must call applyMaxPositionSize",
    );
  });

  it("checks maxContracts is present in the body before firing broker sync", () => {
    const s = src(ACCOUNT_ROUTE);
    assert.ok(
      s.includes('"maxContracts" in body.riskRules'),
      'route must check "maxContracts" in body.riskRules before firing broker sync',
    );
  });

  it("fires broker sync as fire-and-forget (void)", () => {
    const s = src(ACCOUNT_ROUTE);
    // The broker sync must be fire-and-forget
    assert.ok(
      s.includes("void (async"),
      "broker sync must be fire-and-forget with void",
    );
  });

  it("wraps broker sync in try/catch so DB save is never rolled back", () => {
    const s = src(ACCOUNT_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", syncIdx);
    assert.ok(tryIdx !== -1 && tryIdx < syncIdx, "broker sync must be inside try/catch");
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(catchIdx !== -1 && catchIdx > syncIdx, "must have catch block after applyMaxPositionSize");
  });
});

// ── 3. apply-pending fires broker sync after successful promotion ─────────────

describe("POST /api/accounts/[id]/apply-pending: broker max position size sync", () => {
  it("imports TradovateClient", () => {
    const s = src(APPLY_PENDING_ROUTE);
    assert.ok(
      s.includes("TradovateClient"),
      "apply-pending route must import TradovateClient",
    );
  });

  it("calls applyMaxPositionSize after promotion", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const promoteIdx = s.indexOf("promoteAccountPendingRules(");
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(promoteIdx !== -1, "must call promoteAccountPendingRules");
    assert.ok(syncIdx !== -1, "must call applyMaxPositionSize");
    assert.ok(syncIdx > promoteIdx, "applyMaxPositionSize must be called after promoteAccountPendingRules");
  });

  it("only fires broker sync when promotedAccountCount > 0", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const guardBlock = s.slice(0, syncIdx);
    assert.ok(
      guardBlock.includes("promotedAccountCount > 0"),
      "broker sync must be gated on promotedAccountCount > 0",
    );
  });

  it("only fires broker sync for Tradovate accounts with externalAccountId", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    const guardBlock = s.slice(0, syncIdx);
    assert.ok(
      guardBlock.includes('"tradovate"'),
      "broker sync must check platform === tradovate",
    );
    assert.ok(
      guardBlock.includes("externalAccountId"),
      "broker sync must check externalAccountId is set",
    );
  });

  it("reads fresh maxContracts from DB after promotion", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    // The region between promoteAccountPendingRules and applyMaxPositionSize must
    // read accountRiskRules to get the newly-promoted maxContracts value.
    const promoteIdx = s.indexOf("promoteAccountPendingRules(");
    const midSection = s.slice(promoteIdx, syncIdx);
    assert.ok(
      midSection.includes("accountRiskRules") || midSection.includes("maxContracts"),
      "must read fresh maxContracts from DB after promotion before calling applyMaxPositionSize",
    );
  });

  it("fires broker sync as fire-and-forget (void)", () => {
    const s = src(APPLY_PENDING_ROUTE);
    assert.ok(
      s.includes("void (async"),
      "broker sync must be fire-and-forget with void",
    );
  });

  it("wraps broker sync in try/catch so promotion result is still returned", () => {
    const s = src(APPLY_PENDING_ROUTE);
    const syncIdx = s.indexOf("applyMaxPositionSize(");
    assert.ok(syncIdx !== -1);
    const tryIdx = s.lastIndexOf("try {", syncIdx);
    assert.ok(tryIdx !== -1 && tryIdx < syncIdx);
    const catchIdx = s.indexOf("catch (err)", tryIdx);
    assert.ok(catchIdx !== -1 && catchIdx > syncIdx, "must have catch block after applyMaxPositionSize");
  });
});

// ── 4. Debug endpoint has required structural fields ─────────────────────────

describe("GET /api/debug/tradovate-position-limit: response shape", () => {
  it("returns guardrailMaxContracts", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("guardrailMaxContracts"), "must return guardrailMaxContracts");
  });

  it("returns externalAccountId", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("externalAccountId"), "must return externalAccountId");
  });

  it("returns brokerConnectionStatus", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("brokerConnectionStatus"), "must return brokerConnectionStatus");
  });

  it("returns permissionLevel", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("permissionLevel"), "must return permissionLevel");
  });

  it("returns guardrailLimitFound", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("guardrailLimitFound"), "must return guardrailLimitFound");
  });

  it("returns exposedLimit", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("exposedLimit"), "must return exposedLimit");
  });

  it("returns limitActive", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("limitActive"), "must return limitActive");
  });

  it("returns hardLimitAttached", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("hardLimitAttached"), "must return hardLimitAttached");
  });

  it("returns readyForDemo composite flag", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("readyForDemo"), "must return readyForDemo composite flag");
  });

  it("calls listUserAccountRiskParameters directly (no hacky cast)", () => {
    const s = src(DEBUG_ENDPOINT);
    // The direct call must be present
    assert.ok(
      s.includes("client.listUserAccountRiskParameters("),
      "must call client.listUserAccountRiskParameters directly",
    );
    // The hacky cast must be gone
    assert.ok(
      !s.includes("as unknown as"),
      "debug endpoint must not use hacky type cast for listUserAccountRiskParameters",
    );
  });

  it("requires authentication (401 for unauthenticated)", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(s.includes("getCurrentUser"), "must call getCurrentUser");
    assert.ok(s.includes("status: 401"), "must return 401 when unauthenticated");
  });

  it("scopes DB lookup to current user", () => {
    const s = src(DEBUG_ENDPOINT);
    assert.ok(
      s.includes("userId: currentUser.id"),
      "must scope DB lookup to current user's account",
    );
  });
});
