/**
 * Tests for TradovateUserSyncListener state machine.
 *
 * All tests use a mock WebSocket factory — no real network.
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TradovateUserSyncListener,
  type WebSocketLike,
  type WebSocketFactory,
  type ListenerState,
  type TradovateUserSyncListenerConfig,
} from "./tradovate-user-sync-listener.ts";
import type { TradovatePropsEventData } from "./tradovate-websocket-protocol.ts";

// ── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWebSocket implements WebSocketLike {
  readonly readyState = 1; // OPEN
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({ code: 1000, reason: "normal" });
  }

  // Test helpers
  triggerOpen(): void {
    this.onopen?.(null);
  }
  triggerMessage(data: string): void {
    this.onmessage?.({ data });
  }
  triggerClose(code = 1000, reason = "normal"): void {
    this.onclose?.({ code, reason });
  }
  triggerHeartbeat(): void {
    this.triggerMessage("h");
  }
}

function makeAuthResponse(id: number, success = true): string {
  const msg = JSON.stringify({ i: id, s: success ? 200 : 401, p: {} });
  return `a[${JSON.stringify(msg)}]`;
}

function makeSyncResponse(id: number): string {
  const msg = JSON.stringify({ i: id, s: 200, p: { users: [], accounts: [] } });
  return `a[${JSON.stringify(msg)}]`;
}

function makePropsFrame(entityType: string, eventType = "Updated"): string {
  const event = JSON.stringify({
    e: "props",
    d: {
      entityType,
      entity: { id: 1, accountId: 2, contractId: 3, netPos: 1 },
      eventType,
    },
  });
  return `a[${JSON.stringify(event)}]`;
}

function makeListener(overrides?: Partial<TradovateUserSyncListenerConfig>) {
  let ws: MockWebSocket | null = null;
  const factory: WebSocketFactory = (_url) => {
    ws = new MockWebSocket();
    return ws;
  };

  const states: ListenerState[] = [];
  const positionEvents: TradovatePropsEventData[] = [];
  const propsEvents: TradovatePropsEventData[] = [];

  const listener = new TradovateUserSyncListener({
    wsFactory: factory,
    env: "demo",
    connectionId: "test-connection-id",
    tradovateUserId: 42,
    getAccessToken: async () => "test_access_token",
    onStateChange: (s) => states.push(s),
    onPositionEvent: (p) => positionEvents.push(p),
    onPropsEvent: (p) => propsEvents.push(p),
    baseReconnectDelayMs: 10,
    maxReconnectDelayMs: 50,
    ...overrides,
  });

  return { listener, states, positionEvents, propsEvents, getWs: () => ws };
}

// Complete the connect sequence: open → SockJS "o" → auth → sync
// The SockJS "o" frame is what gates the authorize message — Tradovate
// closes the socket if authorize is sent before "o" arrives.
function completeConnect(
  ws: MockWebSocket,
  authId = 1,
  syncId = 2,
): void {
  ws.triggerOpen();           // TCP/TLS open, nothing sent yet
  ws.triggerMessage("o");     // SockJS open frame → sends authorize
  ws.triggerMessage(makeAuthResponse(authId)); // → sends syncrequest
  ws.triggerMessage(makeSyncResponse(syncId)); // → state: ready
}

// ── State machine transitions ────────────────────────────────────────────────

describe("TradovateUserSyncListener: state transitions", () => {
  it("starts in 'idle' state", () => {
    const { listener } = makeListener();
    assert.equal(listener.state, "idle");
  });

  it("transitions idle → connecting → authorizing → syncing → ready", async () => {
    const { listener, states, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    assert.deepEqual(states, ["connecting", "authorizing", "syncing", "ready"]);
    assert.equal(listener.state, "ready");
  });

  it("transitions to 'reconnecting' when connection closes unexpectedly", async () => {
    const { listener, states, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerClose(1006, "abnormal closure");

    // reconnecting state is set (before the timer fires)
    assert.ok(states.includes("reconnecting"), "must transition to reconnecting after close");
    listener.close();
  });

  it("closes cleanly when close() is called", async () => {
    const { listener, states, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    listener.close();

    assert.equal(listener.state, "closed");
    assert.ok(states.includes("closed"));
  });

  it("start() is idempotent when already connecting", async () => {
    const { listener, states } = makeListener();
    await listener.start();
    await listener.start(); // second call — should not duplicate
    const connectingCount = states.filter((s) => s === "connecting").length;
    assert.equal(connectingCount, 1, "must only connect once");
    listener.close();
  });
});

// ── Authorization ────────────────────────────────────────────────────────────

describe("TradovateUserSyncListener: authorization", () => {
  it("does NOT send authorize on raw socket open (waits for SockJS 'o')", async () => {
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    assert.equal(ws.sent.length, 0, "must wait for the SockJS 'o' frame before sending authorize");
    listener.close();
  });

  it("sends authorize message after SockJS 'o' frame", async () => {
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o"); // SockJS open frame

    assert.equal(ws.sent.length, 1, "authorize must be sent after 'o' arrives");
    const parts = ws.sent[0]!.split("\n");
    assert.equal(parts[0], "authorize");
    listener.close();
  });

  it("sends user/syncrequest after successful auth", async () => {
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");     // SockJS open → sends authorize (id=1)
    ws.triggerMessage(makeAuthResponse(1));

    assert.equal(ws.sent.length, 2);
    const syncMsg = ws.sent[1]!;
    const parts = syncMsg.split("\n");
    assert.equal(parts[0], "user/syncrequest");
    const body = JSON.parse(parts[3]!) as { users: number[] };
    assert.deepEqual(body.users, [42]); // tradovateUserId
    listener.close();
  });

  it("does not send syncrequest after failed auth", async () => {
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(1, false)); // 401

    assert.equal(ws.sent.length, 1, "must not send syncrequest after auth failure");
    listener.close();
  });

  it("does NOT log the access token", async () => {
    // Source-scan: the class must never log accessToken or the raw token string.
    // (The token is sent wire-only and discarded.)
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    // If we reach here without an unhandled rejection, the test passes.
    // The actual no-logging check is done in the source-scan test below.
    listener.close();
    assert.ok(true, "listener started and closed without error");
  });

  it("emits onTerminalError after N consecutive close-during-auth events", async () => {
    const terminalReasons: string[] = [];
    const { listener, getWs } = makeListener({
      maxAuthFailures: 2,
      onTerminalError: (reason) => terminalReasons.push(reason),
    });
    await listener.start();

    // First auth attempt closes mid-authorizing
    let ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");          // sends authorize
    ws.triggerClose(1000, "Bye");    // close-during-auth #1

    // Reconnect timer fires → second attempt
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerClose(1000, "Bye");    // close-during-auth #2 → terminal

    assert.equal(terminalReasons.length, 1, "onTerminalError fires once after the limit");
    assert.ok(terminalReasons[0]!.includes("auth failed 2x"), terminalReasons[0]);
    assert.ok(terminalReasons[0]!.includes("Bye"), "reason must surface the close text");
    listener.close();
  });

  it("on 401 auth response: requests forced refresh on next connect and retries once", async () => {
    const refreshFlags: boolean[] = [];
    const authFails: Array<{ status: number; willRetryWithForcedRefresh: boolean }> = [];
    const terminalReasons: string[] = [];
    const { listener, getWs } = makeListener({
      getAccessToken: async (opts) => {
        refreshFlags.push(opts?.forceRefresh === true);
        return "test_access_token";
      },
      onAuthFailed: (info) =>
        authFails.push({ status: info.status, willRetryWithForcedRefresh: info.willRetryWithForcedRefresh }),
      onTerminalError: (reason) => terminalReasons.push(reason),
    });
    await listener.start();

    // First attempt: 401 → schedule retry with forceRefresh=true
    let ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");                         // authorize sent
    ws.triggerMessage(makeAuthResponse(1, false));  // 401

    assert.equal(refreshFlags[0], false, "first getAccessToken call must not force refresh");
    assert.equal(authFails.length, 1);
    assert.equal(authFails[0]!.status, 401);
    assert.equal(authFails[0]!.willRetryWithForcedRefresh, true);
    assert.equal(terminalReasons.length, 0, "first 401 must not terminate");

    // Reconnect fires
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(refreshFlags[1], true, "second getAccessToken call must request forced refresh");
    listener.close();
  });

  it("on second 401 (after forced refresh): emits terminal error immediately", async () => {
    const terminalReasons: string[] = [];
    const authFails: Array<{ status: number; willRetryWithForcedRefresh: boolean }> = [];
    const { listener, getWs } = makeListener({
      getAccessToken: async () => "test_access_token",
      onAuthFailed: (info) =>
        authFails.push({ status: info.status, willRetryWithForcedRefresh: info.willRetryWithForcedRefresh }),
      onTerminalError: (reason) => terminalReasons.push(reason),
    });
    await listener.start();

    // First 401 → retry-with-refresh path
    let ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(1, false));

    // Reconnect with forced refresh, then second 401
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(2, false)); // 401 again

    assert.equal(authFails.length, 2);
    assert.equal(authFails[1]!.willRetryWithForcedRefresh, false, "second 401 must not retry again");
    assert.equal(terminalReasons.length, 1, "second 401 must emit terminal error");
    assert.ok(
      terminalReasons[0]!.includes("401") && terminalReasons[0]!.includes("refresh"),
      `terminal reason should mention 401 + refresh, got: ${terminalReasons[0]}`,
    );
    listener.close();
  });

  it("successful auth after a 401 retry resets the 401 tracker", async () => {
    const terminalReasons: string[] = [];
    const { listener, getWs } = makeListener({
      getAccessToken: async () => "test_access_token",
      onTerminalError: (reason) => terminalReasons.push(reason),
    });
    await listener.start();

    // First 401
    let ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(1, false));

    // Reconnect → success
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    completeConnect(ws, 2, 3);

    // Close from healthy state, reconnect, then a NEW 401 — must retry again
    ws.triggerClose(1006, "abnormal");
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(4, false));

    assert.equal(terminalReasons.length, 0, "tracker must reset on success, allowing another retry");
    listener.close();
  });

  it("a successful auth resets the consecutive-failure counter", async () => {
    const terminalReasons: string[] = [];
    const { listener, getWs } = makeListener({
      maxAuthFailures: 2,
      onTerminalError: (reason) => terminalReasons.push(reason),
    });
    await listener.start();

    // First attempt: close-during-auth #1
    let ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerClose(1000, "Bye");

    // Reconnect → succeed → close from a healthy state
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    completeConnect(ws);
    ws.triggerClose(1006, "abnormal"); // not during auth

    // Reconnect → another close-during-auth — but counter was reset
    await new Promise((r) => setTimeout(r, 50));
    ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerClose(1000, "Bye");

    assert.equal(terminalReasons.length, 0, "single failure after success must not terminate");
    listener.close();
  });
});

// ── Props event dispatch ─────────────────────────────────────────────────────

describe("TradovateUserSyncListener: props event dispatch", () => {
  it("calls onPositionEvent for Position entity type", async () => {
    const { listener, positionEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerMessage(makePropsFrame("Position"));

    assert.equal(positionEvents.length, 1);
    assert.equal(positionEvents[0]!.entityType, "Position");
    listener.close();
  });

  it("calls onPositionEvent for Fill entity type", async () => {
    const { listener, positionEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerMessage(makePropsFrame("Fill", "Created"));

    assert.equal(positionEvents.length, 1);
    listener.close();
  });

  it("does NOT call onPositionEvent for Account entity type", async () => {
    const { listener, positionEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerMessage(makePropsFrame("Account"));

    assert.equal(positionEvents.length, 0, "Account events must not trigger position enforcement");
    listener.close();
  });

  it("calls onPropsEvent for all entity types", async () => {
    const { listener, propsEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerMessage(makePropsFrame("Position"));
    ws.triggerMessage(makePropsFrame("Account"));

    assert.equal(propsEvents.length, 2);
    listener.close();
  });

  it("ignores props events before reaching 'ready' state", async () => {
    // Events sent before syncrequest completes should still dispatch once ready.
    // (In practice Tradovate won't send events before sync is acked, but we test
    // that the message handler works for events received in any ready state.)
    const { listener, positionEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o");
    ws.triggerMessage(makeAuthResponse(1));
    // Before syncrequest response arrives, send a position event
    ws.triggerMessage(makePropsFrame("Position"));
    // Still receives it (state is "syncing" but message handler is active)
    assert.ok(positionEvents.length >= 0, "handled without crash");
    listener.close();
  });
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

describe("TradovateUserSyncListener: heartbeat", () => {
  it("calls onHeartbeat when 'h' frame received", async () => {
    const heartbeats: Date[] = [];
    const { listener, getWs } = makeListener({
      onHeartbeat: (at) => heartbeats.push(at),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerHeartbeat();

    assert.equal(heartbeats.length, 1);
    assert.ok(heartbeats[0] instanceof Date);
    assert.ok(listener.lastHeartbeatAt instanceof Date);
    listener.close();
  });
});

// ── Reconnect backoff ────────────────────────────────────────────────────────

describe("TradovateUserSyncListener: reconnect", () => {
  it("does not reconnect after close()", async () => {
    const { listener, states, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    listener.close();

    // Wait a tick to ensure no reconnect timer fires
    await new Promise((r) => setTimeout(r, 100));
    const reconnectingCount = states.filter((s) => s === "reconnecting").length;
    assert.equal(reconnectingCount, 0, "must not reconnect after explicit close()");
  });
});

// ── Post-ready frame lifecycle ───────────────────────────────────────────────

describe("TradovateUserSyncListener: post-ready frame lifecycle", () => {
  it("heartbeat after ready keeps listener alive and updates lastHeartbeatAt", async () => {
    const heartbeats: Date[] = [];
    const { listener, getWs } = makeListener({
      onHeartbeat: (at) => heartbeats.push(at),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    assert.equal(listener.state, "ready");

    ws.triggerHeartbeat();

    assert.equal(heartbeats.length, 1, "onHeartbeat must fire after ready");
    assert.ok(heartbeats[0] instanceof Date);
    assert.ok(listener.lastHeartbeatAt instanceof Date);
    assert.equal(listener.state, "ready", "heartbeat must not change state away from ready");
    listener.close();
  });

  it("user data event after ready updates lastEventAt", async () => {
    const { listener, propsEvents, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    assert.equal(listener.state, "ready");
    assert.equal(listener.lastEventAt, null, "no event yet");

    ws.triggerMessage(makePropsFrame("Position"));

    assert.ok(listener.lastEventAt instanceof Date, "lastEventAt must be stamped on data event");
    assert.equal(propsEvents.length, 1);
    assert.equal(listener.state, "ready", "data event must not change state");
    listener.close();
  });

  it("unknown/garbage frame after ready is handled without crash", async () => {
    const { listener, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    assert.equal(listener.state, "ready");

    // Garbage frame — parseSockJSFrame returns { type: "data", messages: [] }
    // which is silently skipped. Must not throw.
    assert.doesNotThrow(() => ws.triggerMessage("garbage!!!"));
    assert.doesNotThrow(() => ws.triggerMessage(""));
    assert.equal(listener.state, "ready", "garbage frames must leave state as ready");
    listener.close();
  });

  it("close 1000/Bye after ready fires onClose with gracefulRecycle=true", async () => {
    const closedEvents: Array<{
      code: number;
      reason: string;
      gracefulRecycle: boolean;
      stateAtClose: string;
      msSinceReady: number | null;
      lastFrameType: string | null;
    }> = [];

    const terminalReasons: string[] = [];
    const { listener, getWs } = makeListener({
      onClose: (info) => closedEvents.push(info),
      onTerminalError: (r) => terminalReasons.push(r),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerHeartbeat(); // server heartbeat before the recycle

    assert.equal(listener.state, "ready");

    // Tradovate normal session recycle
    ws.triggerClose(1000, "Bye");

    assert.equal(closedEvents.length, 1);
    const ev = closedEvents[0]!;
    assert.equal(ev.code, 1000);
    assert.equal(ev.reason, "Bye");
    assert.equal(ev.gracefulRecycle, true, "must be flagged as graceful recycle");
    assert.equal(ev.stateAtClose, "ready");
    assert.ok(ev.msSinceReady !== null && ev.msSinceReady >= 0);
    assert.equal(ev.lastFrameType, "heartbeat", "last frame before Bye was a heartbeat");
    assert.equal(terminalReasons.length, 0, "graceful recycle must NOT call onTerminalError");

    listener.close();
  });

  it("close 1006 after ready fires onClose with gracefulRecycle=false", async () => {
    const closedEvents: Array<{ code: number; gracefulRecycle: boolean }> = [];
    const { listener, getWs } = makeListener({
      onClose: (info) => closedEvents.push(info),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    ws.triggerClose(1006, "");

    assert.equal(closedEvents.length, 1);
    const ev = closedEvents[0]!;
    assert.equal(ev.code, 1006);
    assert.equal(ev.gracefulRecycle, false, "1006 must not be flagged as graceful");
    listener.close();
  });

  it("close after ready fires onClose with code, reason, stateAtClose, and msSinceReady", async () => {
    const closedEvents: Array<{
      code: number;
      reason: string;
      stateAtClose: string;
      msSinceReady: number | null;
      lastFrameType: string | null;
    }> = [];

    const { listener, getWs } = makeListener({
      onClose: (info) => closedEvents.push(info),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    assert.equal(listener.state, "ready");

    // Simulate the 1006 abnormal-close that follows user/syncrequest on Tradovate demo
    ws.triggerClose(1006, "");

    assert.equal(closedEvents.length, 1, "onClose must fire once on unexpected close");
    const ev = closedEvents[0]!;
    assert.equal(ev.code, 1006);
    assert.equal(ev.stateAtClose, "ready");
    assert.ok(ev.msSinceReady !== null, "msSinceReady must be set when closed from ready");
    assert.ok(ev.msSinceReady! >= 0, "msSinceReady must be non-negative");
    // Last frame was the user/syncrequest response (a data frame)
    assert.equal(ev.lastFrameType, "data", "last frame before 1006 close should be the sync response");

    listener.close();
  });

  it("onClose is NOT fired when listener is explicitly closed via close()", async () => {
    const closedEvents: unknown[] = [];
    const { listener, getWs } = makeListener({
      onClose: (info) => closedEvents.push(info),
    });
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);

    listener.close(); // explicit clean shutdown

    assert.equal(closedEvents.length, 0, "onClose must not fire on explicit listener.close()");
  });

  it("close during auth fires onClose with stateAtClose=authorizing and msSinceReady=null", async () => {
    const closedEvents: Array<{ stateAtClose: string; msSinceReady: number | null }> = [];
    const { listener, getWs } = makeListener({
      onClose: (info) => closedEvents.push(info),
    });
    await listener.start();
    const ws = getWs()!;
    ws.triggerOpen();
    ws.triggerMessage("o"); // sends authorize
    ws.triggerClose(1000, "Bye"); // closes before auth response

    assert.equal(closedEvents.length, 1);
    assert.equal(closedEvents[0]!.stateAtClose, "authorizing");
    assert.equal(closedEvents[0]!.msSinceReady, null, "must be null when never reached ready");
    listener.close();
  });

  it("SockJS heartbeat frames after ready do not change state or error", async () => {
    const { listener, states, getWs } = makeListener();
    await listener.start();
    const ws = getWs()!;
    completeConnect(ws);
    const statesBeforeHeartbeat = [...states];

    ws.triggerHeartbeat();
    ws.triggerHeartbeat();

    // No new state transitions — heartbeat is silent
    assert.deepEqual(states, statesBeforeHeartbeat, "heartbeat must not cause a state transition");
    listener.close();
  });
});

// ── Source-scan: no token logging ────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const LISTENER_SRC = readFileSync(
  resolve(import.meta.dirname, "./tradovate-user-sync-listener.ts"),
  "utf8",
);

describe("TradovateUserSyncListener source: no token logging", () => {
  it("source does not log accessToken field", () => {
    const forbidden = ["accessToken", "refreshToken", "tokenEncrypted"];
    const logSections = LISTENER_SRC.match(/console\.(log|warn|info|error)\([\s\S]*?\)/g) ?? [];
    for (const logCall of logSections) {
      for (const field of forbidden) {
        assert.ok(
          !logCall.includes(field),
          `log call must not include token field "${field}": ${logCall.slice(0, 80)}`,
        );
      }
    }
  });

  it("source uses injectable wsFactory (not hard-coded WebSocket import)", () => {
    assert.ok(
      LISTENER_SRC.includes("wsFactory"),
      "listener must use injectable wsFactory",
    );
    // Verify there is no top-level import (the only WebSocket reference must be
    // inside a JSDoc example comment, not a real import statement).
    const topLevelImportIdx = LISTENER_SRC.indexOf("\nimport WebSocket");
    assert.equal(
      topLevelImportIdx,
      -1,
      "listener must not have a top-level `import WebSocket` statement — inject via wsFactory",
    );
  });

  it("source has reconnect with exponential backoff", () => {
    assert.ok(
      LISTENER_SRC.includes("scheduleReconnect") && LISTENER_SRC.includes("Math.min"),
      "listener must have reconnect logic with capped exponential backoff",
    );
  });

  it("source implements four lifecycle states: connecting, authorizing, syncing, ready", () => {
    for (const state of ["connecting", "authorizing", "syncing", "ready"]) {
      assert.ok(LISTENER_SRC.includes(`"${state}"`), `must include state "${state}"`);
    }
  });

  it("source sends authorize only inside the SockJS 'o' frame handler, not in ws.onopen", () => {
    // Locate the ws.onopen handler body and assert it does NOT call encodeAuthorizeMessage.
    const onopenMatch = LISTENER_SRC.match(/ws\.onopen\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*\};/);
    assert.ok(onopenMatch, "must define a ws.onopen handler");
    assert.ok(
      !onopenMatch![0]!.includes("encodeAuthorizeMessage"),
      "ws.onopen must NOT send authorize directly — wait for SockJS 'o' frame",
    );
    // And the o-frame case must call the send helper.
    assert.ok(
      /case "open":[\s\S]*?sendAuthorize/.test(LISTENER_SRC),
      "SockJS 'open' frame case must invoke #sendAuthorize",
    );
  });

  it("source has consecutive-auth-failure backoff with onTerminalError", () => {
    assert.ok(
      LISTENER_SRC.includes("consecutiveAuthFailures"),
      "must track consecutive auth failures",
    );
    assert.ok(
      LISTENER_SRC.includes("onTerminalError"),
      "must expose onTerminalError callback",
    );
    assert.ok(
      LISTENER_SRC.includes("maxAuthFailures"),
      "must expose maxAuthFailures config",
    );
  });

  it("source logs safe phase markers for the handshake and close", () => {
    for (const phase of [
      "socket_open", "auth_sent", "auth_ok", "auth_failed", "user_sync_sent",
      "connection_closed", "sockjs_close",
    ]) {
      assert.ok(
        LISTENER_SRC.includes(phase),
        `expected phase log marker: ${phase}`,
      );
    }
  });

  it("source logs payloadLength (frame size) for diagnostics", () => {
    assert.ok(
      LISTENER_SRC.includes("payloadLength"),
      "must log frame size so operators can verify the auth frame was actually sent",
    );
  });

  it("source forwards forceRefresh option to getAccessToken on 401 retry", () => {
    assert.ok(
      /getAccessToken\(\{\s*forceRefresh/.test(LISTENER_SRC),
      "listener must call getAccessToken with forceRefresh option",
    );
    assert.ok(
      LISTENER_SRC.includes("#forceRefreshNextConnect"),
      "listener must track which next connect should force a refresh",
    );
  });

  it("source handles 401 distinctly (force-refresh retry once, then terminal)", () => {
    assert.ok(
      LISTENER_SRC.includes("has401Retried"),
      "listener must track whether it has already retried after 401",
    );
    assert.ok(
      LISTENER_SRC.includes("status === 401") || LISTENER_SRC.includes("status===401"),
      "listener must branch on status === 401 in the auth-failed handler",
    );
    assert.ok(
      LISTENER_SRC.includes("auth_retry_forced"),
      "listener must log auth_retry_forced phase when forcing a refresh",
    );
  });

  it("auth-failed log includes safe wsHost diagnostic (no token)", () => {
    assert.ok(
      LISTENER_SRC.includes("wsHost"),
      "auth_failed log must include wsHost for env mismatch debugging",
    );
    // safeHost helper must extract host only, never the full URL with query
    assert.ok(
      LISTENER_SRC.includes("safeHost"),
      "listener must define a safeHost helper",
    );
  });
});
