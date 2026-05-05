import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapTvTokenError, parseTvTokenErrorBody } from "./tradovate-token-exchange.ts";

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
