import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapTvTokenError, parseTvTokenErrorBody, parseTvTokenResponse } from "./tradovate-token-exchange.ts";

describe("mapTvTokenError", () => {
  it("maps invalid_grant", () => {
    assert.equal(mapTvTokenError("invalid_grant"), "oauth_code_expired_or_reused");
  });

  it("maps invalid_client", () => {
    assert.equal(mapTvTokenError("invalid_client"), "oauth_invalid_client");
  });

  it("maps redirect_uri_mismatch", () => {
    assert.equal(mapTvTokenError("redirect_uri_mismatch"), "oauth_redirect_uri_mismatch");
  });

  it("maps unknown codes to token_exchange_failed", () => {
    assert.equal(mapTvTokenError("server_error"), "token_exchange_failed");
    assert.equal(mapTvTokenError(""), "token_exchange_failed");
  });
});

describe("parseTvTokenErrorBody", () => {
  it("parses a well-formed error body", () => {
    const result = parseTvTokenErrorBody(
      JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }),
    );
    assert.equal(result.tvError, "invalid_grant");
    assert.equal(result.tvErrorDesc, "Code expired");
  });

  it("returns empty strings for missing fields", () => {
    const result = parseTvTokenErrorBody(JSON.stringify({}));
    assert.equal(result.tvError, "");
    assert.equal(result.tvErrorDesc, "");
  });

  it("returns empty strings for non-string field values", () => {
    const result = parseTvTokenErrorBody(JSON.stringify({ error: 42, error_description: null }));
    assert.equal(result.tvError, "");
    assert.equal(result.tvErrorDesc, "");
  });

  it("returns empty strings for invalid JSON", () => {
    const result = parseTvTokenErrorBody("not-json");
    assert.equal(result.tvError, "");
    assert.equal(result.tvErrorDesc, "");
  });

  it("truncates error_description at 300 characters", () => {
    const long = "x".repeat(400);
    const result = parseTvTokenErrorBody(JSON.stringify({ error: "e", error_description: long }));
    assert.equal(result.tvErrorDesc.length, 300);
  });
});

describe("parseTvTokenResponse", () => {
  it("parses snake_case access_token", () => {
    const result = parseTvTokenResponse({ access_token: "tok123", expires_in: 3600 });
    assert.ok(result.ok);
    assert.equal(result.token.accessToken, "tok123");
    assert.equal(result.token.expiresIn, 3600);
    assert.equal(result.token.refreshToken, null);
    assert.equal(result.token.accountId, null);
  });

  it("parses camelCase accessToken as fallback", () => {
    const result = parseTvTokenResponse({ accessToken: "tok456", refreshToken: "ref789" });
    assert.ok(result.ok);
    assert.equal(result.token.accessToken, "tok456");
    assert.equal(result.token.refreshToken, "ref789");
  });

  it("prefers snake_case over camelCase when both present", () => {
    const result = parseTvTokenResponse({ access_token: "snake", accessToken: "camel" });
    assert.ok(result.ok);
    assert.equal(result.token.accessToken, "snake");
  });

  it("parses all camelCase fields", () => {
    const result = parseTvTokenResponse({
      accessToken: "t",
      refreshToken: "r",
      accountId: 99,
      expiresIn: 7200,
    });
    assert.ok(result.ok);
    assert.equal(result.token.refreshToken, "r");
    assert.equal(result.token.accountId, "99");
    assert.equal(result.token.expiresIn, 7200);
  });

  it("parses account_id as string", () => {
    const result = parseTvTokenResponse({ access_token: "t", account_id: 42 });
    assert.ok(result.ok);
    assert.equal(result.token.accountId, "42");
  });

  it("returns ok:false when access token absent", () => {
    const result = parseTvTokenResponse({ token_type: "Bearer", expires_in: 3600 });
    assert.ok(!result.ok);
    assert.deepEqual(result.responseKeys, ["token_type", "expires_in"]);
  });

  it("returns ok:false for empty access_token string", () => {
    const result = parseTvTokenResponse({ access_token: "" });
    assert.ok(!result.ok);
  });

  it("returns ok:false for non-object input", () => {
    assert.ok(!parseTvTokenResponse(null).ok);
    assert.ok(!parseTvTokenResponse("string").ok);
    assert.ok(!parseTvTokenResponse([]).ok);
  });

  it("includes responseKeys in failure result — never token values", () => {
    const result = parseTvTokenResponse({ token_type: "Bearer" });
    assert.ok(!result.ok);
    assert.ok(result.responseKeys.includes("token_type"));
    // responseKeys must be key names only, not values
    assert.ok(!result.responseKeys.includes("Bearer"));
  });

  it("ignores non-positive expiresIn", () => {
    const result = parseTvTokenResponse({ access_token: "t", expires_in: -1 });
    assert.ok(result.ok);
    assert.equal(result.token.expiresIn, null);
  });
});
