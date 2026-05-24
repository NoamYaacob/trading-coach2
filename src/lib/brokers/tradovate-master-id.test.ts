/**
 * Unit tests for parseTradovateMasterId — strict externalAccountId/masterid validation.
 *
 * Guards the safety property: any invalid externalAccountId must fail-closed,
 * not silently produce NaN or a truncated integer that could route a broker
 * write to the wrong account.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseTradovateMasterId,
  isValidTradovateMasterId,
} from "./tradovate-master-id.ts";

describe("parseTradovateMasterId — rejects invalid inputs", () => {
  it("rejects null", () => {
    assert.equal(parseTradovateMasterId(null), null);
  });

  it("rejects undefined", () => {
    assert.equal(parseTradovateMasterId(undefined), null);
  });

  it("rejects empty string", () => {
    assert.equal(parseTradovateMasterId(""), null);
  });

  it("rejects whitespace-only string", () => {
    assert.equal(parseTradovateMasterId("   "), null);
  });

  it("rejects pure alpha 'abc'", () => {
    assert.equal(parseTradovateMasterId("abc"), null);
  });

  it("rejects partial numeric '123abc' (no silent truncation)", () => {
    assert.equal(parseTradovateMasterId("123abc"), null);
  });

  it("rejects leading-alpha 'abc123'", () => {
    assert.equal(parseTradovateMasterId("abc123"), null);
  });

  it("rejects float '12.5'", () => {
    assert.equal(parseTradovateMasterId("12.5"), null);
  });

  it("rejects scientific notation '1e3'", () => {
    assert.equal(parseTradovateMasterId("1e3"), null);
  });

  it("rejects explicit-positive '+123'", () => {
    assert.equal(parseTradovateMasterId("+123"), null);
  });

  it("rejects zero '0' (Tradovate ids are always positive)", () => {
    assert.equal(parseTradovateMasterId("0"), null);
  });

  it("rejects negative '-100'", () => {
    assert.equal(parseTradovateMasterId("-100"), null);
  });

  it("rejects hex '0x10'", () => {
    assert.equal(parseTradovateMasterId("0x10"), null);
  });

  it("rejects 'NaN'", () => {
    assert.equal(parseTradovateMasterId("NaN"), null);
  });

  it("rejects 'Infinity'", () => {
    assert.equal(parseTradovateMasterId("Infinity"), null);
  });

  it("rejects non-string input (number)", () => {
    assert.equal(parseTradovateMasterId(123 as unknown as string), null);
  });
});

describe("parseTradovateMasterId — accepts valid inputs", () => {
  it("accepts a small positive integer", () => {
    assert.equal(parseTradovateMasterId("1"), 1);
  });

  it("accepts a typical Tradovate account id '6248'", () => {
    assert.equal(parseTradovateMasterId("6248"), 6248);
  });

  it("accepts a 9-digit id", () => {
    assert.equal(parseTradovateMasterId("123456789"), 123456789);
  });

  it("trims surrounding whitespace before validating", () => {
    assert.equal(parseTradovateMasterId("  6248  "), 6248);
  });

  it("rejects whitespace inside the digits", () => {
    assert.equal(parseTradovateMasterId("62 48"), null);
  });
});

describe("isValidTradovateMasterId", () => {
  it("returns true for valid id", () => {
    assert.equal(isValidTradovateMasterId("6248"), true);
  });

  it("returns false for 'abc'", () => {
    assert.equal(isValidTradovateMasterId("abc"), false);
  });

  it("returns false for '123abc'", () => {
    assert.equal(isValidTradovateMasterId("123abc"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isValidTradovateMasterId(""), false);
  });

  it("returns false for null", () => {
    assert.equal(isValidTradovateMasterId(null), false);
  });
});
