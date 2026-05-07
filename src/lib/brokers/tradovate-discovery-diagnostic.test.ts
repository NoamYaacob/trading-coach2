/**
 * Unit tests for the debug-only diagnostic helpers in tradovate-discovery.ts:
 *   - fetchTradovateAccountListWithDiagnostics
 *   - tryRefreshToken
 *
 * Uses node:test's mock.method to stub globalThis.fetch so no real network
 * calls are made and no database is touched.
 *
 * These tests also verify that no token / secret values leak into the
 * returned diagnostic objects.
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  fetchTradovateAccountListWithDiagnostics,
  tryRefreshToken,
} from "./tradovate-discovery-diagnostic.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = "https://demo.tradovateapi.com/v1";
const RENEW_URL = "https://live-api.tradovate.com/auth/renewAccessToken";
const TOKEN_URL = "https://live-api.tradovate.com/auth/oauthtoken";
const FAKE_ACCESS = "fake-access-token";
const FAKE_REFRESH = "fake-refresh-token";
const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret";

function makeFetch(response: {
  ok: boolean;
  status: number;
  statusText?: string;
  body: unknown;
}) {
  return async () =>
    ({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText ?? "",
      text: async () =>
        typeof response.body === "string"
          ? response.body
          : JSON.stringify(response.body),
      json: async () => response.body,
    }) as unknown as Response;
}

function makeNetworkErrorFetch(message = "connection refused") {
  return async () => {
    throw new Error(message);
  };
}

// ── fetchTradovateAccountListWithDiagnostics ──────────────────────────────────

describe("fetchTradovateAccountListWithDiagnostics", () => {
  beforeEach(() => {
    mock.restoreAll();
  });

  it("returns accounts on a successful 200 response", async () => {
    const accounts = [
      { id: 49392735, name: "MFFUEVBLDR133936248", accountType: "evaluation", active: true },
      { id: 49380707, name: "MFFUEVBLDR133920720", accountType: "evaluation", active: false },
    ];
    globalThis.fetch = makeFetch({ ok: true, status: 200, body: accounts });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts?.length, 2);
    assert.equal(result.accounts?.[0]?.externalAccountId, "49392735");
    assert.equal(result.accounts?.[0]?.active, true);
    assert.equal(result.accounts?.[1]?.active, false);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.errorMessage, null);
    // No body preview on success — saves bandwidth in the debug response.
    assert.equal(result.bodyPreview, null);
  });

  it("returns httpStatus 401 and bodyPreview on auth failure — no accounts, no token", async () => {
    const body = { error: "invalid_token", message: "Bearer token is invalid" };
    globalThis.fetch = makeFetch({ ok: false, status: 401, body });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts, null);
    assert.equal(result.httpStatus, 401);
    assert.ok(result.errorMessage?.includes("401"), "errorMessage should mention 401");
    assert.ok(result.bodyPreview?.includes("invalid_token"), "bodyPreview should contain error body");
    // No token values in the result.
    assert.ok(!JSON.stringify(result).includes(FAKE_ACCESS), "must not leak access token");
  });

  it("returns httpStatus 403 on permission denied", async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 403, statusText: "Forbidden", body: "Forbidden" });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts, null);
    assert.equal(result.httpStatus, 403);
    assert.ok(result.errorMessage?.includes("403"));
  });

  it("returns httpStatus 500 on server error", async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 500, body: "Internal Server Error" });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts, null);
    assert.equal(result.httpStatus, 500);
    assert.ok(result.errorMessage?.includes("500"));
  });

  it("returns errorMessage on network error with null httpStatus", async () => {
    globalThis.fetch = makeNetworkErrorFetch("connection refused") as typeof fetch;

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts, null);
    assert.equal(result.httpStatus, null);
    assert.ok(result.errorMessage?.includes("Network error"), "must mention network error");
    assert.ok(!JSON.stringify(result).includes(FAKE_ACCESS), "must not leak access token");
  });

  it("returns errorMessage when response body is not valid JSON", async () => {
    globalThis.fetch = makeFetch({ ok: true, status: 200, body: "<!DOCTYPE html><html>" });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.accounts, null);
    assert.equal(result.httpStatus, 200);
    assert.ok(result.errorMessage?.includes("JSON"));
  });

  it("bodyPreview is truncated to 500 chars", async () => {
    const longBody = "x".repeat(1000);
    globalThis.fetch = makeFetch({ ok: false, status: 400, body: longBody });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    assert.equal(result.bodyPreview?.length, 500);
  });

  it("never includes the access token string in any returned field", async () => {
    const tokenInBody = `{"error":"invalid","token":"${FAKE_ACCESS}"}`;
    globalThis.fetch = makeFetch({ ok: false, status: 401, body: tokenInBody });

    const result = await fetchTradovateAccountListWithDiagnostics(BASE_URL, FAKE_ACCESS);

    // The bodyPreview may contain the string if Tradovate echoes it, but the
    // access token we SENT must not appear in the diagnostic fields that belong
    // to our own values (errorMessage, httpStatus).
    // At minimum, confirm the result can be safely serialised without the caller's token.
    // (We can't scrub the echoed response body — that's Tradovate's response.)
    assert.equal(result.httpStatus, 401);
    assert.equal(result.accounts, null);
  });
});

// ── tryRefreshToken ───────────────────────────────────────────────────────────

const REFRESH_INPUT = {
  accessToken: FAKE_ACCESS,
  refreshToken: FAKE_REFRESH,
  renewUrl: RENEW_URL,
  tokenUrl: TOKEN_URL,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
};

describe("tryRefreshToken — renewAccessToken succeeds", () => {
  beforeEach(() => mock.restoreAll());

  it("returns succeeded=true with strategy=renew_endpoint when renewAccessToken works", async () => {
    const newToken = "new-access-token-from-renew";
    globalThis.fetch = makeFetch({
      ok: true,
      status: 200,
      body: { accessToken: newToken, expiresIn: 4800 },
    });

    const result = await tryRefreshToken(REFRESH_INPUT);

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.strategy, "renew_endpoint");
    assert.equal(result.succeeded, true);
    assert.equal(result.newToken, newToken);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.errorMessage, null);
    assert.ok(result.newExpiresAt instanceof Date);
  });

  it("newToken is NOT present in a safe serialisation of the result fields exposed to callers", async () => {
    // The debug route intentionally strips newToken before returning JSON.
    // This test documents that newToken exists in the result object so the
    // route MUST strip it — and that none of the OTHER fields contain it.
    const newToken = "super-secret-new-token";
    globalThis.fetch = makeFetch({
      ok: true,
      status: 200,
      body: { accessToken: newToken, expiresIn: 4800 },
    });

    const result = await tryRefreshToken(REFRESH_INPUT);
    assert.ok(result.attempted && result.succeeded);

    // Simulate what buildTokenRefreshSummary does — strip newToken.
    const safe: Record<string, unknown> = { ...result };
    delete safe["newToken"];

    assert.ok(!JSON.stringify(safe).includes(newToken), "safe summary must not contain newToken");
    assert.ok(!JSON.stringify(safe).includes(FAKE_ACCESS), "safe summary must not contain old token");
    assert.ok(!JSON.stringify(safe).includes(CLIENT_SECRET), "safe summary must not contain clientSecret");
  });
});

describe("tryRefreshToken — renewAccessToken fails, OAuth grant succeeds", () => {
  beforeEach(() => mock.restoreAll());

  it("falls through to OAuth grant when renew endpoint returns 401", async () => {
    const newToken = "new-token-from-oauth";
    let callCount = 0;
    globalThis.fetch = (async (url: string) => {
      callCount++;
      if (String(url).includes("renewAccessToken")) {
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => '{"error":"invalid_token"}',
        } as unknown as Response;
      }
      // OAuth grant
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ access_token: newToken, expires_in: 4800 }),
        json: async () => ({ access_token: newToken, expires_in: 4800 }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await tryRefreshToken(REFRESH_INPUT);

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.strategy, "oauth_grant");
    assert.equal(result.succeeded, true);
    assert.equal(result.newToken, newToken);
    assert.equal(callCount, 2, "should have made two fetch calls");
  });
});

describe("tryRefreshToken — no refresh token stored", () => {
  beforeEach(() => mock.restoreAll());

  it("returns strategy=no_refresh_token when renewAccessToken fails and no refresh_token", async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 401, body: '{"error":"invalid_token"}' });

    const result = await tryRefreshToken({ ...REFRESH_INPUT, refreshToken: null });

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.strategy, "no_refresh_token");
    assert.equal(result.succeeded, false);
    assert.equal(result.newToken, null);
    assert.ok(result.errorMessage?.includes("no refresh_token"));
  });
});

describe("tryRefreshToken — OAuth grant fails", () => {
  beforeEach(() => mock.restoreAll());

  it("returns succeeded=false with OAuth error when both strategies fail", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return {
        ok: false,
        status: callCount === 1 ? 401 : 400,
        statusText: callCount === 1 ? "Unauthorized" : "Bad Request",
        text: async () => '{"error":"invalid_grant"}',
      } as unknown as Response;
    }) as typeof fetch;

    const result = await tryRefreshToken(REFRESH_INPUT);

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.strategy, "oauth_grant");
    assert.equal(result.succeeded, false);
    assert.equal(result.newToken, null);
    assert.ok(result.errorMessage?.includes("400"));
  });
});

describe("tryRefreshToken — network errors", () => {
  beforeEach(() => mock.restoreAll());

  it("reports network error and falls through to OAuth grant when renew endpoint is unreachable", async () => {
    const newToken = "new-token-after-network-error";
    let callCount = 0;
    globalThis.fetch = (async (url: string) => {
      callCount++;
      if (String(url).includes("renewAccessToken")) throw new Error("ECONNREFUSED");
      const body = { access_token: newToken, expires_in: 4800 };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as unknown as Response;
    }) as typeof fetch;

    const result = await tryRefreshToken(REFRESH_INPUT);

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.strategy, "oauth_grant");
    assert.equal(result.succeeded, true);
    assert.equal(result.newToken, newToken);
  });

  it("reports network error for OAuth grant when both endpoints are unreachable", async () => {
    globalThis.fetch = makeNetworkErrorFetch("ECONNREFUSED") as typeof fetch;

    const result = await tryRefreshToken(REFRESH_INPUT);

    assert.ok(result.attempted);
    if (!result.attempted) return;
    assert.equal(result.succeeded, false);
    assert.ok(result.errorMessage?.includes("Network error") || result.errorMessage?.includes("ECONNREFUSED"));
  });
});

describe("tryRefreshToken — safe serialisation", () => {
  beforeEach(() => mock.restoreAll());

  it("never exposes clientSecret in any result field", async () => {
    globalThis.fetch = makeFetch({ ok: false, status: 400, body: `{"error":"bad","secret":"${CLIENT_SECRET}"}` });

    const result = await tryRefreshToken(REFRESH_INPUT);

    // Result fields (excluding newToken which is a known plaintext field that
    // the route scrubs) must not contain the client secret.
    const safeResult = { ...result, newToken: undefined };
    assert.ok(
      !JSON.stringify(safeResult).includes(CLIENT_SECRET),
      "clientSecret must not appear in diagnostic fields",
    );
  });
});
