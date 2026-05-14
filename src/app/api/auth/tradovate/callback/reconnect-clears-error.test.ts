/**
 * Source-scan tests for the OAuth callback reconnect path.
 *
 * Verifies that a successful OAuth reconnect clears stale renewal error state
 * so a healthy connection does not appear broken in the debug endpoint or any
 * future alerting.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_FILE = resolve(import.meta.dirname, "./route.ts");

function src(): string {
  return readFileSync(ROUTE_FILE, "utf8");
}

describe("OAuth callback: reconnect path clears lastRenewError", () => {
  it("sets lastRenewError: null on reconnect update", () => {
    const s = src();
    // Find the reconnect update block
    const reconnectUpdateIdx = s.indexOf("payload.reconnectId");
    assert.ok(reconnectUpdateIdx !== -1, "reconnect path must exist");
    const updateBlock = s.slice(
      reconnectUpdateIdx,
      s.indexOf("await prisma.connectedAccount.updateMany", reconnectUpdateIdx),
    );
    assert.ok(
      updateBlock.includes("lastRenewError: null"),
      "reconnect brokerConnection.update must set lastRenewError: null",
    );
  });

  it("sets lastRenewedAt to current timestamp on reconnect update", () => {
    const s = src();
    const reconnectUpdateIdx = s.indexOf("payload.reconnectId");
    const updateBlock = s.slice(
      reconnectUpdateIdx,
      s.indexOf("await prisma.connectedAccount.updateMany", reconnectUpdateIdx),
    );
    assert.ok(
      updateBlock.includes("lastRenewedAt: new Date()"),
      "reconnect brokerConnection.update must set lastRenewedAt: new Date()",
    );
  });

  it("clears errorMessage on reconnect update", () => {
    const s = src();
    const reconnectUpdateIdx = s.indexOf("payload.reconnectId");
    const updateBlock = s.slice(
      reconnectUpdateIdx,
      s.indexOf("await prisma.connectedAccount.updateMany", reconnectUpdateIdx),
    );
    assert.ok(
      updateBlock.includes("errorMessage: null"),
      "reconnect brokerConnection.update must clear errorMessage",
    );
  });

  it("initial create path does not set lastRenewError (never been renewed)", () => {
    const s = src();
    // The create block starts after the reconnect path ends
    const createIdx = s.indexOf("brokerConnection = await prisma.brokerConnection.create");
    assert.ok(createIdx !== -1, "create path must exist");
    const createBlock = s.slice(createIdx, s.indexOf("}, select:", createIdx) + 20);
    assert.ok(
      !createBlock.includes("lastRenewError"),
      "initial create must not set lastRenewError (field starts as null by schema default)",
    );
  });
});
