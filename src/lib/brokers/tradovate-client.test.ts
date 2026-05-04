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
  parseSnapshotItems,
  selectBestBalance,
  computeSnapshotBalance,
  sumFillPnl,
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

// ── parseSnapshotItems ────────────────────────────────────────────────────────

type FakeSnap = { accountId: number; amount: number | null };
const snap: FakeSnap = { accountId: 42, amount: 1000 };

describe("parseSnapshotItems", () => {
  it("passes a bare array through unchanged", () => {
    const result = parseSnapshotItems<FakeSnap>([snap]);
    assert.deepEqual(result, [snap]);
  });

  it("returns empty array for an empty array", () => {
    assert.deepEqual(parseSnapshotItems([]), []);
  });

  it("wraps a single object with numeric accountId", () => {
    const result = parseSnapshotItems<FakeSnap>(snap);
    assert.deepEqual(result, [snap]);
  });

  it("does not wrap an object without a numeric accountId", () => {
    assert.deepEqual(parseSnapshotItems({ foo: "bar" }), []);
  });

  it("extracts from Tradovate batch envelope { i: [...] }", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ s: 200, i: [snap] }), [snap]);
  });

  it("extracts from { d: [...] } wrapper", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ d: [snap] }), [snap]);
  });

  it("extracts from { data: [...] } wrapper", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ data: [snap] }), [snap]);
  });

  it("extracts from { result: [...] } wrapper", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ result: [snap] }), [snap]);
  });

  it("extracts from { results: [...] } wrapper", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ results: [snap] }), [snap]);
  });

  it("extracts from { items: [...] } wrapper", () => {
    assert.deepEqual(parseSnapshotItems<FakeSnap>({ items: [snap] }), [snap]);
  });

  it("returns empty array for null", () => {
    assert.deepEqual(parseSnapshotItems(null), []);
  });

  it("returns empty array for a primitive", () => {
    assert.deepEqual(parseSnapshotItems("not an object"), []);
    assert.deepEqual(parseSnapshotItems(42), []);
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

// ── computeSnapshotBalance ────────────────────────────────────────────────────

describe("computeSnapshotBalance", () => {
  it("prefers netLiq over amount and realizedPnL for balance", () => {
    const result = computeSnapshotBalance({ netLiq: 10000, amount: 9000, realizedPnL: 100 });
    assert.equal(result.balance, 10000);
    assert.equal(result.field, "netLiq");
    assert.equal(result.todayPnL, 100);
  });

  it("prefers totalCashValue when netLiq absent", () => {
    const result = computeSnapshotBalance({ totalCashValue: 9500, amount: 8000, realizedPnL: 200 });
    assert.equal(result.balance, 9500);
    assert.equal(result.field, "totalCashValue");
  });

  it("uses amount as balance when no higher-priority field present", () => {
    // amount IS the current balance in Tradovate — must NOT be combined with realizedPnL.
    const result = computeSnapshotBalance({ amount: 9000, realizedPnL: 100 });
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
    assert.equal(result.todayPnL, 100);
  });

  it("uses amount alone when realizedPnL is absent", () => {
    const result = computeSnapshotBalance({ amount: 9000 });
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
    assert.equal(result.todayPnL, null);
  });

  it("prefers realizedPnL (uppercase L) over realizedPnl (lowercase l)", () => {
    const result = computeSnapshotBalance({ amount: 9000, realizedPnL: 200, realizedPnl: 100 });
    assert.equal(result.todayPnL, 200);
    // balance is amount alone — not combined with pnl
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
  });

  it("uses realizedPnl (lowercase l) as todayPnL fallback when realizedPnL absent", () => {
    const result = computeSnapshotBalance({ amount: 9000, realizedPnl: 150 });
    assert.equal(result.todayPnL, 150);
    // balance is still amount alone
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
  });

  it("does not add realizedPnL to amount (avoids double-counting)", () => {
    // Tradovate $989.20 account with $26 realized P&L — should show 989.20, not 1015.20.
    const result = computeSnapshotBalance({ amount: 989.2, realizedPnL: 26 });
    assert.equal(result.balance, 989.2);
    assert.equal(result.field, "amount");
    assert.equal(result.todayPnL, 26);
  });

  it("handles negative realizedPnL (losing day) without affecting balance", () => {
    const result = computeSnapshotBalance({ amount: 10000, realizedPnL: -500 });
    assert.equal(result.balance, 10000);
    assert.equal(result.todayPnL, -500);
  });

  it("returns null balance and null todayPnL for empty snapshot", () => {
    const result = computeSnapshotBalance({});
    assert.equal(result.balance, null);
    assert.equal(result.field, null);
    assert.equal(result.todayPnL, null);
  });

  it("skips non-finite amount values", () => {
    const result = computeSnapshotBalance({ amount: NaN, realizedPnL: 100 });
    assert.equal(result.balance, null);
    assert.equal(result.todayPnL, 100);
  });

  it("skips non-finite realizedPnL values", () => {
    const result = computeSnapshotBalance({ amount: 9000, realizedPnL: Infinity });
    assert.equal(result.todayPnL, null);
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
  });

  it("accepts zero realizedPnL as a valid (break-even) day", () => {
    const result = computeSnapshotBalance({ amount: 9000, realizedPnL: 0 });
    assert.equal(result.todayPnL, 0);
    assert.equal(result.balance, 9000);
    assert.equal(result.field, "amount");
  });

  it("prefers cashBalance over amount", () => {
    const result = computeSnapshotBalance({ cashBalance: 9800, amount: 9000, realizedPnL: 50 });
    assert.equal(result.balance, 9800);
    assert.equal(result.field, "cashBalance");
    assert.equal(result.todayPnL, 50);
  });
});

// ── sumFillPnl ────────────────────────────────────────────────────────────────

describe("sumFillPnl", () => {
  it("returns null for empty input", () => {
    assert.equal(sumFillPnl([]), null);
  });

  it("returns null when all values are null or undefined", () => {
    assert.equal(sumFillPnl([null, null, undefined]), null);
  });

  it("sums finite values", () => {
    assert.equal(sumFillPnl([100, 50, -30]), 120);
  });

  it("skips null and non-finite values", () => {
    assert.equal(sumFillPnl([100, null, undefined, NaN, Infinity, 50]), 150);
  });

  it("includes zero as a valid P&L value", () => {
    assert.equal(sumFillPnl([0, 100]), 100);
    assert.equal(sumFillPnl([0]), 0);
  });

  it("handles two fills — tradesCount=2 scenario", () => {
    const result = sumFillPnl([120.5, -45.25]);
    assert.ok(result !== null);
    assert.ok(Math.abs(result - 75.25) < 0.001);
  });
});

// ── parseSnapshotItems with fill shapes ───────────────────────────────────────

type FakeFill = { accountId: number; id: number; orderId: number; timestamp: string; profit: number | null };

describe("parseSnapshotItems — fill response shapes", () => {
  const fill1: FakeFill = { accountId: 1, id: 101, orderId: 50, timestamp: "2026-05-04T10:00:00Z", profit: 120 };
  const fill2: FakeFill = { accountId: 1, id: 102, orderId: 51, timestamp: "2026-05-04T10:05:00Z", profit: -45 };

  it("handles bare array of fills", () => {
    const result = parseSnapshotItems<FakeFill>([fill1, fill2]);
    assert.equal(result.length, 2);
    assert.equal(result[0].orderId, 50);
  });

  it("handles { d: [...] } wrapped fill response", () => {
    const result = parseSnapshotItems<FakeFill>({ d: [fill1, fill2] });
    assert.equal(result.length, 2);
    assert.equal(result[1].orderId, 51);
  });

  it("handles { results: [...] } wrapped fill response", () => {
    const result = parseSnapshotItems<FakeFill>({ results: [fill1] });
    assert.equal(result.length, 1);
    assert.equal(result[0].profit, 120);
  });

  it("handles single fill object (by accountId field)", () => {
    const result = parseSnapshotItems<FakeFill>(fill1);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 101);
  });

  it("returns empty array for empty wrapped response", () => {
    const result = parseSnapshotItems<FakeFill>({ d: [] });
    assert.equal(result.length, 0);
  });
});

// ── order-level trade grouping ────────────────────────────────────────────────

describe("order-level trade grouping from fills", () => {
  it("counts two fills with different orderIds as 2 trades", () => {
    const fills = [
      { orderId: "A", profit: 100 },
      { orderId: "B", profit: -50 },
    ];
    const distinctOrderIds = new Set(fills.map((f) => f.orderId));
    assert.equal(distinctOrderIds.size, 2);
  });

  it("counts multiple fills for the same orderId as 1 trade", () => {
    const fills = [
      { orderId: "A", profit: 60 },   // partial fill 1
      { orderId: "A", profit: 40 },   // partial fill 2
    ];
    const distinctOrderIds = new Set(fills.map((f) => f.orderId));
    assert.equal(distinctOrderIds.size, 1);
  });

  it("counts 3 fills across 2 orders correctly", () => {
    const fills = [
      { orderId: "A", profit: 60 },
      { orderId: "A", profit: 40 },
      { orderId: "B", profit: -30 },
    ];
    const distinctOrderIds = new Set(fills.map((f) => f.orderId));
    assert.equal(distinctOrderIds.size, 2);
  });

  it("returns 0 when fills array is empty", () => {
    const fills: { orderId: string; profit: number }[] = [];
    const distinctOrderIds = new Set(fills.map((f) => f.orderId));
    assert.equal(distinctOrderIds.size, 0);
  });
});
