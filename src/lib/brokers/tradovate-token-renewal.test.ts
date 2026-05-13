/**
 * Tradovate token renewal audit tests.
 *
 * Source-scan tests verify behaviors that can be confirmed from the source
 * code structure without requiring live DB or network.  Pure-logic tests
 * exercise the shouldRenewToken / classifyRenewalError helpers directly.
 *
 * Run:  npm run test:unit
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  shouldRenewToken,
  classifyRenewalError,
  normalizeTokenResponse,
  REFRESH_BUFFER_MS,
} from "./tradovate-client-helpers.ts";

const TOKENS_FILE = resolve(import.meta.dirname, "tradovate-tokens.ts");
const CLIENT_FILE = resolve(import.meta.dirname, "tradovate-client.ts");
const ENSURE_FILE = resolve(import.meta.dirname, "tradovate-ensure-token.ts");
const SYNC_FILE = resolve(import.meta.dirname, "tradovate-sync.ts");

function src(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Bug 1: stale token read ───────────────────────────────────────────────────

describe("Bug 1 fix: tradovate-tokens always prefers BrokerConnection tokens", () => {
  test("old conditional (brokerConnectionId && !accessTokenEncrypted) is gone", () => {
    const s = src(TOKENS_FILE);
    assert.ok(
      !s.includes("brokerConnectionId && !account.accessTokenEncrypted"),
      "the old compound guard must be removed — it caused stale per-account tokens to be read after renewal",
    );
  });

  test("BrokerConnection path is entered whenever brokerConnectionId is set", () => {
    const s = src(TOKENS_FILE);
    assert.ok(
      s.includes("if (account.brokerConnectionId) {"),
      "condition must be: if (account.brokerConnectionId) — no additional guard",
    );
  });

  test("BrokerConnection is the canonical token source when brokerConnectionId is present", () => {
    const s = src(TOKENS_FILE);
    const bcBlockStart = s.indexOf("if (account.brokerConnectionId) {");
    const legacyPathStart = s.indexOf("// Legacy path: per-account token columns.");
    assert.ok(
      bcBlockStart !== -1,
      "BrokerConnection preferred branch must exist",
    );
    assert.ok(
      legacyPathStart > bcBlockStart,
      "legacy per-account path must come after the BrokerConnection path",
    );
  });
});

// ── Bug 2: connectionStatus demotion on renewal ───────────────────────────────

describe("Bug 2 fix: #storeRefreshedTokens does not reset connectionStatus", () => {
  test("#storeRefreshedTokens does not write connected_readonly on the BrokerConnection update", () => {
    const s = src(CLIENT_FILE);
    // Find #storeRefreshedTokens body and locate the bcData object literal.
    // The check: brokerConnection.update(data: bcData) must NOT include connectionStatus.
    // (connectedAccount.updateMany may legitimately use connected_readonly for cascade heals.)
    const fnStart = s.indexOf("async #storeRefreshedTokens(");
    const fnEnd = s.indexOf("\n  async ", fnStart + 1);
    const fnBody = s.slice(fnStart, fnEnd);
    // bcData is the object passed to brokerConnection.update — find its block.
    const bcDataStart = fnBody.indexOf("const bcData:");
    const bcDataEnd = fnBody.indexOf("await prisma.brokerConnection.update(", bcDataStart);
    const bcDataBlock = fnBody.slice(bcDataStart, bcDataEnd);
    assert.ok(
      !bcDataBlock.includes('"connected_readonly"'),
      "#storeRefreshedTokens must not hardcode connected_readonly in bcData — it would demote connected_live connections",
    );
  });

  test("connection-level renewal (ensureTradovateAccessToken) also preserves connectionStatus on BC", () => {
    const s = src(ENSURE_FILE);
    const persistFn = s.indexOf("async function persistRenewedTokens(");
    const persistEnd = s.indexOf("\nasync function ", persistFn + 1);
    const persistBody = s.slice(persistFn, persistEnd > persistFn ? persistEnd : s.length);
    // The BC update data must not include a hard-coded connectionStatus.
    const dataStart = persistBody.indexOf("const data:");
    const dataEnd = persistBody.indexOf("await prisma.brokerConnection.update(", dataStart);
    const dataBlock = persistBody.slice(dataStart, dataEnd);
    assert.ok(
      !dataBlock.includes('"connected_readonly"'),
      "brokerConnection.update data in persistRenewedTokens must not hardcode connected_readonly",
    );
    assert.ok(
      persistBody.includes("connectionStatus is NOT changed"),
      "persistRenewedTokens must carry a comment explaining why BC connectionStatus is preserved",
    );
  });
});

// ── Bug 3: linked account expiry cascade ─────────────────────────────────────

describe("Bug 3 fix: expiry cascades to linked ConnectedAccount rows", () => {
  test("#markConnectionExpired calls connectedAccount.updateMany for BrokerConnection-backed accounts", () => {
    const s = src(CLIENT_FILE);
    const markFn = s.indexOf("async #markConnectionExpired(");
    const markEnd = s.indexOf("\n  async ", markFn + 1);
    const markBody = s.slice(markFn, markEnd);
    assert.ok(
      markBody.includes("connectedAccount.updateMany"),
      "#markConnectionExpired must cascade to linked ConnectedAccount rows via updateMany",
    );
    assert.ok(
      markBody.includes("brokerConnectionId: this.#brokerConnectionId"),
      "updateMany must filter by brokerConnectionId to only affect linked accounts",
    );
  });

  test("ensureTradovateAccessToken marks linked accounts expired via markExpiredWithAccounts", () => {
    const s = src(ENSURE_FILE);
    assert.ok(
      s.includes("connectedAccount.updateMany"),
      "markExpiredWithAccounts must cascade expiry to linked ConnectedAccount rows",
    );
    assert.ok(
      s.includes("connectionStatus: \"expired\""),
      "linked accounts must receive connectionStatus expired",
    );
  });
});

// ── ensureTradovateAccessToken structure ─────────────────────────────────────

describe("ensureTradovateAccessToken: connection-level renewal helper", () => {
  test("attempts GET /auth/renewAccessToken before OAuth grant", () => {
    const s = src(ENSURE_FILE);
    const renewIdx = s.indexOf("callRenewEndpoint");
    const oauthIdx = s.indexOf("callOAuthRefreshGrant");
    assert.ok(renewIdx !== -1, "must define callRenewEndpoint for the lightweight path");
    assert.ok(oauthIdx !== -1, "must define callOAuthRefreshGrant as fallback");
    assert.ok(renewIdx < oauthIdx, "renewEndpoint must be attempted before OAuth grant");
  });

  test("transient renewAccessToken failure does not attempt OAuth grant", () => {
    const s = src(ENSURE_FILE);
    // The transient branch throws early before reaching callOAuthRefreshGrant
    assert.ok(
      s.includes("if (cls === \"transient\") {"),
      "must have an early-return for transient errors before the OAuth grant path",
    );
    const transientIdx = s.indexOf("if (cls === \"transient\") {");
    const oauthIdx = s.indexOf("callOAuthRefreshGrant");
    assert.ok(
      transientIdx < oauthIdx,
      "transient early-return must appear before the OAuth grant call",
    );
  });

  test("auth_invalid failure with no refreshToken marks connection expired immediately", () => {
    const s = src(ENSURE_FILE);
    assert.ok(
      s.includes("markExpiredWithAccounts"),
      "must call markExpiredWithAccounts when auth_invalid and no refresh token",
    );
    assert.ok(
      s.includes("TOKEN_EXPIRED_NO_REFRESH"),
      "must throw TOKEN_EXPIRED_NO_REFRESH when no refresh token available",
    );
  });

  test("auth_invalid OAuth grant failure marks connection expired", () => {
    const s = src(ENSURE_FILE);
    const oauthCatchIdx = s.lastIndexOf("if (cls === \"auth_invalid\")");
    assert.ok(
      oauthCatchIdx !== -1,
      "OAuth grant error handler must check for auth_invalid before marking expired",
    );
    const oauthMarkIdx = s.lastIndexOf("markExpiredWithAccounts");
    assert.ok(
      oauthMarkIdx > oauthCatchIdx,
      "markExpiredWithAccounts must be called after the auth_invalid check in the OAuth error handler",
    );
  });

  test("returns { renewed: false } when token is fresh", () => {
    const s = src(ENSURE_FILE);
    assert.ok(
      s.includes("return { renewed: false, tokenExpiresAt: bc.tokenExpiresAt }"),
      "must return renewed: false when shouldRenewToken says no renewal needed",
    );
  });
});

// ── syncTradovateConnection calls ensure-token first ─────────────────────────

describe("syncTradovateConnection: connection-level renewal before parallel syncs", () => {
  test("imports ensureTradovateAccessToken", () => {
    const s = src(SYNC_FILE);
    assert.ok(
      s.includes("ensureTradovateAccessToken"),
      "tradovate-sync must import and use ensureTradovateAccessToken",
    );
  });

  test("ensureTradovateAccessToken is called before runDiscoveryForConnection", () => {
    const s = src(SYNC_FILE);
    const ensureIdx = s.indexOf("ensureTradovateAccessToken");
    const discoveryIdx = s.indexOf("runDiscoveryForConnection");
    assert.ok(ensureIdx !== -1, "ensureTradovateAccessToken must be present in sync");
    assert.ok(discoveryIdx !== -1, "runDiscoveryForConnection must still be present");
    assert.ok(
      ensureIdx < discoveryIdx,
      "ensureTradovateAccessToken must be called before runDiscoveryForConnection to supply a fresh token",
    );
  });

  test("ensureTradovateAccessToken is called before Promise.allSettled parallel account syncs", () => {
    const s = src(SYNC_FILE);
    const ensureIdx = s.indexOf("ensureTradovateAccessToken");
    const allSettledIdx = s.indexOf("Promise.allSettled");
    assert.ok(
      ensureIdx < allSettledIdx,
      "ensureTradovateAccessToken must run before Promise.allSettled to prevent N concurrent renewal races",
    );
  });
});

// ── Pure logic: shouldRenewToken ──────────────────────────────────────────────

describe("shouldRenewToken: renewal decision logic", () => {
  test("returns shouldRenew: false for a fresh token well outside the buffer", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 60 minutes away
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, false);
    assert.equal(result.reason, "valid_outside_buffer");
  });

  test("returns shouldRenew: true when token expires within the buffer window", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes away
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, true);
    assert.equal(result.reason, "within_buffer");
  });

  test("returns shouldRenew: true when token is already past expiry", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() - 1000); // 1 second ago
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, true);
    assert.equal(result.reason, "already_expired");
  });

  test("returns shouldRenew: true when expiresAt is null (defensive: assume stale)", () => {
    const result = shouldRenewToken({ expiresAt: null, now: new Date(), bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, true);
    assert.equal(result.reason, "no_expiry_known");
    assert.equal(result.msUntilExpiry, null);
  });

  test("REFRESH_BUFFER_MS is 15 minutes (900_000 ms)", () => {
    assert.equal(REFRESH_BUFFER_MS, 15 * 60 * 1000);
  });
});

// ── Pure logic: classifyRenewalError ─────────────────────────────────────────

describe("classifyRenewalError: determines whether to mark connection expired", () => {
  test("401 is auth_invalid", () => {
    assert.equal(classifyRenewalError({ httpStatus: 401 }), "auth_invalid");
  });

  test("403 is auth_invalid", () => {
    assert.equal(classifyRenewalError({ httpStatus: 403 }), "auth_invalid");
  });

  test("500 is transient", () => {
    assert.equal(classifyRenewalError({ httpStatus: 500 }), "transient");
  });

  test("429 is transient", () => {
    assert.equal(classifyRenewalError({ httpStatus: 429 }), "transient");
  });

  test("NETWORK_ERROR code is transient", () => {
    assert.equal(classifyRenewalError({ code: "NETWORK_ERROR" }), "transient");
  });

  test("PARSE_ERROR code is transient", () => {
    assert.equal(classifyRenewalError({ code: "PARSE_ERROR" }), "transient");
  });

  test("REFRESH_NO_ACCESS_TOKEN is auth_invalid", () => {
    assert.equal(classifyRenewalError({ code: "REFRESH_NO_ACCESS_TOKEN" }), "auth_invalid");
  });

  test("TOKEN_EXPIRED_NO_REFRESH is auth_invalid", () => {
    assert.equal(classifyRenewalError({ code: "TOKEN_EXPIRED_NO_REFRESH" }), "auth_invalid");
  });
});

// ── Pure logic: normalizeTokenResponse ───────────────────────────────────────

describe("normalizeTokenResponse: handles both Tradovate response shapes", () => {
  test("reads accessToken from camelCase (renewAccessToken endpoint)", () => {
    const result = normalizeTokenResponse({ accessToken: "tok123", expirationTime: "2026-05-10T12:00:00Z" });
    assert.equal(result.accessToken, "tok123");
    assert.ok(result.expiresAt instanceof Date);
  });

  test("reads access_token from snake_case (OAuth endpoint)", () => {
    const result = normalizeTokenResponse({ access_token: "tok456", expires_in: 3600 });
    assert.equal(result.accessToken, "tok456");
    assert.ok(result.expiresAt instanceof Date);
  });

  test("snake_case fields take priority over camelCase", () => {
    const result = normalizeTokenResponse({ access_token: "snake", accessToken: "camel" });
    assert.equal(result.accessToken, "snake");
  });

  test("returns null accessToken when neither field is present", () => {
    const result = normalizeTokenResponse({});
    assert.equal(result.accessToken, null);
  });

  test("returns null expiresAt when no expiry field is present", () => {
    const result = normalizeTokenResponse({ accessToken: "tok" });
    assert.equal(result.expiresAt, null);
  });

  test("token field is a fallback for accessToken", () => {
    const result = normalizeTokenResponse({ token: "tok789" });
    assert.equal(result.accessToken, "tok789");
  });
});

// ── 401 retry: does not infinite-loop ────────────────────────────────────────

describe("401 retry: TradovateClient retries once then stops", () => {
  test("#request has a retriedAfterRenewal guard to prevent loops", () => {
    const s = src(CLIENT_FILE);
    assert.ok(
      s.includes("retriedAfterRenewal"),
      "#request must carry a retriedAfterRenewal flag to prevent infinite 401 loops",
    );
  });

  test("second 401 (after renewal) marks connection expired for core endpoints", () => {
    const s = src(CLIENT_FILE);
    // After the retry, on a second 401 the code calls #markConnectionExpired
    const secondPass = s.indexOf("Already tried renewal and got 401 again");
    assert.ok(secondPass !== -1, "must have comment explaining the second-401 path");
    const afterSecondPass = s.slice(secondPass);
    assert.ok(
      afterSecondPass.includes("markConnectionExpired"),
      "second 401 must call #markConnectionExpired (for non-skipMarkExpired endpoints)",
    );
  });

  test("optional endpoints (skipMarkExpired) get 401 retry without marking expired", () => {
    const s = src(CLIENT_FILE);
    assert.ok(
      s.includes("skipMarkExpired"),
      "#request must support skipMarkExpired flag for endpoints like order/deps",
    );
  });
});

// ── Cron skips expired connections cleanly ────────────────────────────────────

describe("tradovate-sync cron: expired connections are skipped", () => {
  test("cron fetches only connected_readonly and connected_live connections", () => {
    const cronSrc = readFileSync(
      resolve(import.meta.dirname, "../../app/api/cron/tradovate-sync/route.ts"),
      "utf8",
    );
    assert.ok(
      cronSrc.includes('"connected_readonly"') && cronSrc.includes('"connected_live"'),
      "cron must filter by connected_readonly and connected_live — expired connections are excluded",
    );
    assert.ok(
      !cronSrc.includes('"expired"'),
      "cron must NOT include expired in its connection status filter",
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Token lifecycle requirement tests (Req 1–8)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GROUP_UTILS_FILE = resolve(
  import.meta.dirname,
  "../../app/dashboard/_components/command-center/group-utils.ts",
);
const DASHBOARD_DATA_FILE = resolve(
  import.meta.dirname,
  "../../app/dashboard/_components/command-center/data.ts",
);

// ── Req 1: token expiring within buffer triggers proactive renewal ────────────

describe("Req 1: token expiring soon triggers proactive renewal before any API call", () => {
  test("token expiring in 14 min (inside 15-min buffer) → shouldRenew: true", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 60 * 1000);
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, true);
    assert.equal(result.reason, "within_buffer");
  });

  test("ensureTradovateAccessToken checks shouldRenewToken before making any API call", () => {
    const s = src(ENSURE_FILE);
    assert.ok(s.includes("shouldRenewToken"), "must call shouldRenewToken before any network call");
    // The early-return must depend on `!decision.shouldRenew` so a fresh token
    // skips the network call. (Listener worker passes `forceRefresh: true` to
    // bypass this when the broker rejected the token with 401 — still safe.)
    assert.ok(
      /if \(!decision\.shouldRenew(?:\s*&&\s*!forceRefresh)?\) \{/.test(s),
      "must return early when token does not need renewal",
    );
    // The shouldRenewToken check must appear before callRenewEndpoint
    const decisionIdx = s.indexOf("shouldRenewToken");
    const callIdx = s.indexOf("callRenewEndpoint");
    assert.ok(decisionIdx < callIdx, "renewal decision must precede the network call");
  });
});

// ── Req 2: token valid for >15 min → no renewal ───────────────────────────────

describe("Req 2: token with more than 15 min remaining is not renewed", () => {
  test("token expiring in 20 min (outside 15-min buffer) → shouldRenew: false", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, false);
    assert.equal(result.reason, "valid_outside_buffer");
    assert.ok(result.msUntilExpiry !== null && result.msUntilExpiry > 0, "msUntilExpiry must be positive");
  });

  test("token expiring in exactly 16 min (just outside 15-min buffer) → shouldRenew: false", () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 16 * 60 * 1000);
    const result = shouldRenewToken({ expiresAt, now, bufferMs: REFRESH_BUFFER_MS });
    assert.equal(result.shouldRenew, false);
  });
});

// ── Req 3: first 401 → renew + retry, NOT immediately marked expired ──────────

describe("Req 3: first 401 triggers renewal + retry before marking connection expired", () => {
  test("#request uses retriedAfterRenewal flag to prevent infinite renewal loops", () => {
    const s = src(CLIENT_FILE);
    assert.ok(
      s.includes("retriedAfterRenewal"),
      "#request must carry a retriedAfterRenewal flag — loops are prevented by attempting renewal only once",
    );
  });

  test("first 401 does NOT call #markConnectionExpired — only the second 401 does", () => {
    const s = src(CLIENT_FILE);
    // Verify the comment that documents the second-401 path
    assert.ok(
      s.includes("Already tried renewal and got 401 again"),
      "code must document that marking expired happens only after the second 401",
    );
    // #markConnectionExpired must appear after the second-401 detection comment
    const secondPassComment = s.indexOf("Already tried renewal and got 401 again");
    const markExpiredIdx = s.indexOf("markConnectionExpired", secondPassComment);
    assert.ok(
      markExpiredIdx > secondPassComment,
      "#markConnectionExpired must be called after detecting the second 401, not on the first",
    );
  });

  test("skipMarkExpired flag lets optional endpoints get 401 without expiring the connection", () => {
    const s = src(CLIENT_FILE);
    assert.ok(
      s.includes("skipMarkExpired"),
      "optional trade-count endpoints use skipMarkExpired to avoid burning the connection on a 401",
    );
  });
});

// ── Req 4: renewal success cascades linked accounts out of expired ─────────────

describe("Req 4: successful token renewal heals linked ConnectedAccount rows stuck at expired", () => {
  test("persistRenewedTokens (connection-level) cascades heal via connectedAccount.updateMany", () => {
    const s = src(ENSURE_FILE);
    const persistStart = s.indexOf("async function persistRenewedTokens(");
    const persistEnd = s.indexOf("\nasync function ", persistStart + 1);
    const persistBody = s.slice(persistStart, persistEnd > persistStart ? persistEnd : s.length);
    assert.ok(
      persistBody.includes("connectedAccount.updateMany"),
      "persistRenewedTokens must heal linked accounts via updateMany after successful renewal",
    );
    assert.ok(
      persistBody.includes('"connected_readonly"'),
      "heap target must be connected_readonly — probe upgrades to connected_live as needed",
    );
    assert.ok(
      persistBody.includes("missingFromBrokerSince: null"),
      "heal must only target accounts still present at broker (missingFromBrokerSince: null)",
    );
  });

  test("#storeRefreshedTokens (per-client) also cascades heal for BrokerConnection-backed accounts", () => {
    const s = src(CLIENT_FILE);
    const storeFn = s.indexOf("async #storeRefreshedTokens(");
    const storeEnd = s.indexOf("\n  async ", storeFn + 1);
    const storeBody = s.slice(storeFn, storeEnd > storeFn ? storeEnd : s.length);
    assert.ok(
      storeBody.includes("connectedAccount.updateMany"),
      "#storeRefreshedTokens must cascade heal linked accounts after successful per-client renewal",
    );
    assert.ok(
      storeBody.includes('"connected_readonly"'),
      "#storeRefreshedTokens heal target must be connected_readonly",
    );
    assert.ok(
      storeBody.includes("missingFromBrokerSince: null"),
      "#storeRefreshedTokens heal must guard with missingFromBrokerSince: null",
    );
  });
});

// ── Req 5: renewal failure marks BrokerConnection expired + records error ─────

describe("Req 5: renewal failure marks BrokerConnection expired and records lastRenewError", () => {
  test("markExpiredWithAccounts records the failure reason as lastRenewError", () => {
    const s = src(ENSURE_FILE);
    const markStart = s.indexOf("async function markExpiredWithAccounts(");
    const markEnd = s.indexOf("\nasync function ", markStart + 1);
    const markBody = s.slice(markStart, markEnd > markStart ? markEnd : s.length);
    assert.ok(
      markBody.includes("lastRenewError: reason"),
      "markExpiredWithAccounts must persist the failure reason as lastRenewError so the debug endpoint can display it",
    );
  });

  test("transient errors are NOT marked expired — only auth_invalid errors trigger expiry", () => {
    const s = src(ENSURE_FILE);
    assert.ok(
      s.includes('if (cls === "transient") {'),
      "transient errors must exit before reaching markExpiredWithAccounts",
    );
    const transientIdx = s.indexOf('if (cls === "transient") {');
    const firstMarkIdx = s.indexOf("markExpiredWithAccounts");
    assert.ok(
      transientIdx < firstMarkIdx,
      "transient early-return guard must appear before the first markExpiredWithAccounts call",
    );
  });

  test("classifyRenewalError maps network errors to transient, not auth_invalid", () => {
    assert.equal(classifyRenewalError({ code: "NETWORK_ERROR" }), "transient");
    assert.equal(classifyRenewalError({ httpStatus: 500 }), "transient");
    assert.equal(classifyRenewalError({ httpStatus: 429 }), "transient");
  });
});

// ── Req 6: Dashboard does not show Reconnect for healthy/renewable connection ──

describe("Req 6: Dashboard Reconnect banner is not shown for connected_live or renewable connection", () => {
  test("filterExpiredGroups only includes groups with expired or connection_error status", () => {
    const s = src(GROUP_UTILS_FILE);
    assert.ok(
      s.includes('"expired"') && s.includes('"connection_error"'),
      "filterExpiredGroups gate must check for expired and connection_error",
    );
  });

  test("filterExpiredGroups return condition requires expired or connection_error — not the opposite", () => {
    const s = src(GROUP_UTILS_FILE);
    const filterFn = s.indexOf("export function filterExpiredGroups(");
    const filterEnd = s.indexOf("\nexport ", filterFn + 1);
    const filterBody = s.slice(filterFn, filterEnd > filterFn ? filterEnd : s.length);
    // The filter predicate must gate on expired/connection_error (positive check),
    // NOT on "is not connected_live" — the latter would inadvertently include all non-healthy groups.
    assert.ok(
      filterBody.includes('"expired"') && filterBody.includes('"connection_error"'),
      "filterExpiredGroups gate must reference expired and connection_error",
    );
    // Verify the return array uses a .filter() call with the expired/error check.
    assert.ok(
      filterBody.includes("groups.filter("),
      "filterExpiredGroups must use groups.filter() to select only expired/error groups",
    );
  });

  test("persistRenewedTokens sets lastRenewedAt and clears lastRenewError on success", () => {
    const s = src(ENSURE_FILE);
    const persistStart = s.indexOf("async function persistRenewedTokens(");
    const persistEnd = s.indexOf("\nasync function ", persistStart + 1);
    const persistBody = s.slice(persistStart, persistEnd > persistStart ? persistEnd : s.length);
    assert.ok(persistBody.includes("lastRenewedAt: now"), "must record when renewal succeeded");
    assert.ok(persistBody.includes("lastRenewError: null"), "must clear previous renewal error on success");
  });
});

// ── Req 7: Settings and Dashboard both use BrokerConnection as status authority

describe("Req 7: Settings and Dashboard agree — both use BrokerConnection connectionStatus as authority", () => {
  test("Dashboard data.ts uses resolveEffectiveConnectionStatus (BC wins over stale account row)", () => {
    const s = src(DASHBOARD_DATA_FILE);
    assert.ok(
      s.includes("resolveEffectiveConnectionStatus"),
      "Dashboard data.ts must apply resolveEffectiveConnectionStatus so BC status overrides stale account rows",
    );
  });

  test("resolveEffectiveConnectionStatus always prefers bcConnectionStatus over accountConnectionStatus", () => {
    const dataHelpersSrc = readFileSync(
      resolve(import.meta.dirname, "../../app/dashboard/_components/command-center/data-helpers.ts"),
      "utf8",
    );
    assert.ok(
      dataHelpersSrc.includes("resolveEffectiveConnectionStatus"),
      "resolveEffectiveConnectionStatus must be defined in data-helpers.ts",
    );
    // The function must prefer bcConnectionStatus (null-coalesce: BC wins when present).
    assert.ok(
      dataHelpersSrc.includes("bcConnectionStatus ??"),
      "resolveEffectiveConnectionStatus must null-coalesce: bcConnectionStatus ?? accountConnectionStatus",
    );
  });
});

// ── Req 8: no per-account stale token when brokerConnectionId is set ───────────

describe("Req 8: BrokerConnection token path is always taken when brokerConnectionId is set", () => {
  test("tradovate-tokens.ts enters the BrokerConnection path unconditionally when brokerConnectionId is set", () => {
    const s = src(TOKENS_FILE);
    assert.ok(
      s.includes("if (account.brokerConnectionId) {"),
      "must use BC path for any account with brokerConnectionId — no additional guards",
    );
  });

  test("old compound guard (brokerConnectionId && !accessTokenEncrypted) is removed", () => {
    const s = src(TOKENS_FILE);
    assert.ok(
      !s.includes("brokerConnectionId && !account.accessTokenEncrypted"),
      "old guard must not exist — it caused per-account stale tokens to be read when BC had already renewed",
    );
  });

  test("BrokerConnection path appears before the legacy per-account token path", () => {
    const s = src(TOKENS_FILE);
    const bcPath = s.indexOf("if (account.brokerConnectionId) {");
    const legacyPath = s.indexOf("// Legacy path: per-account token columns.");
    assert.ok(bcPath !== -1, "BC path must exist");
    assert.ok(legacyPath !== -1, "legacy path must exist (for accounts created before BrokerConnection)");
    assert.ok(bcPath < legacyPath, "BC path must come first to ensure it takes priority");
  });
});

// ── Stale lastRenewError cleanup ───────────────────────────────────────────

describe("ensure-token: stale lastRenewError cleanup", () => {
  test("ensureTradovateAccessToken selects lastRenewError from DB", () => {
    const s = src(ENSURE_FILE);
    const selectIdx = s.indexOf("select: {");
    const selectBlock = s.slice(selectIdx, s.indexOf("}", selectIdx) + 1);
    assert.ok(
      selectBlock.includes("lastRenewError"),
      "DB select must include lastRenewError so no-op path can check for stale errors",
    );
  });

  test("fresh-token path clears stale lastRenewError via fire-and-forget update", () => {
    const s = src(ENSURE_FILE);
    // The no-renewal branch precedes the return { renewed: false } line
    const returnFreshIdx = s.indexOf("return { renewed: false, tokenExpiresAt: bc.tokenExpiresAt }");
    assert.ok(returnFreshIdx !== -1, "fresh-token return must exist");
    // The cleanup block must appear before the return
    const cleanupIdx = s.lastIndexOf("lastRenewError: null", returnFreshIdx);
    assert.ok(
      cleanupIdx !== -1 && cleanupIdx < returnFreshIdx,
      "fire-and-forget lastRenewError cleanup must appear before the fresh-token return",
    );
  });

  test("cleanup update is fire-and-forget (uses .catch, does not await or throw)", () => {
    const s = src(ENSURE_FILE);
    const returnFreshIdx = s.indexOf("return { renewed: false, tokenExpiresAt: bc.tokenExpiresAt }");
    // Find the cleanup block just before the return
    const cleanupStart = s.lastIndexOf("if (bc.lastRenewError !== null)", returnFreshIdx);
    assert.ok(cleanupStart !== -1, "cleanup guard must exist");
    const cleanupBlock = s.slice(cleanupStart, returnFreshIdx);
    assert.ok(cleanupBlock.includes(".catch("), "cleanup must be fire-and-forget (.catch)");
    assert.ok(!cleanupBlock.includes("await "), "cleanup must not be awaited");
  });

  test("healthy connection with stale error does not block or throw", () => {
    // Pure logic: the .catch ensures DB failure cannot propagate
    const s = src(ENSURE_FILE);
    const returnFreshIdx = s.indexOf("return { renewed: false, tokenExpiresAt: bc.tokenExpiresAt }");
    const cleanupStart = s.lastIndexOf("if (bc.lastRenewError !== null)", returnFreshIdx);
    const cleanupBlock = s.slice(cleanupStart, returnFreshIdx);
    // Must not re-throw or propagate
    assert.ok(!cleanupBlock.includes("throw "), "cleanup must not throw");
    assert.ok(!cleanupBlock.includes("return NextResponse"), "cleanup must not short-circuit response");
  });
});
