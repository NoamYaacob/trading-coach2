/**
 * Tests for TradovateListenerManager.
 *
 * Verifies deduplication, lifecycle, status queries, and log safety.
 * Uses the same MockWebSocket used in the listener tests.
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TradovateListenerManager,
  listenerFreshnessLabel,
  isListenerStale,
  LISTENER_STALE_THRESHOLD_MS,
  type ListenerStatus,
} from "./tradovate-listener-manager.ts";
import type { WebSocketLike, WebSocketFactory } from "./tradovate-user-sync-listener.ts";

// ── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWebSocket implements WebSocketLike {
  readonly readyState = 1;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send(data: string) { this.sent.push(data); }
  close() { this.onclose?.({ code: 1000, reason: "normal" }); }
}

function makeFactory(): { factory: WebSocketFactory; lastWs: () => MockWebSocket | null } {
  let ws: MockWebSocket | null = null;
  const factory: WebSocketFactory = (_url) => {
    ws = new MockWebSocket();
    return ws;
  };
  return { factory, lastWs: () => ws };
}

function makeConfig(connectionId: string, overrides = {}) {
  return {
    connectionId,
    tradovateUserId: 42,
    env: "demo" as const,
    permissionLevel: "full_access" as const,
    getAccessToken: async () => "test_token",
    ...overrides,
  };
}

// ── Deduplication ────────────────────────────────────────────────────────────

describe("TradovateListenerManager: deduplication", () => {
  it("returns true when a new listener is started", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    const result = await manager.startListener(makeConfig("conn-1"));
    assert.equal(result, true, "first start must return true");
    manager.closeAll();
  });

  it("returns false when listener already exists for the same connectionId", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-1"));
    const result = await manager.startListener(makeConfig("conn-1"));
    assert.equal(result, false, "second start for same connection must return false (dedup)");
    assert.equal(manager.listenerCount, 1, "only one listener must be tracked");
    manager.closeAll();
  });

  it("allows different connectionIds to each have their own listener", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-A"));
    await manager.startListener(makeConfig("conn-B"));
    assert.equal(manager.listenerCount, 2);
    manager.closeAll();
  });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe("TradovateListenerManager: lifecycle", () => {
  it("hasListener returns true after start, false after stop", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-1"));
    assert.ok(manager.hasListener("conn-1"));
    manager.stopListener("conn-1");
    assert.ok(!manager.hasListener("conn-1"));
  });

  it("stopListener is a no-op for unknown connectionId", () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    assert.doesNotThrow(() => manager.stopListener("unknown"));
  });

  it("closeAll removes all listeners", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-A"));
    await manager.startListener(makeConfig("conn-B"));
    manager.closeAll();
    assert.equal(manager.listenerCount, 0);
  });

  it("can restart a listener after stop", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-1"));
    manager.stopListener("conn-1");
    const result = await manager.startListener(makeConfig("conn-1"));
    assert.equal(result, true, "must allow restart after stop");
    manager.closeAll();
  });
});

// ── Status ───────────────────────────────────────────────────────────────────

describe("TradovateListenerManager: status", () => {
  it("listenerStatus returns null for unknown connectionId", () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    assert.equal(manager.listenerStatus("unknown"), null);
  });

  it("listenerStatus returns status with connectionId", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-1"));
    const status = manager.listenerStatus("conn-1");
    assert.ok(status !== null);
    assert.equal(status!.connectionId, "conn-1");
    assert.equal(typeof status!.state, "string");
    manager.closeAll();
  });

  it("allListenerStatuses returns one entry per managed listener", async () => {
    const { factory } = makeFactory();
    const manager = new TradovateListenerManager(factory);
    await manager.startListener(makeConfig("conn-A"));
    await manager.startListener(makeConfig("conn-B"));
    const statuses = manager.allListenerStatuses();
    assert.equal(statuses.length, 2);
    const ids = statuses.map((s) => s.connectionId).sort();
    assert.deepEqual(ids, ["conn-A", "conn-B"]);
    manager.closeAll();
  });
});

// ── Event routing ────────────────────────────────────────────────────────────

describe("TradovateListenerManager: event routing", () => {
  it("onPositionEvent callback receives connectionId prefix", async () => {
    const { factory, lastWs } = makeFactory();
    const received: string[] = [];
    const manager = new TradovateListenerManager(factory);

    await manager.startListener(makeConfig("conn-1", {
      onPositionEvent: (connectionId: string) => received.push(connectionId),
    }));

    // Trigger a position props event via the mock WS
    const ws = lastWs()!;
    ws.onopen?.(null);
    ws.onmessage?.({ data: "o" }); // SockJS open → triggers authorize
    const authResp = `a[${JSON.stringify(JSON.stringify({ i: 1, s: 200, p: {} }))}]`;
    ws.onmessage?.({ data: authResp });
    const syncResp = `a[${JSON.stringify(JSON.stringify({ i: 2, s: 200, p: {} }))}]`;
    ws.onmessage?.({ data: syncResp });
    const posEvent = JSON.stringify({
      e: "props",
      d: { entityType: "Position", entity: { id: 1, accountId: 2, contractId: 3, netPos: 1 }, eventType: "Updated" },
    });
    const posFrame = `a[${JSON.stringify(posEvent)}]`;
    ws.onmessage?.({ data: posFrame });

    assert.equal(received.length, 1);
    assert.equal(received[0], "conn-1");
    manager.closeAll();
  });

  it("onStateChange callback receives connectionId + new state", async () => {
    const { factory, lastWs } = makeFactory();
    const transitions: Array<{ id: string; state: string }> = [];
    const manager = new TradovateListenerManager(factory);

    await manager.startListener(
      makeConfig("conn-1", {
        onStateChange: (connectionId: string, state: string) =>
          transitions.push({ id: connectionId, state }),
      }),
    );

    const ws = lastWs()!;
    ws.onopen?.(null);
    ws.onmessage?.({ data: "o" }); // SockJS open → triggers authorize
    // Drive through to authorizing → syncing → ready
    const authResp = `a[${JSON.stringify(JSON.stringify({ i: 1, s: 200, p: {} }))}]`;
    ws.onmessage?.({ data: authResp });
    const syncResp = `a[${JSON.stringify(JSON.stringify({ i: 2, s: 200, p: {} }))}]`;
    ws.onmessage?.({ data: syncResp });

    assert.ok(transitions.length > 0, "expected at least one state transition");
    for (const t of transitions) {
      assert.equal(t.id, "conn-1");
    }
    const states = transitions.map((t) => t.state);
    assert.ok(states.includes("ready"), `expected 'ready' in transitions: ${states.join(",")}`);
    manager.closeAll();
  });
});

// ── listenerFreshnessLabel ───────────────────────────────────────────────────

describe("listenerFreshnessLabel", () => {
  it("returns 'No listener' for null status", () => {
    assert.equal(listenerFreshnessLabel(null), "No listener");
  });

  it("returns 'Live · Xs ago' when ready and recent event", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "ready",
      lastHeartbeatAt: null,
      lastEventAt: new Date(Date.now() - 5_000),
    };
    assert.ok(listenerFreshnessLabel(status).startsWith("Live ·"), listenerFreshnessLabel(status));
    assert.ok(listenerFreshnessLabel(status).includes("5s") || listenerFreshnessLabel(status).includes("s ago"));
  });

  it("returns 'Reconnecting…' when reconnecting", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "reconnecting",
      lastHeartbeatAt: null,
      lastEventAt: null,
    };
    assert.equal(listenerFreshnessLabel(status), "Reconnecting…");
  });

  it("returns 'Listener closed' when closed", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "closed",
      lastHeartbeatAt: null,
      lastEventAt: null,
    };
    assert.equal(listenerFreshnessLabel(status), "Listener closed");
  });
});

// ── isListenerStale ──────────────────────────────────────────────────────────

describe("isListenerStale", () => {
  it("returns true for null status", () => {
    assert.equal(isListenerStale(null), true);
  });

  it("returns true when state is not ready", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "reconnecting",
      lastHeartbeatAt: new Date(),
      lastEventAt: new Date(),
    };
    assert.equal(isListenerStale(status), true);
  });

  it("returns false when ready with recent heartbeat", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "ready",
      lastHeartbeatAt: new Date(Date.now() - 5_000),
      lastEventAt: null,
    };
    assert.equal(isListenerStale(status), false);
  });

  it("returns true when ready but heartbeat is overdue", () => {
    const status: ListenerStatus = {
      connectionId: "x",
      state: "ready",
      lastHeartbeatAt: new Date(Date.now() - LISTENER_STALE_THRESHOLD_MS - 1_000),
      lastEventAt: null,
    };
    assert.equal(isListenerStale(status), true);
  });
});

// ── Source-scan: log safety ──────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MANAGER_SRC = readFileSync(
  resolve(import.meta.dirname, "./tradovate-listener-manager.ts"),
  "utf8",
);

describe("TradovateListenerManager source: log safety", () => {
  it("manager source does not log token fields", () => {
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted", "getAccessToken"];
    const logCalls = MANAGER_SRC.match(/console\.(log|warn|info|error)\([\s\S]*?\)/g) ?? [];
    for (const logCall of logCalls) {
      for (const field of forbidden) {
        assert.ok(
          !logCall.includes(field),
          `log call must not include "${field}": ${logCall.slice(0, 80)}`,
        );
      }
    }
  });

  it("manager has dedup guard (has check before start)", () => {
    assert.ok(
      MANAGER_SRC.includes("#listeners.has(") || MANAGER_SRC.includes("this.#listeners.has("),
      "manager must check for existing listener before starting",
    );
  });

  it("manager has closeAll for clean shutdown", () => {
    assert.ok(MANAGER_SRC.includes("closeAll"), "manager must have closeAll for process exit");
  });
});
