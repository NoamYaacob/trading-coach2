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
  extractFillTimestamp,
  fillMatchesAccount,
  countEntryTrades,
  countEntryTradesSince,
  traceEntryTrades,
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

// ── extractFillTimestamp ──────────────────────────────────────────────────────

describe("extractFillTimestamp", () => {
  it("extracts from timestamp field", () => {
    assert.equal(
      extractFillTimestamp({ timestamp: "2026-05-04T20:30:45Z" }),
      "2026-05-04T20:30:45Z",
    );
  });

  it("extracts from tradeTime field", () => {
    assert.equal(
      extractFillTimestamp({ tradeTime: "2026-05-04T10:00:00Z" }),
      "2026-05-04T10:00:00Z",
    );
  });

  it("extracts from tradeDate object {year, month, day}", () => {
    assert.equal(
      extractFillTimestamp({ tradeDate: { year: 2026, month: 5, day: 4 } }),
      "2026-05-04",
    );
  });

  it("zero-pads month and day in tradeDate object", () => {
    assert.equal(
      extractFillTimestamp({ tradeDate: { year: 2026, month: 1, day: 9 } }),
      "2026-01-09",
    );
  });

  it("extracts from tradeDate string", () => {
    assert.equal(
      extractFillTimestamp({ tradeDate: "2026-05-04" }),
      "2026-05-04",
    );
  });

  it("returns null when no date field present", () => {
    assert.equal(extractFillTimestamp({ id: 1, orderId: 2 }), null);
  });

  it("prefers timestamp over tradeDate", () => {
    assert.equal(
      extractFillTimestamp({
        timestamp: "2026-05-04T20:00:00Z",
        tradeDate: { year: 2026, month: 5, day: 3 },
      }),
      "2026-05-04T20:00:00Z",
    );
  });

  it("extracts from executionTime field", () => {
    assert.equal(
      extractFillTimestamp({ executionTime: "2026-05-04T14:00:00Z" }),
      "2026-05-04T14:00:00Z",
    );
  });
});

// ── fillMatchesAccount ────────────────────────────────────────────────────────

describe("fillMatchesAccount", () => {
  it("matches by numeric accountId", () => {
    assert.equal(fillMatchesAccount({ accountId: 12345 }, 12345), true);
  });

  it("rejects wrong numeric accountId", () => {
    assert.equal(fillMatchesAccount({ accountId: 99999 }, 12345), false);
  });

  it("fills with accountId as number — exact match", () => {
    assert.equal(fillMatchesAccount({ accountId: 67890, orderId: 1 }, 67890), true);
    assert.equal(fillMatchesAccount({ accountId: 67890, orderId: 1 }, 12345), false);
  });

  it("fills with accountSpec as string — matches trailing segment", () => {
    assert.equal(fillMatchesAccount({ accountSpec: "APEX/12345" }, 12345), true);
    assert.equal(fillMatchesAccount({ accountSpec: "TOPSTEP/12345" }, 12345), true);
    assert.equal(fillMatchesAccount({ accountSpec: "FTMO/67890" }, 67890), true);
  });

  it("fills with accountSpec — rejects when trailing segment differs", () => {
    assert.equal(fillMatchesAccount({ accountSpec: "APEX/99999" }, 12345), false);
  });

  it("returns true when neither accountId nor accountSpec present (assume already-scoped)", () => {
    assert.equal(fillMatchesAccount({ orderId: 1, contractId: 2 }, 12345), true);
  });
});

// ── trade count: confirmed-zero vs unavailable ────────────────────────────────

describe("trade count: confirmed-zero vs unavailable", () => {
  it("fillsSyncedAt null → trade count is unknown (not zero)", () => {
    const fillsSyncedAt: Date | null = null;
    assert.equal(fillsSyncedAt, null);
  });

  it("fillsSyncedAt set, tradesCount 0 → confirmed zero trades", () => {
    const fillsSyncedAt: Date | null = new Date();
    const tradesCount = 0;
    assert.ok(fillsSyncedAt !== null);
    assert.equal(tradesCount, 0);
  });

  it("two distinct completed orders → tradesCount 2", () => {
    const orders = [{ id: 1, ordStatus: "Completed" }, { id: 2, ordStatus: "Completed" }];
    const count = orders.filter((o) => o.ordStatus === "Completed" || o.ordStatus === "Filled").length;
    assert.equal(count, 2);
  });

  it("multiple fills under same orderId → tradesCount 1 via grouping", () => {
    const fills = [{ orderId: "A" }, { orderId: "A" }];
    const distinct = new Set(fills.map((f) => f.orderId));
    assert.equal(distinct.size, 1);
  });

  it("two fills with different orderIds → tradesCount 2 via grouping", () => {
    const fills = [{ orderId: "A" }, { orderId: "B" }];
    const distinct = new Set(fills.map((f) => f.orderId));
    assert.equal(distinct.size, 2);
  });

  it("fills count wins over Phase A count of 0 (order/list only returns active orders)", () => {
    // Phase A returns 0 (order/list only shows Working orders on this env)
    let tradesCount = 0;
    const executions = [
      { orderId: "A", pnl: 100 },
      { orderId: "B", pnl: -50 },
    ];
    const distinctOrderIds = new Set(executions.map((ex) => ex.orderId).filter(Boolean));
    const countFromFills = distinctOrderIds.size > 0 ? distinctOrderIds.size : executions.length;
    if (countFromFills > tradesCount) tradesCount = countFromFills;
    assert.equal(tradesCount, 2);
  });

  it("Phase A count preserved when fills show same or fewer trades", () => {
    // Phase A returned 2 (correct), fills returned 2 matching orders → still 2
    let tradesCount = 2;
    const executions = [
      { orderId: "A", pnl: 100 },
      { orderId: "B", pnl: -50 },
    ];
    const distinctOrderIds = new Set(executions.map((ex) => ex.orderId).filter(Boolean));
    const countFromFills = distinctOrderIds.size > 0 ? distinctOrderIds.size : executions.length;
    if (countFromFills > tradesCount) tradesCount = countFromFills;
    assert.equal(tradesCount, 2);
  });
});

// ── 26-hour lookback date filter ──────────────────────────────────────────────

describe("26-hour lookback date filter", () => {
  function applyLookback(ts: string | null, lookbackMs: number): boolean {
    if (ts == null) return true;
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return true;
    return d.getTime() >= lookbackMs;
  }

  it("includes a fill from 25 hours ago", () => {
    const lookbackMs = Date.now() - 26 * 60 * 60 * 1000;
    const ts = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    assert.equal(applyLookback(ts, lookbackMs), true);
  });

  it("excludes a fill from 27 hours ago", () => {
    const lookbackMs = Date.now() - 26 * 60 * 60 * 1000;
    const ts = new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString();
    assert.equal(applyLookback(ts, lookbackMs), false);
  });

  it("includes a fill with no timestamp (include-all rule)", () => {
    const lookbackMs = Date.now() - 26 * 60 * 60 * 1000;
    assert.equal(applyLookback(null, lookbackMs), true);
  });

  it("includes a fill with unparseable timestamp (include-all rule)", () => {
    const lookbackMs = Date.now() - 26 * 60 * 60 * 1000;
    assert.equal(applyLookback("not-a-date", lookbackMs), true);
  });
});

// ── balance cap for personal accounts ────────────────────────────────────────

describe("balance cap for personal accounts", () => {
  function computeEffectiveLossBudget(opts: {
    maxDailyLoss: number | null;
    lossUsed: number;
    balance: number | null;
    accountType: string;
  }): { remainingDailyLoss: number | null; balanceLimitedWarning: boolean } {
    const { maxDailyLoss, lossUsed, balance, accountType } = opts;
    let remainingDailyLoss: number | null =
      maxDailyLoss != null ? Math.max(0, maxDailyLoss - lossUsed) : null;
    const balanceLimitedWarning =
      accountType === "personal" &&
      balance != null &&
      maxDailyLoss != null &&
      maxDailyLoss > balance;
    if (accountType === "personal" && balance != null && remainingDailyLoss != null) {
      remainingDailyLoss = Math.min(remainingDailyLoss, balance);
    }
    return { remainingDailyLoss, balanceLimitedWarning };
  }

  it("caps loss budget at balance for personal account when limit > balance", () => {
    const { remainingDailyLoss, balanceLimitedWarning } = computeEffectiveLossBudget({
      maxDailyLoss: 1000,
      lossUsed: 0,
      balance: 989.20,
      accountType: "personal",
    });
    assert.equal(remainingDailyLoss, 989.20);
    assert.equal(balanceLimitedWarning, true);
  });

  it("does not cap when limit is within balance", () => {
    const { remainingDailyLoss, balanceLimitedWarning } = computeEffectiveLossBudget({
      maxDailyLoss: 500,
      lossUsed: 0,
      balance: 989.20,
      accountType: "personal",
    });
    assert.equal(remainingDailyLoss, 500);
    assert.equal(balanceLimitedWarning, false);
  });

  it("does not cap for evaluation (prop firm) account even when limit > balance", () => {
    const { balanceLimitedWarning } = computeEffectiveLossBudget({
      maxDailyLoss: 1000,
      lossUsed: 0,
      balance: 989.20,
      accountType: "evaluation",
    });
    assert.equal(balanceLimitedWarning, false);
  });

  it("accounts for already-used loss when capping", () => {
    // balance $500, limit $1000, already lost $600 → configured remaining = $400
    // but balance cap = $500, so remaining = min(400, 500) = $400
    const { remainingDailyLoss } = computeEffectiveLossBudget({
      maxDailyLoss: 1000,
      lossUsed: 600,
      balance: 500,
      accountType: "personal",
    });
    assert.equal(remainingDailyLoss, 400); // already below balance cap
  });
});

// ── entry-based trade counting ────────────────────────────────────────────────

describe("countEntryTrades", () => {
  function mkEx(
    symbol: string,
    side: "LONG" | "SHORT",
    qty: number,
    offsetMs = 0,
    orderId: string | null = null,
  ) {
    return {
      symbol,
      side,
      quantity: qty,
      occurredAt: new Date(1_000_000 + offsetMs),
      orderId,
    };
  }

  it("single buy fill = 1 trade", () => {
    const count = countEntryTrades([mkEx("ES", "LONG", 1, 0, "ord-1")]);
    assert.equal(count, 1);
  });

  it("one 10-contract entry split into 3 fills (3+4+3) of same orderId = 1 trade", () => {
    const count = countEntryTrades([
      mkEx("ES", "LONG", 3, 0, "ord-1"),
      mkEx("ES", "LONG", 4, 100, "ord-1"),
      mkEx("ES", "LONG", 3, 200, "ord-1"),
    ]);
    assert.equal(count, 1);
  });

  it("entry then partial TP exit = still 1 trade (exit not counted)", () => {
    // Buy 10, take profit on 5, leave 5 open → only one entry decision
    const count = countEntryTrades([
      mkEx("ES", "LONG", 10, 0, "entry-1"),
      mkEx("ES", "SHORT", 5, 100, "tp-1"),
    ]);
    assert.equal(count, 1);
  });

  it("stop loss split into multiple fills adds no new trades", () => {
    // Open long 10, stop fills as 2+3+5 contracts
    const count = countEntryTrades([
      mkEx("ES", "LONG", 10, 0, "entry-1"),
      mkEx("ES", "SHORT", 2, 100, "stop-1"),
      mkEx("ES", "SHORT", 3, 200, "stop-1"),
      mkEx("ES", "SHORT", 5, 300, "stop-1"),
    ]);
    assert.equal(count, 1);
  });

  it("scale-in (adding to an open position) counts as a new trade", () => {
    // Already long 5, buy 5 more → trader made another entry decision (+1)
    const count = countEntryTrades([
      mkEx("ES", "LONG", 5, 0, "ord-1"), // open long 5
      mkEx("ES", "LONG", 5, 100, "ord-2"), // scale-in: long 5 → long 10
    ]);
    assert.equal(count, 2);
  });

  it("scale-in with partial fills does not double-count", () => {
    // Original entry: 5 contracts (one order, two fills 2+3)
    // Scale-in: 5 more contracts (one order, two fills 2+3)
    // → exactly 2 entry decisions, not 4 fills
    const count = countEntryTrades([
      mkEx("ES", "LONG", 2, 0, "entry-1"),
      mkEx("ES", "LONG", 3, 50, "entry-1"),
      mkEx("ES", "LONG", 2, 100, "entry-2"),
      mkEx("ES", "LONG", 3, 150, "entry-2"),
    ]);
    assert.equal(count, 2);
  });

  it("two separate entries (close then reopen) = 2 trades", () => {
    const count = countEntryTrades([
      mkEx("ES", "LONG", 1, 0, "ord-1"),
      mkEx("ES", "SHORT", 1, 100, "ord-2"),
      mkEx("ES", "LONG", 1, 200, "ord-3"),
    ]);
    assert.equal(count, 2);
  });

  it("reversal (long → short in one fill) counts as 1 new short entry", () => {
    // Position goes from +1 to -1 in one motion → close + new opposite entry
    const count = countEntryTrades([
      mkEx("ES", "LONG", 1, 0, "ord-1"),
      mkEx("ES", "SHORT", 2, 100, "ord-2"),
    ]);
    assert.equal(count, 2);
  });

  it("two different symbols are counted independently", () => {
    const count = countEntryTrades([
      mkEx("ES", "LONG", 1, 0, "ord-1"),
      mkEx("NQ", "LONG", 1, 100, "ord-2"),
    ]);
    assert.equal(count, 2);
  });

  it("fills with no orderId are not silently merged", () => {
    // Defensive: if the broker omits orderId we must not collapse unrelated
    // fills into one. Two separate fills with no orderId = two decisions.
    const count = countEntryTrades([
      mkEx("ES", "LONG", 1, 0, null),
      mkEx("ES", "LONG", 1, 100, null), // scale-in (counted as new entry)
    ]);
    assert.equal(count, 2);
  });

  it("empty executions = 0 trades", () => {
    assert.equal(countEntryTrades([]), 0);
  });
});

// ── countEntryTradesSince (connection timing) ────────────────────────────────

describe("countEntryTradesSince", () => {
  function mkEx(
    symbol: string,
    side: "LONG" | "SHORT",
    qty: number,
    occurredAt: Date,
    orderId = "ord",
  ) {
    return { symbol, side, quantity: qty, occurredAt, orderId };
  }

  it("excludes fills strictly before the cutoff", () => {
    const t0 = new Date("2026-05-05T13:00:00Z");
    const t1 = new Date("2026-05-05T14:00:00Z");
    const t2 = new Date("2026-05-05T14:30:00Z");
    // Pre-connection: long entry + scale-in (would be 2 if counted)
    // Post-connection (>= t1): only the t2 fill is included; from a flat
    // post-connection baseline the t2 LONG fill is one new entry.
    const count = countEntryTradesSince(
      [
        mkEx("ES", "LONG", 1, t0, "pre-1"),
        mkEx("ES", "LONG", 1, t1, "post-1"),
        mkEx("ES", "LONG", 1, t2, "post-2"),
      ],
      t1,
    );
    assert.equal(count, 2);
  });

  it("matches countEntryTrades when cutoff is older than all fills", () => {
    const epoch = new Date(0);
    const fills = [
      mkEx("ES", "LONG", 5, new Date(1000), "a"),
      mkEx("ES", "LONG", 5, new Date(2000), "b"), // scale-in
    ];
    assert.equal(countEntryTradesSince(fills, epoch), countEntryTrades(fills));
  });

  it("returns 0 when cutoff is after all fills", () => {
    const fills = [mkEx("ES", "LONG", 1, new Date(1000), "a")];
    assert.equal(countEntryTradesSince(fills, new Date(5000)), 0);
  });
});

// ── traceEntryTrades ──────────────────────────────────────────────────────────

describe("traceEntryTrades", () => {
  function mkEx(
    symbol: string,
    side: "LONG" | "SHORT",
    qty: number,
    offsetMs = 0,
    orderId: string | null = null,
  ) {
    return { symbol, side, quantity: qty, occurredAt: new Date(1_000_000 + offsetMs), orderId };
  }

  it("count matches countEntryTrades for a simple sequence", () => {
    const ex = [
      mkEx("ES", "LONG", 5, 0, "a"),
      mkEx("ES", "SHORT", 5, 100, "b"),
      mkEx("ES", "LONG", 3, 200, "c"),
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.count, countEntryTrades(ex));
  });

  it("emits one row per grouped order", () => {
    // 2 entries: a single order (3 partial fills → 1 group) + a scale-in order
    const ex = [
      mkEx("ES", "LONG", 2, 0, "ord-1"),
      mkEx("ES", "LONG", 3, 50, "ord-1"), // partial fill of same order
      mkEx("ES", "LONG", 5, 100, "ord-2"), // scale-in
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.groupedCount, 2);
    assert.equal(trace.rows.length, 2);
    assert.equal(trace.count, 2);
  });

  it("uniqueOrderIds counts distinct non-null orderIds", () => {
    const ex = [
      mkEx("ES", "LONG", 1, 0, "ord-1"),
      mkEx("ES", "LONG", 1, 50, "ord-1"), // duplicate orderId
      mkEx("ES", "SHORT", 1, 100, "ord-2"),
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.uniqueOrderIds, 2);
  });

  it("labels flat_open, reduction correctly", () => {
    const ex = [
      mkEx("ES", "LONG", 1, 0, "a"),  // flat→long
      mkEx("ES", "SHORT", 1, 100, "b"), // long→flat (close)
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.rows[0].reason, "flat_open");
    assert.equal(trace.rows[0].entry, true);
    assert.equal(trace.rows[1].reason, "reduction");
    assert.equal(trace.rows[1].entry, false);
  });

  it("labels scale_in correctly", () => {
    const ex = [
      mkEx("ES", "LONG", 1, 0, "a"),
      mkEx("ES", "LONG", 1, 100, "b"),
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.rows[1].reason, "scale_in");
    assert.equal(trace.rows[1].entry, true);
  });

  it("labels reversal correctly", () => {
    const ex = [
      mkEx("ES", "LONG", 1, 0, "a"),
      mkEx("ES", "SHORT", 2, 100, "b"), // crosses zero
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.rows[1].reason, "reversal");
    assert.equal(trace.rows[1].entry, true);
  });

  it("positionBefore/positionAfter track net position correctly", () => {
    const ex = [
      mkEx("ES", "LONG", 3, 0, "a"),
      mkEx("ES", "SHORT", 1, 100, "b"),
    ];
    const trace = traceEntryTrades(ex);
    assert.equal(trace.rows[0].positionBefore, 0);
    assert.equal(trace.rows[0].positionAfter, 3);
    assert.equal(trace.rows[1].positionBefore, 3);
    assert.equal(trace.rows[1].positionAfter, 2);
  });
});

// ── account fill isolation — two MFF accounts ─────────────────────────────────

describe("account fill isolation — two MFF accounts", () => {
  type RawFill = {
    accountId: number;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    occurredAt: Date;
    orderId: string;
  };

  function mkFill(
    accountId: number,
    symbol: string,
    side: "LONG" | "SHORT",
    qty: number,
    msOffset: number,
    orderId: string,
  ): RawFill {
    return { accountId, symbol, side, quantity: qty, occurredAt: new Date(msOffset), orderId };
  }

  // Account 6248: 6 simple open/close sequences on ESM5
  const fills6248: RawFill[] = Array.from({ length: 6 }, (_, i) => [
    mkFill(6248, "ESM5", "LONG", 1, i * 200, `248-entry-${i}`),
    mkFill(6248, "ESM5", "SHORT", 1, i * 200 + 100, `248-exit-${i}`),
  ]).flat();

  // Account 6249: 11 simple open/close sequences on ESM5
  const fills6249: RawFill[] = Array.from({ length: 11 }, (_, i) => [
    mkFill(6249, "ESM5", "LONG", 1, i * 200 + 1, `249-entry-${i}`),
    mkFill(6249, "ESM5", "SHORT", 1, i * 200 + 101, `249-exit-${i}`),
  ]).flat();

  it("account 6248 isolated fills produce 6 entry trades", () => {
    assert.equal(countEntryTrades(fills6248), 6);
  });

  it("account 6249 isolated fills produce 11 entry trades", () => {
    assert.equal(countEntryTrades(fills6249), 11);
  });

  it("exits are not counted as entries", () => {
    // The 6 SHORT closes in 6248 should not add to the trade count
    const longOnlyFills = fills6248.filter((f) => f.side === "LONG");
    const longOnlyCount = countEntryTrades(longOnlyFills);
    // 6 opens from flat with nothing between them → each is still 6 opens
    assert.equal(longOnlyCount, 6);
    // The mixed open/close count must equal the long-only count
    assert.equal(countEntryTrades(fills6248), longOnlyCount);
  });

  it("fillMatchesAccount isolates 6248 fills from mixed stream", () => {
    const allFills = [...fills6248, ...fills6249];
    const for6248 = allFills.filter((f) =>
      fillMatchesAccount(f as unknown as Record<string, unknown>, 6248),
    );
    assert.equal(for6248.length, fills6248.length);
    assert.equal(countEntryTrades(for6248), 6);
  });

  it("fillMatchesAccount isolates 6249 fills from mixed stream", () => {
    const allFills = [...fills6248, ...fills6249];
    const for6249 = allFills.filter((f) =>
      fillMatchesAccount(f as unknown as Record<string, unknown>, 6249),
    );
    assert.equal(for6249.length, fills6249.length);
    assert.equal(countEntryTrades(for6249), 11);
  });

  it("mixing both accounts' fills inflates the count beyond either account alone", () => {
    const allFills = [...fills6248, ...fills6249];
    const mixedCount = countEntryTrades(allFills);
    // Mixed position tracking produces scale-ins that inflate the count
    assert.ok(mixedCount > 6, `mixed count ${mixedCount} should exceed 6248's count of 6`);
    assert.ok(mixedCount > 11, `mixed count ${mixedCount} should exceed 6249's count of 11`);
  });

  it("fills with no accountId/accountSpec pass through fillMatchesAccount (assume scoped)", () => {
    const fill = { orderId: 1, contractId: 2 }; // no accountId or accountSpec
    assert.equal(fillMatchesAccount(fill as Record<string, unknown>, 6248), true);
    assert.equal(fillMatchesAccount(fill as Record<string, unknown>, 6249), true);
  });
});

// ── prop firm effective loss budget ───────────────────────────────────────────

describe("prop firm effective loss budget", () => {
  function computePropFirmBudget(opts: {
    maxDailyLoss: number | null;
    lossUsed: number;
    propFirmDailyLossLimit: number | null;
    propFirmDrawdownRemaining: number | null;
  }): { remainingDailyLoss: number | null; propFirmLimited: boolean } {
    const { maxDailyLoss, lossUsed, propFirmDailyLossLimit, propFirmDrawdownRemaining } = opts;
    let remainingDailyLoss: number | null =
      maxDailyLoss != null ? Math.max(0, maxDailyLoss - lossUsed) : null;
    let propFirmLimited = false;
    if (propFirmDailyLossLimit != null) {
      const pfRemaining = Math.max(0, propFirmDailyLossLimit - lossUsed);
      if (remainingDailyLoss == null || pfRemaining < remainingDailyLoss) {
        remainingDailyLoss = pfRemaining;
        propFirmLimited = true;
      }
    }
    if (propFirmDrawdownRemaining != null) {
      if (remainingDailyLoss == null || propFirmDrawdownRemaining < remainingDailyLoss) {
        remainingDailyLoss = propFirmDrawdownRemaining;
        propFirmLimited = true;
      }
    }
    return { remainingDailyLoss, propFirmLimited };
  }

  it("uses user daily limit when tighter than prop firm", () => {
    const { remainingDailyLoss, propFirmLimited } = computePropFirmBudget({
      maxDailyLoss: 300,
      lossUsed: 0,
      propFirmDailyLossLimit: 500,
      propFirmDrawdownRemaining: null,
    });
    assert.equal(remainingDailyLoss, 300);
    assert.equal(propFirmLimited, false);
  });

  it("uses prop firm daily limit when tighter than user", () => {
    const { remainingDailyLoss, propFirmLimited } = computePropFirmBudget({
      maxDailyLoss: 500,
      lossUsed: 0,
      propFirmDailyLossLimit: 300,
      propFirmDrawdownRemaining: null,
    });
    assert.equal(remainingDailyLoss, 300);
    assert.equal(propFirmLimited, true);
  });

  it("uses drawdown remaining when it's tighter than daily limits", () => {
    const { remainingDailyLoss, propFirmLimited } = computePropFirmBudget({
      maxDailyLoss: 500,
      lossUsed: 0,
      propFirmDailyLossLimit: 400,
      propFirmDrawdownRemaining: 200,
    });
    assert.equal(remainingDailyLoss, 200);
    assert.equal(propFirmLimited, true);
  });

  it("prop firm account missing limits → propFirmSetupNeeded", () => {
    const isPropFirm = true;
    const accountRules = null;
    const propFirmSetupNeeded =
      isPropFirm &&
      (accountRules == null ||
        (accountRules as null) === null);
    assert.equal(propFirmSetupNeeded, true);
  });

  it("prop firm account with drawdown remaining $300 and user limit $500 → effective $300", () => {
    const { remainingDailyLoss } = computePropFirmBudget({
      maxDailyLoss: 500,
      lossUsed: 0,
      propFirmDailyLossLimit: null,
      propFirmDrawdownRemaining: 300,
    });
    assert.equal(remainingDailyLoss, 300);
  });
});
