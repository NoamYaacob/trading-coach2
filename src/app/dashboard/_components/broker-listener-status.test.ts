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
    connectionStatus: null,
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

  it("never borrows env fallback for expired or connection_error direct connections", () => {
    assert.ok(
      DATA_SRC.includes("directOAuthDead"),
      "must guard env fallback with a dead-OAuth check",
    );
    assert.ok(
      DATA_SRC.includes('"expired"') && DATA_SRC.includes('"connection_error"'),
      "must check for both expired and connection_error connectionStatus values",
    );
    // The guard must appear before the effective assignment
    const guardIdx = DATA_SRC.indexOf("directOAuthDead");
    const effectiveIdx = DATA_SRC.indexOf("activeListenerByEnv.get");
    assert.ok(guardIdx < effectiveIdx, "OAuth-dead guard must precede the env fallback lookup");
  });
});

const COMPONENT_SRC = readFileSync(
  resolve(import.meta.dirname, "./broker-listener-status.tsx"),
  "utf8",
);

describe("BrokerListenerStatus component copy: enforcement framing", () => {
  it("standard-equivalent mode says Guardrail monitors after sync (not pre-trade)", () => {
    assert.ok(
      COMPONENT_SRC.includes("Guardrail monitors position size after sync"),
      "standard-equiv label must describe post-sync monitoring",
    );
    assert.ok(
      !COMPONENT_SRC.includes("pre-trade reject"),
      "standard-equiv label must NOT say 'pre-trade reject'",
    );
  });

  it("raw broker mode label says 'Broker cap active'", () => {
    assert.ok(
      COMPONENT_SRC.includes("Broker cap active"),
      "raw mode label must say 'Broker cap active'",
    );
  });

  it("raw broker mode notes it applies to all contracts equally", () => {
    assert.ok(
      COMPONENT_SRC.includes("applies to all contracts"),
      "raw mode must note it applies to all contracts equally",
    );
  });

  it("does not expose 'detection-response' jargon to customers", () => {
    assert.ok(
      !COMPONENT_SRC.includes("detection-response"),
      "component must not expose 'detection-response' jargon to customers",
    );
  });
});

// ── Expired / connection_error OAuth guard ────────────────────────────────────

describe("computeListenerFreshness: expired connection", () => {
  it("connectionStatus=expired → label is 'Expired — re-authorize'", () => {
    const result = computeListenerFreshness(
      makeData({ connectionStatus: "expired" }),
    );
    assert.equal(result.label, "Expired — re-authorize");
    assert.equal(result.isLive, false);
    assert.equal(result.isStale, true);
    assert.equal(result.isReconnecting, false);
  });

  it("expired + borrowed listenerStatus=connected → still shows Expired, not Live", () => {
    // Regression guard: even if the env fallback was accidentally applied, an
    // expired connectionStatus must win and prevent a Live label.
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: "expired",
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.label, "Expired — re-authorize", "must not show Live for expired connection");
    assert.equal(result.isLive, false);
  });

  it("expired + recent heartbeat → still shows Expired, not Live", () => {
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: "expired",
        listenerLastHeartbeatAt: new Date(Date.now() - 3_000),
        lastSyncAt: new Date(Date.now() - 3_000),
      }),
    );
    assert.equal(result.isLive, false);
    assert.ok(result.label.includes("Expired"), `expected Expired label, got: "${result.label}"`);
  });

  it("expired + 1000/Bye close → still shows Expired, not Live · reconnecting", () => {
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: "expired",
        listenerStatus: "closed",
        listenerLastCloseCode: 1000,
        listenerLastCloseReason: "Bye",
        listenerLastHeartbeatAt: new Date(Date.now() - 10_000),
      }),
    );
    assert.equal(result.isLive, false);
    assert.ok(!result.label.includes("Live"), `must not show Live, got: "${result.label}"`);
  });
});

describe("computeListenerFreshness: connection_error", () => {
  it("connectionStatus=connection_error → label is 'Connection error — re-authorize'", () => {
    const result = computeListenerFreshness(
      makeData({ connectionStatus: "connection_error" }),
    );
    assert.equal(result.label, "Connection error — re-authorize");
    assert.equal(result.isLive, false);
    assert.equal(result.isStale, true);
    assert.equal(result.isReconnecting, false);
  });

  it("connection_error + listenerStatus=connected → still shows error label, not Live", () => {
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: "connection_error",
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, false);
    assert.ok(result.label.includes("Connection error"), result.label);
  });
});

describe("computeListenerFreshness: healthy connection not affected", () => {
  it("null connectionStatus + connected listener → Live (existing behaviour unchanged)", () => {
    // DEMO7433035 has a healthy direct FK — connectionStatus=null here means
    // we pass null and the existing live-listener path runs normally.
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: null,
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, true);
    assert.ok(result.label.startsWith("Live ·"), result.label);
  });

  it("connected_readonly connectionStatus + connected listener → Live", () => {
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: "connected_readonly",
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 5_000),
      }),
    );
    assert.equal(result.isLive, true);
  });

  it("stale FK (null listenerStatus, non-expired) → env fallback path is not blocked", () => {
    // Accounts with a stale FK but a healthy connectionStatus on the direct
    // connection should still reach the env-fallback path in data.ts.
    // This test covers the logic-gate in computeListenerFreshness (the function
    // itself receives the effective data; it does not re-run the fallback).
    // A null connectionStatus with a connected effective listener → Live.
    const result = computeListenerFreshness(
      makeData({
        connectionStatus: null,
        listenerStatus: "connected",
        listenerLastHeartbeatAt: new Date(Date.now() - 8_000),
      }),
    );
    assert.equal(result.isLive, true, "stale-FK fallback path must still produce Live");
  });
});

// ── Source-scan: logic-layer expired guard ────────────────────────────────────

const LOGIC_SRC = readFileSync(
  resolve(import.meta.dirname, "./broker-listener-status-logic.ts"),
  "utf8",
);

describe("broker-listener-status-logic.ts: expired/connection_error guard", () => {
  it("checks connectionStatus before any listenerStatus branch", () => {
    const connIdx = LOGIC_SRC.indexOf('connectionStatus === "expired"');
    const liveIdx = LOGIC_SRC.indexOf('listenerStatus === "connected"');
    assert.ok(connIdx !== -1 && liveIdx !== -1);
    assert.ok(connIdx < liveIdx, "expired guard must appear before live-listener branch");
  });

  it("returns isLive=false for expired", () => {
    assert.ok(
      LOGIC_SRC.includes("isLive: false") && LOGIC_SRC.includes('"Expired — re-authorize"'),
      "expired path must return isLive=false with re-authorize label",
    );
  });

  it("returns isStale=true for expired (amber colour, no green dot)", () => {
    const expiredIdx = LOGIC_SRC.indexOf('"Expired — re-authorize"');
    const staleSegment = LOGIC_SRC.slice(expiredIdx, expiredIdx + 100);
    assert.ok(staleSegment.includes("isStale: true"), "expired must set isStale=true for amber colour");
  });

  it("returns isLive=false for connection_error", () => {
    assert.ok(
      LOGIC_SRC.includes('"Connection error — re-authorize"'),
      "connection_error path must return re-authorize label",
    );
  });
});
