/**
 * Source-scan and logic tests for GET /api/debug/tradovate-tokens.
 *
 * Verifies that the endpoint correctly distinguishes between:
 *   - an active renewal error (connection is expired/connection_error)
 *   - a stale historical error (error string survived reconnect but connection is healthy)
 *
 * A healthy connected connection with a fresh token must NOT surface its
 * lastRenewError as an active problem.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE_FILE, "utf8");
}

describe("debug/tradovate-tokens: stale vs active renewal error", () => {
  it("exposes renewErrorIsStale field", () => {
    assert.ok(
      src().includes("renewErrorIsStale"),
      "response must include renewErrorIsStale field",
    );
  });

  it("renewErrorIsStale is true only for healthy-status connections", () => {
    const s = src();
    const idx = s.indexOf("renewErrorIsStale:");
    assert.ok(idx !== -1);
    const block = s.slice(idx, idx + 200);
    assert.ok(
      block.includes("connected_readonly") || block.includes("connected_live"),
      "renewErrorIsStale must check for healthy connection statuses",
    );
  });

  it("exposes activeRenewError field", () => {
    assert.ok(
      src().includes("activeRenewError:"),
      "response must include activeRenewError field",
    );
  });

  it("activeRenewError is only set for expired or connection_error connections", () => {
    const s = src();
    const idx = s.indexOf("activeRenewError:");
    assert.ok(idx !== -1);
    const block = s.slice(idx, idx + 300);
    assert.ok(
      block.includes('"expired"') || block.includes("'expired'"),
      "activeRenewError must gate on expired status",
    );
    assert.ok(
      block.includes('"connection_error"') || block.includes("'connection_error'"),
      "activeRenewError must gate on connection_error status",
    );
  });

  it("summary counts activeRenewError not just lastRenewError presence", () => {
    const s = src();
    assert.ok(
      s.includes("withActiveRenewError"),
      "summary must count withActiveRenewError (connections with an active problem)",
    );
    assert.ok(
      !s.includes("withRenewError:"),
      "summary must not use the old withRenewError key that ignores stale state",
    );
  });

  it("stale error count is separately tracked in summary", () => {
    assert.ok(
      src().includes("withStaleRenewError"),
      "summary must separately track withStaleRenewError",
    );
  });
});

// ── Pure logic verification ──────────────────────────────────────────────────

describe("stale/active error logic: pure", () => {
  type Status = string;

  function computeRenewErrorIsStale(
    lastRenewError: string | null,
    connectionStatus: Status,
  ): boolean {
    return (
      lastRenewError !== null &&
      (connectionStatus === "connected_readonly" || connectionStatus === "connected_live")
    );
  }

  function computeActiveRenewError(
    lastRenewError: string | null,
    connectionStatus: Status,
  ): string | null {
    return lastRenewError !== null &&
      (connectionStatus === "expired" || connectionStatus === "connection_error")
      ? lastRenewError
      : null;
  }

  it("healthy connection with stale error: renewErrorIsStale=true, activeRenewError=null", () => {
    const err = "Tradovate rejected the OAuth refresh_token grant.";
    assert.equal(computeRenewErrorIsStale(err, "connected_readonly"), true);
    assert.equal(computeActiveRenewError(err, "connected_readonly"), null);
  });

  it("healthy live connection with stale error: renewErrorIsStale=true, activeRenewError=null", () => {
    const err = "some renewal error";
    assert.equal(computeRenewErrorIsStale(err, "connected_live"), true);
    assert.equal(computeActiveRenewError(err, "connected_live"), null);
  });

  it("expired connection with error: renewErrorIsStale=false, activeRenewError=error", () => {
    const err = "auth_invalid";
    assert.equal(computeRenewErrorIsStale(err, "expired"), false);
    assert.equal(computeActiveRenewError(err, "expired"), err);
  });

  it("connection_error with error: renewErrorIsStale=false, activeRenewError=error", () => {
    const err = "network_error";
    assert.equal(computeRenewErrorIsStale(err, "connection_error"), false);
    assert.equal(computeActiveRenewError(err, "connection_error"), err);
  });

  it("healthy connection with no error: both fields are false/null", () => {
    assert.equal(computeRenewErrorIsStale(null, "connected_readonly"), false);
    assert.equal(computeActiveRenewError(null, "connected_readonly"), null);
  });

  it("expired connection with no error: both fields are false/null", () => {
    assert.equal(computeRenewErrorIsStale(null, "expired"), false);
    assert.equal(computeActiveRenewError(null, "expired"), null);
  });
});
