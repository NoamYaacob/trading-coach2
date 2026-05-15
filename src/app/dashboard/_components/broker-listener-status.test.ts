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
    listenerLastCloseCode: null,
    listenerLastCloseReason: null,
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
  it("isReconnecting=true when listenerStatus='reconnecting' and no prior heartbeat", () => {
    const result = computeListenerFreshness(makeData({ listenerStatus: "reconnecting" }));
    assert.equal(result.isReconnecting, true);
    assert.equal(result.isLive, false);
    assert.ok(result.label.includes("Reconnecting"));
  });

  it("isReconnecting=true when listenerStatus='connecting' and no prior heartbeat", () => {
    const result = computeListenerFreshness(makeData({ listenerStatus: "connecting" }));
    assert.equal(result.isReconnecting, true);
    assert.equal(result.isLive, false);
  });

  it("isLive=true when reconnecting with recent heartbeat (≤90s) — graceful 1000/Bye recycle", () => {
    // Tradovate recycles demo sessions every ~30s with code 1000 "Bye". The listener
    // reconnects in seconds. Dashboard must stay green throughout.
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "reconnecting",
        listenerLastHeartbeatAt: new Date(Date.now() - 20_000), // 20s ago
      }),
    );
    assert.equal(result.isLive, true, "should be Live during graceful recycle");
    assert.equal(result.isReconnecting, true);
    assert.equal(result.isStale, false);
    assert.ok(result.label.includes("Live ·"), `expected "Live ·" prefix, got: "${result.label}"`);
    assert.ok(result.label.includes("reconnecting"), result.label);
  });

  it("isLive=true when connecting with recent event (≤90s)", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "connecting",
        listenerLastEventAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, true);
    assert.equal(result.isReconnecting, true);
  });

  it("isLive=false when reconnecting with stale heartbeat (>90s)", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "reconnecting",
        listenerLastHeartbeatAt: new Date(Date.now() - 120_000), // 2m ago
      }),
    );
    assert.equal(result.isLive, false);
    assert.equal(result.isReconnecting, true);
    assert.ok(result.label.includes("Reconnecting"), result.label);
  });

  it("reconnecting label includes last-signal time when signal exists but is stale", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "reconnecting",
        listenerLastHeartbeatAt: new Date(Date.now() - 200_000), // >90s
      }),
    );
    assert.ok(result.label.includes("last signal"), result.label);
  });

  it("prefers listenerLastEventAt over listenerLastHeartbeatAt for recency check", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "reconnecting",
        listenerLastHeartbeatAt: new Date(Date.now() - 200_000), // stale
        listenerLastEventAt: new Date(Date.now() - 10_000),      // recent
      }),
    );
    assert.equal(result.isLive, true, "recent event should win over stale heartbeat");
  });
});

describe("computeListenerFreshness: fallback (no listener)", () => {
  it("falls back to lastSyncAt when listenerStatus is null (worker never ran)", () => {
    // Acceptance: if listener is down/never started, dashboard must show cron freshness.
    const result = computeListenerFreshness(
      makeData({ listenerStatus: null, lastSyncAt: new Date(Date.now() - 90_000) }),
    );
    assert.equal(result.isLive, false);
    assert.equal(result.isReconnecting, false);
    assert.ok(result.label.includes("Fallback sync"), result.label);
  });

  it("falls back to lastSyncAt when listenerStatus is 'closed'", () => {
    const result = computeListenerFreshness(
      makeData({ listenerStatus: "closed", lastSyncAt: new Date(Date.now() - 90_000) }),
    );
    assert.equal(result.isLive, false);
    assert.equal(result.isReconnecting, false);
    assert.ok(result.label.includes("Fallback sync"), result.label);
  });

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

// ── Core regression: connected + recent heartbeat ────────────────────────────────

describe("computeListenerFreshness: connected + recent heartbeat/event", () => {
  it("listenerStatus='connected' + recent heartbeat → Live · Xs ago (not Fallback sync)", () => {
    // Regression: DEMO7433035 showed "Fallback sync · 13s ago" even with an active
    // listener. Ensure "connected" + recent heartbeat always returns isLive=true.
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 13_000),
        listenerLastCloseCode: 1000,
        listenerLastCloseReason: "Bye",
        lastSyncAt: new Date(Date.now() - 13_000),
      }),
    );
    assert.equal(result.isLive, true, "must be Live, not Fallback sync");
    assert.equal(result.isStale, false);
    assert.ok(result.label.startsWith("Live ·"), `expected "Live ·" prefix, got: "${result.label}"`);
    assert.ok(!result.label.includes("Fallback"), `must not say Fallback, got: "${result.label}"`);
  });

  it("listenerStatus='connected' + recent event → Live · Xs ago", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "connected",
        listenerLastEventAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, true);
    assert.ok(result.label.includes("Live ·"), result.label);
  });
});

// ── Closed + graceful recycle ─────────────────────────────────────────────────────

describe("computeListenerFreshness: closed after graceful 1000/Bye with recent heartbeat", () => {
  it("closed + code=1000 + reason='Bye' + recent heartbeat → isLive=true, label includes reconnecting", () => {
    // The worker writes "closed" on SIGTERM between a 1000/Bye close and the next
    // reconnect. Dashboard must stay green if the heartbeat is still fresh.
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "closed",
        listenerLastCloseCode: 1000,
        listenerLastCloseReason: "Bye",
        listenerLastHeartbeatAt: new Date(Date.now() - 13_000),
        lastSyncAt: new Date(Date.now() - 13_000),
      }),
    );
    assert.equal(result.isLive, true, "should stay Live for graceful close with fresh heartbeat");
    assert.equal(result.isReconnecting, true);
    assert.equal(result.isStale, false);
    assert.ok(result.label.startsWith("Live ·"), `expected "Live ·" prefix, got: "${result.label}"`);
    assert.ok(!result.label.includes("Fallback"), `must not say Fallback, got: "${result.label}"`);
  });

  it("closed + code=1000 + reason='Bye' + stale heartbeat (>90s) → Fallback sync", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "closed",
        listenerLastCloseCode: 1000,
        listenerLastCloseReason: "Bye",
        listenerLastHeartbeatAt: new Date(Date.now() - 120_000),
        lastSyncAt: new Date(Date.now() - 120_000),
      }),
    );
    assert.equal(result.isLive, false);
    assert.ok(!result.label.includes("Live"), result.label);
  });

  it("closed + code=1006 (abnormal) + recent heartbeat → NOT Live (falls to cron sync)", () => {
    // Only 1000/Bye is a known-graceful close. Abnormal closes should not mask as Live.
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "closed",
        listenerLastCloseCode: 1006,
        listenerLastCloseReason: "",
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
        lastSyncAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, false);
  });

  it("closed + no close code + recent heartbeat → falls to Fallback sync, not Live", () => {
    const result = computeListenerFreshness(
      makeData({
        listenerStatus: "closed",
        listenerLastCloseCode: null,
        listenerLastCloseReason: null,
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
        lastSyncAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, false);
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

// ── Data mapping source audit ─────────────────────────────────────────────────────

const DATA_SRC = readFileSync(
  resolve(import.meta.dirname, "./command-center/data.ts"),
  "utf8",
);

describe("data.ts: active listener fallback for stale brokerConnectionId", () => {
  it("queries for active listeners by env (supplementary query present)", () => {
    assert.ok(
      DATA_SRC.includes("activeListenerConnections"),
      "must query activeListenerConnections to find fresh listener when account points to old connection",
    );
  });

  it("builds activeListenerByEnv map", () => {
    assert.ok(
      DATA_SRC.includes("activeListenerByEnv"),
      "must build env→connection map for fallback lookup",
    );
  });

  it("selects listenerLastCloseCode and listenerLastCloseReason from brokerConnection", () => {
    assert.ok(
      DATA_SRC.includes("listenerLastCloseCode"),
      "must select listenerLastCloseCode for graceful-recycle detection",
    );
    assert.ok(
      DATA_SRC.includes("listenerLastCloseReason"),
      "must select listenerLastCloseReason for graceful-recycle detection",
    );
  });

  it("prefers direct connection when it already has an active listener", () => {
    // The fallback only kicks in for closed/null listener status.
    assert.ok(
      DATA_SRC.includes("isDirectActive"),
      "must short-circuit fallback when direct connection is already active",
    );
  });
});

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
