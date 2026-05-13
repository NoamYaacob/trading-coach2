/**
 * Tradovate user/syncrequest WebSocket listener — state-machine class.
 *
 * Manages the lifecycle of a single WebSocket connection to the Tradovate
 * user-data endpoint. Handles:
 *   - SockJS frame parsing
 *   - Authentication (authorize)
 *   - User sync subscription (user/syncrequest)
 *   - Props event dispatch to registered callbacks
 *   - Reconnect with exponential backoff
 *   - Heartbeat tracking
 *
 * Dependency-injected design: the WebSocket is provided by the caller via a
 * factory function (WebSocketFactory). This keeps the class pure/testable —
 * tests can inject a mock WS without needing a real network.
 *
 * Production usage (next PR — requires ws package):
 *   import WebSocket from "ws";
 *   const listener = new TradovateUserSyncListener({
 *     wsFactory: (url) => new WebSocket(url),
 *     ...config
 *   });
 *
 * Token safety: the access token is passed in during connect() and used only
 * for the authorize message. It is NEVER stored after the message is sent and
 * NEVER appears in logs.
 */

import {
  parseSockJSFrame,
  parseTradovateMessage,
  isSuccessResponse,
  isPropsEvent,
  parsePropsEvent,
  isPositionEnforcementTrigger,
  encodeAuthorizeMessage,
  encodeUserSyncRequest,
  TRADOVATE_WS_URL,
  type TradovatePropsEventData,
} from "./tradovate-websocket-protocol.ts";

// ── State machine ────────────────────────────────────────────────────────────

export type ListenerState =
  | "idle"
  | "connecting"
  | "authorizing"
  | "syncing"
  | "ready"
  | "reconnecting"
  | "closed";

// ── Injectable WebSocket interface ───────────────────────────────────────────

/** Minimal WebSocket interface — compatible with both browser and Node ws. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

/** Factory that creates a WebSocket-like connection to the given URL. */
export type WebSocketFactory = (url: string) => WebSocketLike;

// ── Config ───────────────────────────────────────────────────────────────────

export type TradovateUserSyncListenerConfig = {
  /** Inject a WebSocket factory (production: `(url) => new WebSocket(url)`) */
  wsFactory: WebSocketFactory;
  /** Tradovate environment. Determines the WS URL. */
  env: "live" | "demo";
  /** Guardrail brokerConnectionId — for log context and deduplication. */
  connectionId: string;
  /** Tradovate brokerUserId (numeric). Sent in user/syncrequest. */
  tradovateUserId: number;
  /**
   * Async callback to retrieve the current access token for (re)authentication.
   * Called once per connect attempt. Must return the raw token string.
   * IMPORTANT: the token must NEVER be logged anywhere in this class.
   */
  getAccessToken: () => Promise<string>;
  /** Called whenever a props event arrives that triggers enforcement re-evaluation. */
  onPositionEvent?: (props: TradovatePropsEventData) => void;
  /** Called whenever any props event arrives (for broad subscription). */
  onPropsEvent?: (props: TradovatePropsEventData) => void;
  /** Called when the listener transitions to a new state. */
  onStateChange?: (state: ListenerState) => void;
  /** Called when the listener receives a heartbeat from the server. */
  onHeartbeat?: (at: Date) => void;
  /**
   * Max reconnect delay in ms. Actual delay is capped to this value.
   * Default: 30_000 ms (30 s).
   */
  maxReconnectDelayMs?: number;
  /**
   * Base reconnect delay in ms. Each retry doubles this (exponential backoff).
   * Default: 1_000 ms.
   */
  baseReconnectDelayMs?: number;
};

// ── Listener class ───────────────────────────────────────────────────────────

export class TradovateUserSyncListener {
  #config: TradovateUserSyncListenerConfig;
  #state: ListenerState = "idle";
  #ws: WebSocketLike | null = null;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #requestIdCounter = 1;
  #pendingAuthId: number | null = null;
  #pendingSyncId: number | null = null;
  #lastHeartbeatAt: Date | null = null;
  #lastEventAt: Date | null = null;
  #closed = false;

  constructor(config: TradovateUserSyncListenerConfig) {
    this.#config = config;
  }

  get state(): ListenerState {
    return this.#state;
  }

  get lastHeartbeatAt(): Date | null {
    return this.#lastHeartbeatAt;
  }

  get lastEventAt(): Date | null {
    return this.#lastEventAt;
  }

  get connectionId(): string {
    return this.#config.connectionId;
  }

  /** Start the listener. Idempotent if already connecting/ready. */
  async start(): Promise<void> {
    if (this.#closed) {
      console.warn("[TradovateUserSyncListener] start() called on closed listener", {
        connectionId: this.#config.connectionId,
      });
      return;
    }
    if (this.#state !== "idle" && this.#state !== "reconnecting") return;
    await this.#connect();
  }

  /** Permanently close the listener. Does not reconnect. */
  close(): void {
    this.#closed = true;
    this.#clearReconnectTimer();
    this.#ws?.close();
    this.#ws = null;
    this.#setState("closed");
  }

  // ── Private: connect ───────────────────────────────────────────────────────

  async #connect(): Promise<void> {
    this.#setState("connecting");
    const url = TRADOVATE_WS_URL[this.#config.env];

    let accessToken: string;
    try {
      accessToken = await this.#config.getAccessToken();
    } catch (err) {
      console.warn("[TradovateUserSyncListener] failed to retrieve access token, will retry", {
        connectionId: this.#config.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.#scheduleReconnect();
      return;
    }

    const ws = this.#config.wsFactory(url);
    this.#ws = ws;

    ws.onopen = () => {
      if (this.#ws !== ws) return; // stale
      this.#setState("authorizing");
      const authId = this.#nextRequestId();
      this.#pendingAuthId = authId;
      // Token is used once for the wire message and then discarded.
      ws.send(encodeAuthorizeMessage(authId, accessToken));
    };

    ws.onmessage = (event) => {
      if (this.#ws !== ws) return; // stale
      this.#handleRawFrame(event.data);
    };

    ws.onerror = (event) => {
      if (this.#ws !== ws) return;
      console.warn("[TradovateUserSyncListener] WebSocket error", {
        connectionId: this.#config.connectionId,
        state: this.#state,
        error: event instanceof Error ? event.message : "WebSocket error",
      });
    };

    ws.onclose = (event) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      if (this.#closed) {
        this.#setState("closed");
        return;
      }
      console.info("[TradovateUserSyncListener] connection closed, scheduling reconnect", {
        connectionId: this.#config.connectionId,
        code: event.code,
        reason: event.reason,
        reconnectAttempt: this.#reconnectAttempt,
      });
      this.#scheduleReconnect();
    };
  }

  // ── Private: frame handling ────────────────────────────────────────────────

  #handleRawFrame(raw: string): void {
    const frame = parseSockJSFrame(raw);

    switch (frame.type) {
      case "open":
        // Already handled onopen callback above; SockJS sends "o" as the first frame.
        break;

      case "heartbeat":
        this.#lastHeartbeatAt = new Date();
        this.#config.onHeartbeat?.(this.#lastHeartbeatAt);
        break;

      case "close":
        this.#ws?.close();
        break;

      case "data":
        for (const msg of frame.messages) {
          this.#handleMessage(msg);
        }
        break;
    }
  }

  #handleMessage(raw: string): void {
    const parsed = parseTradovateMessage(raw);

    if (parsed.kind === "response") {
      const { i: responseId, ...rest } = parsed.data;
      if (responseId === this.#pendingAuthId) {
        if (isSuccessResponse(parsed.data)) {
          this.#setState("syncing");
          this.#pendingAuthId = null;
          const syncId = this.#nextRequestId();
          this.#pendingSyncId = syncId;
          this.#ws?.send(encodeUserSyncRequest(syncId, this.#config.tradovateUserId));
        } else {
          console.warn("[TradovateUserSyncListener] authorization failed", {
            connectionId: this.#config.connectionId,
            status: parsed.data.s,
          });
          this.#ws?.close();
        }
        void rest; // suppress unused variable lint
      } else if (responseId === this.#pendingSyncId) {
        if (isSuccessResponse(parsed.data)) {
          this.#setState("ready");
          this.#pendingSyncId = null;
          this.#reconnectAttempt = 0; // successful connection — reset backoff
        } else {
          console.warn("[TradovateUserSyncListener] user/syncrequest failed", {
            connectionId: this.#config.connectionId,
            status: parsed.data.s,
          });
          this.#ws?.close();
        }
      }
      return;
    }

    if (parsed.kind === "event") {
      const props = parsePropsEvent(parsed.data);
      if (props) {
        this.#lastEventAt = new Date();
        this.#config.onPropsEvent?.(props);
        if (isPositionEnforcementTrigger(props)) {
          this.#config.onPositionEvent?.(props);
        }
      }
    }
  }

  // ── Private: reconnect with backoff ───────────────────────────────────────

  #scheduleReconnect(): void {
    if (this.#closed) return;
    this.#setState("reconnecting");

    const base = this.#config.baseReconnectDelayMs ?? 1_000;
    const max = this.#config.maxReconnectDelayMs ?? 30_000;
    const delay = Math.min(base * 2 ** this.#reconnectAttempt, max);
    this.#reconnectAttempt++;

    console.info("[TradovateUserSyncListener] scheduling reconnect", {
      connectionId: this.#config.connectionId,
      attempt: this.#reconnectAttempt,
      delayMs: delay,
    });

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#closed) void this.#connect();
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  // ── Private: state machine ────────────────────────────────────────────────

  #setState(state: ListenerState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.#config.onStateChange?.(state);
  }

  #nextRequestId(): number {
    return this.#requestIdCounter++;
  }
}
