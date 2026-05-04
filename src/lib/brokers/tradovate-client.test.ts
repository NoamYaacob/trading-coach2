/**
 * Unit tests for TradovateClient pure helpers.
 *
 * Tests cover only the exported mapping functions — no network calls,
 * no database, no real credentials required.
 *
 * Run:  npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  mapOrderStatus,
  mapOrderType,
  mapSide,
  normalizeTokenResponse,
  selectBestBalance,
  TradovateClientError,
} from "./tradovate-client-helpers.ts";

// ── mapOrderStatus ────────────────────────────────────────────────────────────

describe("mapOrderStatus", () => {
  it("maps Working → WORKING", () => {
    assert.equal(mapOrderStatus("Working"), "WORKING");
  });

  it("maps Pending → WORKING", () => {
    assert.equal(mapOrderStatus("Pending"), "WORKING");
  });

  it("maps Completed → FILLED", () => {
    assert.equal(mapOrderStatus("Completed"), "FILLED");
  });

  it("maps Cancelled → CANCELLED", () => {
    assert.equal(mapOrderStatus("Cancelled"), "CANCELLED");
  });

  it("maps Expired → CANCELLED", () => {
    assert.equal(mapOrderStatus("Expired"), "CANCELLED");
  });

  it("maps Rejected → REJECTED", () => {
    assert.equal(mapOrderStatus("Rejected"), "REJECTED");
  });

  it("falls back to WORKING for unknown status", () => {
    assert.equal(mapOrderStatus("SomeUnknownStatus"), "WORKING");
  });
});

// ── mapOrderType ──────────────────────────────────────────────────────────────

describe("mapOrderType", () => {
  it("maps Limit → LIMIT", () => {
    assert.equal(mapOrderType("Limit"), "LIMIT");
  });

  it("maps LMT → LIMIT", () => {
    assert.equal(mapOrderType("LMT"), "LIMIT");
  });

  it("maps Market → MARKET", () => {
    assert.equal(mapOrderType("Market"), "MARKET");
  });

  it("maps MKT → MARKET", () => {
    assert.equal(mapOrderType("MKT"), "MARKET");
  });

  it("maps Stop → STOP", () => {
    assert.equal(mapOrderType("Stop"), "STOP");
  });

  it("maps StopLimit → STOP_LIMIT", () => {
    assert.equal(mapOrderType("StopLimit"), "STOP_LIMIT");
  });

  it("maps STPLMT → STOP_LIMIT", () => {
    assert.equal(mapOrderType("STPLMT"), "STOP_LIMIT");
  });

  it("falls back to OTHER for unknown type", () => {
    assert.equal(mapOrderType("MIT"), "OTHER");
  });
});

// ── mapSide ───────────────────────────────────────────────────────────────────

describe("mapSide", () => {
  it("maps Buy → LONG", () => {
    assert.equal(mapSide("Buy"), "LONG");
  });

  it("maps Sell → SHORT", () => {
    assert.equal(mapSide("Sell"), "SHORT");
  });
});

// ── TradovateClientError ──────────────────────────────────────────────────────

describe("TradovateClientError", () => {
  it("stores code and message", () => {
    const err = new TradovateClientError("API_ERROR", "Something failed", 503);
    assert.equal(err.code, "API_ERROR");
    assert.equal(err.message, "Something failed");
    assert.equal(err.statusCode, 503);
    assert.equal(err.name, "TradovateClientError");
  });

  it("statusCode is undefined when omitted", () => {
    const err = new TradovateClientError("CONFIG_MISSING", "Not configured");
    assert.equal(err.statusCode, undefined);
  });

  it("is an instance of Error", () => {
    const err = new TradovateClientError("NETWORK_ERROR", "Net error");
    assert.ok(err instanceof Error);
  });
});

// ── selectBestBalance ─────────────────────────────────────────────────────────

describe("selectBestBalance", () => {
  it("prefers netLiq over all others", () => {
    const result = selectBestBalance({
      netLiq: 10000,
      totalCashValue: 9000,
      cashBalance: 8000,
      accountBalance: 7000,
      amount: 6000,
    });
    assert.equal(result.value, 10000);
    assert.equal(result.field, "netLiq");
  });

  it("falls back to totalCashValue when netLiq is null", () => {
    const result = selectBestBalance({ netLiq: null, totalCashValue: 9000, amount: 6000 });
    assert.equal(result.value, 9000);
    assert.equal(result.field, "totalCashValue");
  });

  it("falls back to cashBalance when netLiq and totalCashValue are null", () => {
    const result = selectBestBalance({ netLiq: null, totalCashValue: null, cashBalance: 8000 });
    assert.equal(result.value, 8000);
    assert.equal(result.field, "cashBalance");
  });

  it("falls back to accountBalance", () => {
    const result = selectBestBalance({ accountBalance: 7000, amount: 6000 });
    assert.equal(result.value, 7000);
    assert.equal(result.field, "accountBalance");
  });

  it("falls back to amount as last resort", () => {
    const result = selectBestBalance({ amount: 6000 });
    assert.equal(result.value, 6000);
    assert.equal(result.field, "amount");
  });

  it("returns null when all candidates are null", () => {
    const result = selectBestBalance({
      netLiq: null,
      totalCashValue: null,
      cashBalance: null,
      accountBalance: null,
      amount: null,
    });
    assert.equal(result.value, null);
    assert.equal(result.field, null);
  });

  it("returns null when no candidates are provided", () => {
    const result = selectBestBalance({});
    assert.equal(result.value, null);
    assert.equal(result.field, null);
  });

  it("skips non-finite values (NaN, Infinity)", () => {
    const result = selectBestBalance({ netLiq: NaN, totalCashValue: Infinity, amount: 5000 });
    assert.equal(result.value, 5000);
    assert.equal(result.field, "amount");
  });

  it("accepts zero as a valid balance", () => {
    const result = selectBestBalance({ netLiq: 0 });
    assert.equal(result.value, 0);
    assert.equal(result.field, "netLiq");
  });

  it("skips undefined fields and continues down the priority chain", () => {
    const result = selectBestBalance({ cashBalance: 8500 });
    assert.equal(result.value, 8500);
    assert.equal(result.field, "cashBalance");
  });
});

// ── normalizeTokenResponse ────────────────────────────────────────────────────

describe("normalizeTokenResponse", () => {
  // ── access token extraction ─────────────────────────────────────────────────

  it("extracts access_token (OAuth snake_case)", () => {
    const result = normalizeTokenResponse({ access_token: "tok_abc" });
    assert.equal(result.accessToken, "tok_abc");
  });

  it("extracts accessToken (Tradovate camelCase)", () => {
    const result = normalizeTokenResponse({ accessToken: "tok_xyz" });
    assert.equal(result.accessToken, "tok_xyz");
  });

  it("extracts token (fallback field)", () => {
    const result = normalizeTokenResponse({ token: "tok_fallback" });
    assert.equal(result.accessToken, "tok_fallback");
  });

  it("prefers access_token over accessToken when both present", () => {
    const result = normalizeTokenResponse({ access_token: "snake", accessToken: "camel" });
    assert.equal(result.accessToken, "snake");
  });

  it("prefers accessToken over token when both present", () => {
    const result = normalizeTokenResponse({ accessToken: "camel", token: "fallback" });
    assert.equal(result.accessToken, "camel");
  });

  it("returns null accessToken when neither field is present", () => {
    const result = normalizeTokenResponse({});
    assert.equal(result.accessToken, null);
  });

  it("returns null accessToken when all fields are empty strings", () => {
    const result = normalizeTokenResponse({ access_token: "", accessToken: "", token: "" });
    assert.equal(result.accessToken, null);
  });

  // ── refresh token extraction ────────────────────────────────────────────────

  it("extracts refresh_token (OAuth snake_case)", () => {
    const result = normalizeTokenResponse({ access_token: "tok", refresh_token: "ref_abc" });
    assert.equal(result.refreshToken, "ref_abc");
  });

  it("extracts refreshToken (Tradovate camelCase)", () => {
    const result = normalizeTokenResponse({ accessToken: "tok", refreshToken: "ref_xyz" });
    assert.equal(result.refreshToken, "ref_xyz");
  });

  it("returns null refreshToken when absent (access-token-only response)", () => {
    const result = normalizeTokenResponse({ access_token: "tok" });
    assert.equal(result.refreshToken, null);
  });

  // ── expiry extraction ───────────────────────────────────────────────────────

  it("computes expiresAt from expires_in seconds", () => {
    const before = Date.now();
    const result = normalizeTokenResponse({ access_token: "t", expires_in: 3600 });
    const after = Date.now();
    assert.ok(result.expiresAt !== null);
    const ms = result.expiresAt!.getTime();
    assert.ok(ms >= before + 3600 * 1000 - 50 && ms <= after + 3600 * 1000 + 50);
  });

  it("computes expiresAt from expiresIn (camelCase alias)", () => {
    const before = Date.now();
    const result = normalizeTokenResponse({ accessToken: "t", expiresIn: 1800 });
    assert.ok(result.expiresAt !== null);
    const ms = result.expiresAt!.getTime();
    assert.ok(ms >= before + 1800 * 1000 - 50 && ms <= before + 1800 * 1000 + 50);
  });

  it("computes expiresAt from expirationTime ISO string", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const result = normalizeTokenResponse({ accessToken: "t", expirationTime: future });
    assert.ok(result.expiresAt !== null);
    assert.equal(result.expiresAt!.toISOString(), future);
  });

  it("prefers expires_in over expirationTime", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const result = normalizeTokenResponse({
      access_token: "t",
      expires_in: 3600,
      expirationTime: past,
    });
    assert.ok(result.expiresAt !== null);
    // expiresAt should be ~1 hour from now, not in the past
    assert.ok(result.expiresAt!.getTime() > Date.now());
  });

  it("returns null expiresAt when no expiry fields present", () => {
    const result = normalizeTokenResponse({ access_token: "t" });
    assert.equal(result.expiresAt, null);
  });

  it("returns null expiresAt for invalid expirationTime", () => {
    const result = normalizeTokenResponse({ accessToken: "t", expirationTime: "not-a-date" });
    assert.equal(result.expiresAt, null);
  });

  // ── mdAccessToken ───────────────────────────────────────────────────────────

  it("detects mdAccessToken presence", () => {
    const result = normalizeTokenResponse({ accessToken: "t", mdAccessToken: "md_tok" });
    assert.equal(result.hasMdAccessToken, true);
  });

  it("detects md_access_token (snake_case variant)", () => {
    const result = normalizeTokenResponse({ accessToken: "t", md_access_token: "md_tok" });
    assert.equal(result.hasMdAccessToken, true);
  });

  it("hasMdAccessToken false when absent", () => {
    const result = normalizeTokenResponse({ access_token: "t" });
    assert.equal(result.hasMdAccessToken, false);
  });

  // ── renewAccessToken shape (Tradovate camelCase only) ──────────────────────

  it("handles renewAccessToken response shape", () => {
    const expiry = new Date(Date.now() + 7200_000).toISOString();
    const result = normalizeTokenResponse({
      accessToken: "new_tok",
      mdAccessToken: "md_tok",
      expirationTime: expiry,
    });
    assert.equal(result.accessToken, "new_tok");
    assert.equal(result.refreshToken, null);
    assert.ok(result.expiresAt !== null);
    assert.equal(result.hasMdAccessToken, true);
  });

  // ── OAuth refresh_token grant shape (snake_case with both tokens) ──────────

  it("handles OAuth refresh_token grant response with both tokens", () => {
    const result = normalizeTokenResponse({
      access_token: "new_access",
      refresh_token: "new_refresh",
      expires_in: 3600,
    });
    assert.equal(result.accessToken, "new_access");
    assert.equal(result.refreshToken, "new_refresh");
    assert.ok(result.expiresAt !== null);
  });
});
