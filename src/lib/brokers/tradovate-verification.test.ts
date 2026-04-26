/**
 * Unit tests for Tradovate verification helpers.
 *
 * Covers pure helpers: error → token-status mapping, error description,
 * contract-resolution detection, and label / skip-name constants. Higher-
 * level integration tests (full runTradovateVerification with mocked
 * client) are out of scope for this runner — see docs for manual test
 * instructions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CHECK_LABELS,
  SKIP_NAMES,
  describeError,
  hasUnresolvedContracts,
  tokenStatusFromErr,
} from "./tradovate-verification-helpers.ts";
import { TradovateClientError } from "./tradovate-client-helpers.ts";
import type {
  BrokerExecution,
  BrokerOrder,
  BrokerPosition,
} from "./types.ts";

// ── tokenStatusFromErr ────────────────────────────────────────────────────────

describe("tokenStatusFromErr", () => {
  it("CONFIG_MISSING → config_missing", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("CONFIG_MISSING", "")),
      "config_missing",
    );
  });

  it("TOKEN_EXPIRED_NO_REFRESH → no_refresh", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("TOKEN_EXPIRED_NO_REFRESH", "")),
      "no_refresh",
    );
  });

  it("REFRESH_FAILED → expired", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("REFRESH_FAILED", "")),
      "expired",
    );
  });

  it("REFRESH_STORE_FAILED → expired", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("REFRESH_STORE_FAILED", "")),
      "expired",
    );
  });

  it("NO_TOKENS → load_failed", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("NO_TOKENS", "")),
      "load_failed",
    );
  });

  it("TOKEN_LOAD_FAILED → load_failed", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("TOKEN_LOAD_FAILED", "")),
      "load_failed",
    );
  });

  it("API_ERROR → unknown (not a token error)", () => {
    assert.equal(
      tokenStatusFromErr(new TradovateClientError("API_ERROR", "")),
      "unknown",
    );
  });

  it("plain Error → unknown", () => {
    assert.equal(tokenStatusFromErr(new Error("boom")), "unknown");
  });

  it("non-error value → unknown", () => {
    assert.equal(tokenStatusFromErr("a string"), "unknown");
  });
});

// ── describeError ─────────────────────────────────────────────────────────────

describe("describeError", () => {
  it("captures TradovateClientError code and message", () => {
    const result = describeError(new TradovateClientError("API_ERROR", "503 from upstream", 503));
    assert.equal(result.code, "API_ERROR");
    assert.equal(result.message, "503 from upstream");
  });

  it("uses UNKNOWN for plain Error", () => {
    const result = describeError(new Error("oops"));
    assert.equal(result.code, "UNKNOWN");
    assert.equal(result.message, "oops");
  });

  it("uses UNKNOWN for non-Error values", () => {
    const result = describeError({ wat: true });
    assert.equal(result.code, "UNKNOWN");
    assert.equal(result.message, "Unknown error.");
  });
});

// ── hasUnresolvedContracts ────────────────────────────────────────────────────

const PLAIN_DATE = new Date("2026-01-01T00:00:00Z");

function pos(symbol: string): BrokerPosition {
  return {
    positionId: "1",
    symbol,
    side: "LONG",
    quantity: 1,
    averagePrice: 100,
    unrealizedPnL: 0,
    asOf: PLAIN_DATE,
  };
}

function ord(symbol: string): BrokerOrder {
  return {
    orderId: "1",
    symbol,
    side: "LONG",
    quantity: 1,
    status: "WORKING",
    type: "LIMIT",
    limitPrice: 100,
    stopPrice: null,
    placedAt: PLAIN_DATE,
  };
}

function exe(symbol: string): BrokerExecution {
  return {
    executionId: "1",
    orderId: "1",
    symbol,
    side: "LONG",
    quantity: 1,
    price: 100,
    pnl: null,
    occurredAt: PLAIN_DATE,
  };
}

describe("hasUnresolvedContracts", () => {
  it("false when all symbols are non-numeric", () => {
    assert.equal(
      hasUnresolvedContracts([pos("ESM5")], [ord("NQM5")], [exe("MNQU5")]),
      false,
    );
  });

  it("true when any position symbol is numeric", () => {
    assert.equal(
      hasUnresolvedContracts([pos("123456")], [ord("NQM5")], []),
      true,
    );
  });

  it("true when any order symbol is numeric", () => {
    assert.equal(
      hasUnresolvedContracts([pos("ESM5")], [ord("987654")], []),
      true,
    );
  });

  it("true when any execution symbol is numeric", () => {
    assert.equal(
      hasUnresolvedContracts([], [], [exe("42")]),
      true,
    );
  });

  it("false on empty arrays", () => {
    assert.equal(hasUnresolvedContracts([], [], []), false);
  });

  it("alphanumeric like 'ES1!' is treated as resolved", () => {
    assert.equal(
      hasUnresolvedContracts([pos("ES1!")], [], []),
      false,
    );
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe("CHECK_LABELS / SKIP_NAMES", () => {
  it("has a label for every check name", () => {
    const expected = [
      "tokens",
      "account_discovery",
      "balance",
      "positions",
      "orders",
      "executions",
      "contracts",
    ];
    for (const name of expected) {
      assert.ok(
        typeof CHECK_LABELS[name as keyof typeof CHECK_LABELS] === "string" &&
          CHECK_LABELS[name as keyof typeof CHECK_LABELS].length > 0,
        `missing label for ${name}`,
      );
    }
  });

  it("SKIP_NAMES does not include 'tokens'", () => {
    assert.ok(!SKIP_NAMES.includes("tokens" as never));
  });

  it("SKIP_NAMES covers every non-token check", () => {
    const expected = [
      "account_discovery",
      "balance",
      "positions",
      "orders",
      "executions",
      "contracts",
    ];
    for (const name of expected) {
      assert.ok(SKIP_NAMES.includes(name as never), `missing skip for ${name}`);
    }
  });
});

// ── No-token-exposure schema check ────────────────────────────────────────────
// The VerificationReport type explicitly does not contain token fields;
// this test asserts the public report type names so a future refactor that
// accidentally exposes a token field gets caught.

describe("VerificationReport schema", () => {
  it("does not include token-shaped field names in CHECK_LABELS", () => {
    const labelKeys = Object.keys(CHECK_LABELS).join(",");
    assert.equal(/access_?token|refresh_?token|bearer/i.test(labelKeys), false);
  });

  it("does not include token-shaped field names in SKIP_NAMES", () => {
    const all = SKIP_NAMES.join(",");
    assert.equal(/access_?token|refresh_?token|bearer/i.test(all), false);
  });
});
