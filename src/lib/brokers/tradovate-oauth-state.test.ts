import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decodeOAuthState,
  encodeOAuthState,
  generateOAuthNonce,
  validateOAuthState,
} from "./tradovate-oauth-state.ts";

describe("tradovate-oauth-state", () => {
  describe("encode / decode round-trip", () => {
    it("survives encode → decode", () => {
      const state = {
        nonce: "abc123",
        userId: "user_xyz",
        env: "live" as const,
      };
      const encoded = encodeOAuthState(state);
      const decoded = decodeOAuthState(encoded);
      assert.equal(decoded.ok, true);
      if (decoded.ok) {
        assert.deepEqual(decoded.state, { ...state, setupId: undefined });
      }
    });

    it("decodes a demo env", () => {
      const state = { nonce: "n", userId: "u", env: "demo" as const };
      const decoded = decodeOAuthState(encodeOAuthState(state));
      assert.equal(decoded.ok, true);
      if (decoded.ok) assert.equal(decoded.state.env, "demo");
    });
  });

  describe("decodeOAuthState rejects malformed input", () => {
    it("rejects non-base64url junk", () => {
      assert.deepEqual(decodeOAuthState("@@@not base64@@@"), {
        ok: false,
        reason: "invalid_state",
      });
    });

    it("rejects valid base64 of non-JSON", () => {
      const raw = Buffer.from("not json").toString("base64url");
      assert.deepEqual(decodeOAuthState(raw), {
        ok: false,
        reason: "invalid_state",
      });
    });

    it("rejects missing fields", () => {
      const raw = Buffer.from(JSON.stringify({ nonce: "x" })).toString("base64url");
      assert.deepEqual(decodeOAuthState(raw), {
        ok: false,
        reason: "invalid_state",
      });
    });

    it("rejects unknown env value", () => {
      const raw = Buffer.from(
        JSON.stringify({ nonce: "n", userId: "u", env: "paper" }),
      ).toString("base64url");
      assert.deepEqual(decodeOAuthState(raw), {
        ok: false,
        reason: "invalid_state",
      });
    });

    it("rejects empty userId", () => {
      const raw = Buffer.from(
        JSON.stringify({ nonce: "n", userId: "", env: "live" }),
      ).toString("base64url");
      assert.deepEqual(decodeOAuthState(raw), {
        ok: false,
        reason: "invalid_state",
      });
    });
  });

  describe("validateOAuthState", () => {
    const baseState = { nonce: "n1", userId: "user_a", env: "live" as const };
    const rawState = encodeOAuthState(baseState);

    it("passes when nonce + session match", () => {
      const r = validateOAuthState({
        rawState,
        cookieNonce: "n1",
        sessionUserId: "user_a",
      });
      assert.equal(r.ok, true);
    });

    it("rejects csrf_mismatch when cookie nonce missing", () => {
      const r = validateOAuthState({
        rawState,
        cookieNonce: null,
        sessionUserId: "user_a",
      });
      assert.deepEqual(r, { ok: false, reason: "csrf_mismatch" });
    });

    it("rejects csrf_mismatch when nonces differ", () => {
      const r = validateOAuthState({
        rawState,
        cookieNonce: "different",
        sessionUserId: "user_a",
      });
      assert.deepEqual(r, { ok: false, reason: "csrf_mismatch" });
    });

    it("rejects session_mismatch when state.userId != session userId", () => {
      // Attacker who has cookie nonce n1 cannot redirect tokens to a
      // different user — the callback rejects before any DB write.
      const r = validateOAuthState({
        rawState,
        cookieNonce: "n1",
        sessionUserId: "user_b",
      });
      assert.deepEqual(r, { ok: false, reason: "session_mismatch" });
    });

    it("rejects invalid_state when raw cannot be decoded", () => {
      const r = validateOAuthState({
        rawState: "@@@invalid@@@",
        cookieNonce: "n1",
        sessionUserId: "user_a",
      });
      assert.deepEqual(r, { ok: false, reason: "invalid_state" });
    });
  });

  describe("generateOAuthNonce", () => {
    it("returns a 32-char hex string (16 bytes)", () => {
      const n = generateOAuthNonce();
      assert.match(n, /^[0-9a-f]{32}$/);
    });

    it("returns distinct values across calls", () => {
      const a = generateOAuthNonce();
      const b = generateOAuthNonce();
      assert.notEqual(a, b);
    });
  });
});
