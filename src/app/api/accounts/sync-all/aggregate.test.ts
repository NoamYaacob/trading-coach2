import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateSyncAll } from "./aggregate.ts";

describe("aggregateSyncAll", () => {
  it("empty input → ok=true with all zeros", () => {
    const result = aggregateSyncAll([]);
    assert.equal(result.ok, true);
    assert.equal(result.syncedConnections, 0);
    assert.equal(result.failedConnections, 0);
    assert.equal(result.syncedAccounts, 0);
    assert.equal(result.failedAccounts, 0);
    assert.equal(result.results.length, 0);
  });

  it("single connection with all accounts ok → ok=true, counts increment", () => {
    const result = aggregateSyncAll([
      { connectionId: "c1", syncResults: [{ ok: true }, { ok: true }] },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.syncedConnections, 1);
    assert.equal(result.failedConnections, 0);
    assert.equal(result.syncedAccounts, 2);
    assert.equal(result.failedAccounts, 0);
  });

  it("single connection with all accounts failed → connection failed, accounts counted", () => {
    const result = aggregateSyncAll([
      { connectionId: "c1", syncResults: [{ ok: false }, { ok: false }] },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.syncedConnections, 0);
    assert.equal(result.failedConnections, 1);
    assert.equal(result.syncedAccounts, 0);
    assert.equal(result.failedAccounts, 2);
  });

  it("partial failures within a connection → connection failed (any failure)", () => {
    // Mixed: one connection with 2 ok and 1 failed. The connection itself is
    // marked failed because not every account synced — surfaces the issue
    // to the user instead of hiding it under a green tick.
    const result = aggregateSyncAll([
      { connectionId: "c1", syncResults: [{ ok: true }, { ok: true }, { ok: false }] },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.syncedConnections, 0);
    assert.equal(result.failedConnections, 1);
    assert.equal(result.syncedAccounts, 2);
    assert.equal(result.failedAccounts, 1);
  });

  it("connection with errorCode → counted as failed connection, no accounts", () => {
    const result = aggregateSyncAll([
      { connectionId: "c1", errorCode: "TOKEN_EXPIRED" },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.failedConnections, 1);
    assert.equal(result.syncedAccounts, 0);
    assert.equal(result.failedAccounts, 0);
    assert.equal(result.results[0].errorCode, "TOKEN_EXPIRED");
  });

  it("multiple connections, mixed outcomes", () => {
    const result = aggregateSyncAll([
      { connectionId: "c1", syncResults: [{ ok: true }, { ok: true }] },
      { connectionId: "c2", syncResults: [{ ok: false }] },
      { connectionId: "c3", errorCode: "NETWORK" },
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.syncedConnections, 1);
    assert.equal(result.failedConnections, 2);
    assert.equal(result.syncedAccounts, 2);
    assert.equal(result.failedAccounts, 1);
    assert.equal(result.results.length, 3);
  });

  it("connection with empty syncResults array → counted as ok (nothing failed)", () => {
    // An empty array is a valid outcome (e.g. no monitored accounts on this
    // connection) — we don't penalize the connection for having nothing to do.
    const result = aggregateSyncAll([{ connectionId: "c1", syncResults: [] }]);
    assert.equal(result.ok, true);
    assert.equal(result.syncedConnections, 1);
    assert.equal(result.failedConnections, 0);
    assert.equal(result.syncedAccounts, 0);
    assert.equal(result.failedAccounts, 0);
  });
});
