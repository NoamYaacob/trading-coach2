/**
 * Tests for BrokerListenerStatus freshness computation.
 *
 * Pure function — no rendering, no DOM.
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeListenerFreshness,
  type BrokerListenerStatusData,
} from "./broker-listener-status-logic.ts";

function makeData(overrides: Partial<BrokerListenerStatusData> = {}): BrokerListenerStatusData {
  return {
    listenerStatus: null,
    listenerLastEventAt: null,
    listenerLastHeartbeatAt: null,
    lastSyncAt: null,
    hasMaxPositionSize: false,
    rawBrokerHardLimitEnabled: false,
    ...overrides,
  };
}

describe("computeListenerFreshness: live listener", () => {
  it("isLive=true when listenerStatus='connected'", () => {
    const result = computeListenerFreshness(
      makeData({ listenerStatus: "connected", listenerLastEventAt: new Date(Date.now() - 5_000) }),
    );
    assert.equal(result.isLive, true);
    assert.equal(result.isStale, false);
    assert.ok(result.label.startsWith("Live ·"), `expected "Live ·" prefix, got: "${result.label}"`);
  });

  it("label includes seconds-ago when recent event", () => {
    const result = computeListenerFreshness(
      makeData({ listenerStatus: "connected", listenerLastEventAt: new Date(Date.now() - 10_000) }),
    );
    assert.ok(result.label.includes("10s ago") || result.label.includes("ago"), result.label);
  });

  it("label says 'waiting for first event' when no events yet but connected", () => {
    const result = computeListenerFreshness(
      makeData({ listenerStatus: "connected" }), // no events or heartbeats
    );
    assert.ok(result.label.includes("waiting"), `expected "waiting" in label, got: "${result.label}"`);
  });

  it("uses heartbeat as fallback when no event but heartbeat exists", () => {
    const result = computeListenerFreshness(
      makeData({ listenerStatus: "connected", listenerLastHeartbeatAt: new Date(Date.now() - 3_000) }),
    );
    assert.ok(result.label.startsWith("Live ·"));
    assert.ok(result.label.includes("ago"), result.label);
  });
});

describe("computeListenerFreshness: reconnecting", () => {
  it("isReconnecting=true when listenerStatus='reconnecting'", () => {
    const result = computeListenerFreshness(makeData({ listenerStatus: "reconnecting" }));
    assert.equal(result.isReconnecting, true);
    assert.equal(result.isLive, false);
    assert.ok(result.label.includes("Reconnecting"));
  });

  it("isReconnecting=true when listenerStatus='connecting'", () => {
    const result = computeListenerFreshness(makeData({ listenerStatus: "connecting" }));
    assert.equal(result.isReconnecting, true);
  });
});

describe("computeListenerFreshness: fallback (no listener)", () => {
  it("isStale=false when lastSyncAt is recent", () => {
    const result = computeListenerFreshness(
      makeData({ lastSyncAt: new Date(Date.now() - 2 * 60_000) }), // 2m ago
    );
    assert.equal(result.isStale, false);
    assert.ok(result.label.includes("Fallback sync"), result.label);
  });

  it("isStale=true when lastSyncAt is overdue (>5 min)", () => {
    const result = computeListenerFreshness(
      makeData({ lastSyncAt: new Date(Date.now() - 6 * 60_000) }), // 6m ago
    );
    assert.equal(result.isStale, true);
    assert.ok(result.label.includes("Stale"), result.label);
  });

  it("returns 'No sync yet' when no sync or listener", () => {
    const result = computeListenerFreshness(makeData());
    assert.ok(result.label.includes("No sync yet"), result.label);
    assert.equal(result.isStale, true);
  });
});

// ── Enforcement framing tests ─────────────────────────────────────────────────────

describe("computeListenerFreshness: no enforcement framing in pure function", () => {
  it("freshness computation is not affected by rawBrokerHardLimitEnabled", () => {
    const liveData = makeData({ listenerStatus: "connected", rawBrokerHardLimitEnabled: true });
    const nonRaw = computeListenerFreshness(makeData({ listenerStatus: "connected" }));
    const raw = computeListenerFreshness(liveData);
    // Freshness label itself is the same — enforcement mode only affects component rendering
    assert.equal(raw.isLive, nonRaw.isLive);
  });
});

// ── Source-scan: enforcement copy must not promise pre-trade reject ─────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const COMPONENT_SRC = readFileSync(
  resolve(import.meta.dirname, "./broker-listener-status.tsx"),
  "utf8",
);

describe("BrokerListenerStatus component copy: enforcement framing", () => {
  it("does not promise pre-trade reject for standard-equivalent mode", () => {
    const standardEquivIdx = COMPONENT_SRC.indexOf("Standard-equiv");
    assert.ok(standardEquivIdx !== -1, "must have standard-equivalent enforcement mode label");
    const label = COMPONENT_SRC.slice(standardEquivIdx, standardEquivIdx + 100);
    assert.ok(
      !label.includes("pre-trade reject"),
      "standard-equiv label must NOT say 'pre-trade reject'",
    );
    assert.ok(
      label.includes("not pre-trade") || label.includes("detection-response"),
      "must clarify it is NOT a pre-trade reject",
    );
  });

  it("raw broker mode label says 'Raw broker reject' to be accurate", () => {
    assert.ok(
      COMPONENT_SRC.includes("Raw broker reject"),
      "raw mode label must accurately say 'Raw broker reject'",
    );
  });

  it("raw broker mode warns about counting all contracts equally", () => {
    assert.ok(
      COMPONENT_SRC.includes("counts all contracts equally"),
      "raw mode must warn about equal counting",
    );
  });
});
