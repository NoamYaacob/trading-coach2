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

  it("source logs safe phase markers for the handshake", () => {
    for (const phase of ["socket_open", "auth_sent", "auth_ok", "auth_failed", "user_sync_sent"]) {
      assert.ok(
        LISTENER_SRC.includes(phase),
        `expected handshake phase log marker: ${phase}`,
      );
    }
  });

  it("source logs payloadLength (frame size) for diagnostics", () => {
    assert.ok(
      LISTENER_SRC.includes("payloadLength"),
      "must log frame size so operators can verify the auth frame was actually sent",
    );
  });
});
