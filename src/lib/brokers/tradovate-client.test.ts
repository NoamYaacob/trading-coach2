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
