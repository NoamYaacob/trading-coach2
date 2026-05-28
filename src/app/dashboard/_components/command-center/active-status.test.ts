import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isAccountActive, partitionAccountsByActive } from "./active-status.ts";

type MinimalAccount = { id: string; status: string; connectionStatus: string };
function acc(id: string, status: string, connectionStatus = "connected_live"): MinimalAccount {
  return { id, status, connectionStatus };
}

describe("isAccountActive", () => {
  it("treats allowed/warning/locked/setup_needed as active", () => {
    for (const s of ["allowed", "warning", "locked", "setup_needed"]) {
      assert.equal(
        isAccountActive(acc("a", s) as never),
        true,
        `${s} must be active`,
      );
    }
  });

  it("treats unavailable as inactive (broker no longer returns the account)", () => {
    assert.equal(isAccountActive(acc("a", "unavailable") as never), false);
  });

  it("treats not_connected as inactive (covers expired connectionStatus)", () => {
    assert.equal(isAccountActive(acc("a", "not_connected") as never), false);
  });

  it("treats connectionStatus 'expired' as inactive defensively", () => {
    // In practice this rolls up to status='not_connected' via deriveStatus,
    // but the helper must still catch it directly if the upstream changes.
    assert.equal(
      isAccountActive({ status: "allowed", connectionStatus: "expired" } as never),
      false,
    );
  });
});

describe("partitionAccountsByActive", () => {
  it("splits accounts into active and expired groups, preserving order", () => {
    const input = [
      acc("a", "allowed"),
      acc("b", "unavailable"),
      acc("c", "warning"),
      acc("d", "not_connected"),
      acc("e", "setup_needed"),
    ];
    const { active, expired } = partitionAccountsByActive(input as never);
    assert.deepEqual(active.map((a) => a.id), ["a", "c", "e"]);
    assert.deepEqual(expired.map((a) => a.id), ["b", "d"]);
  });

  it("handles empty input", () => {
    const { active, expired } = partitionAccountsByActive([]);
    assert.deepEqual(active, []);
    assert.deepEqual(expired, []);
  });

  it("handles all-active input", () => {
    const { active, expired } = partitionAccountsByActive([
      acc("a", "allowed"),
      acc("b", "warning"),
    ] as never);
    assert.equal(active.length, 2);
    assert.equal(expired.length, 0);
  });

  it("handles all-expired input", () => {
    const { active, expired } = partitionAccountsByActive([
      acc("a", "unavailable"),
      acc("b", "not_connected"),
    ] as never);
    assert.equal(active.length, 0);
    assert.equal(expired.length, 2);
  });
});
