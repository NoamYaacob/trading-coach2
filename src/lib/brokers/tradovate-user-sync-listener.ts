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
   * When `forceRefresh` is true the implementation should bypass any
   * "still fresh" caching and renew the token before returning it — the
   * listener passes this after the broker rejected the prior token with 401.
   * IMPORTANT: the token must NEVER be logged anywhere in this class.
   */
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string>;
  /**
   * Optional callback fired when authorize returns a non-200 status. The
   * worker uses this to log safe diagnostics (token age, env, URL host)
   * alongside the listener's own auth_failed log. Receives the HTTP-style
   * status code Tradovate returned and a whitelisted errorText if any.
   * Never receives the access token.
   */
  onAuthFailed?: (info: { status: number; errorText: string | null; willRetryWithForcedRefresh: boolean }) => void;
  /** Called whenever a props event arrives that triggers enforcement re-evaluation. */
  onPositionEvent?: (props: TradovatePropsEventData) => void;
  /**
   * Called when the WebSocket closes unexpectedly (not via `close()`). Receives
   * the close code/reason plus a snapshot of post-ready frame diagnostics so
   * the worker can persist `listenerLastCloseCode`/`listenerLastCloseReason` and
   * operators can see how long the connection lived after "ready" and what the
   * last frame was before the drop.
   *
   * Not fired on clean `close()` calls or terminal-error shutdowns.
   */
  onClose?: (info: {
    code: number;
    reason: string;
    stateAtClose: ListenerState;
    msSinceReady: number | null;
    lastFrameType: string | null;
    lastFrameAt: Date | null;
  }) => void;
  /**
   * Called whenever any props event arrives (for broad subscription). */
  onPropsEvent?: (props: TradovatePropsEventData) => void;
  /** Called when the listener transitions to a new state. */
  onStateChange?: (state: ListenerState) => void;
  /** Called when the listener receives a heartbeat from the server. */
  onHeartbeat?: (at: Date) => void;
  /**
   * Called once when the listener gives up (e.g. after N consecutive
   * close-during-auth events). After this fires, the listener is closed and
   * will not reconnect. The reason string is safe to surface to operators
   * but never contains the access token.
   */
  onTerminalError?: (reason: string) => void;
  /**
   * Number of consecutive close-during-auth events before the listener
   * stops reconnecting and emits onTerminalError. Default: 3.
   */
  maxAuthFailures?: number;
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
  /** Stamped when the listener first enters "ready" on the current connection. */
  #readyAt: Date | null = null;
  /** SockJS frame type of the most recent frame on the current connection. */
  #lastFrameType: string | null = null;
  /** Timestamp of the most recent frame on the current connection. */
  #lastFrameAt: Date | null = null;
  #closed = false;
  /** Held only between #connect() and the SockJS "o" frame. Cleared right
   *  after the authorize message is sent. NEVER logged. */
  #pendingAccessToken: string | null = null;
  /** Consecutive close-during-auth events. Reset on auth success. */
  #consecutiveAuthFailures = 0;
  /**
   * True when the broker has already rejected our token with 401 once on this
   * connection lifecycle and we've requested a force-refresh on the next
   * connect. A second 401 after this terminates the listener immediately.
   */
  #has401Retried = false;
  /** Force the next #connect() to request a refreshed access token. */
  #forceRefreshNextConnect = false;

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
    // Reset per-connection diagnostics so the close handler always reflects
    // the current connection, not a stale one from a previous attempt.
    this.#readyAt = null;
    this.#lastFrameType = null;
    this.#lastFrameAt = null;
    this.#setState("connecting");
    const url = TRADOVATE_WS_URL[this.#config.env];

    const forceRefresh = this.#forceRefreshNextConnect;
    this.#forceRefreshNextConnect = false;

    let accessToken: string;
    try {
      accessToken = await this.#config.getAccessToken({ forceRefresh });
    } catch (err) {
      console.warn("[TradovateUserSyncListener] failed to retrieve access token, will retry", {
        connectionId: this.#config.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.#scheduleReconnect();
      return;
    }

    // Park the token on the instance so the SockJS "o" frame handler can
    // send it. Tradovate's protocol requires waiting for "o" before sending
    // authorize — sending on ws.onopen (TCP/TLS open) gets the socket closed
    // with code 1000 reason "Bye". The token is cleared the moment authorize
    // is sent and is NEVER logged.
    this.#pendingAccessToken = accessToken;

    const ws = this.#config.wsFactory(url);
    this.#ws = ws;

    ws.onopen = () => {
      if (this.#ws !== ws) return; // stale
      console.info("[TradovateUserSyncListener] socket open, waiting for SockJS 'o' frame", {
        connectionId: this.#config.connectionId,
        env: this.#config.env,
        phase: "socket_open",
      });
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
      // Always discard any pending token on close.
      this.#pendingAccessToken = null;
      if (this.#closed) {
        this.#setState("closed");
        return;
      }

      // Capture diagnostics before any state transitions.
      const stateAtClose = this.#state;
      const msSinceReady = this.#readyAt !== null
        ? Date.now() - this.#readyAt.getTime()
        : null;
      const lastFrameType = this.#lastFrameType;
      const lastFrameAt = this.#lastFrameAt;

      // Notify the worker so it can persist the close code/reason to DB and
      // surface them in the debug endpoint (code 1006 = abnormal/no-close-frame).
      this.#config.onClose?.({
        code: event.code,
        reason: event.reason,
        stateAtClose,
        msSinceReady,
        lastFrameType,
        lastFrameAt,
      });

      // Close-during-auth = either the SockJS handshake never produced "o",
      // or Tradovate rejected the authorize message. Count these so we can
      // stop a noisy retry loop on a bad/revoked token.
      const closedDuringAuth =
        stateAtClose === "connecting" || stateAtClose === "authorizing";
      if (closedDuringAuth) {
        this.#consecutiveAuthFailures++;
        const limit = this.#config.maxAuthFailures ?? 3;
        if (this.#consecutiveAuthFailures >= limit) {
          const reason = `auth failed ${this.#consecutiveAuthFailures}x — last close code=${event.code} reason=${event.reason || "(none)"}`;
          console.warn("[TradovateUserSyncListener] giving up after consecutive auth failures", {
            connectionId: this.#config.connectionId,
            attempts: this.#consecutiveAuthFailures,
            lastCloseCode: event.code,
            lastCloseReason: event.reason,
            phase: "auth_terminal",
          });
          this.#closed = true;
          this.#clearReconnectTimer();
          this.#setState("closed");
          this.#config.onTerminalError?.(reason);
          return;
        }
      }

      console.info("[TradovateUserSyncListener] connection closed, scheduling reconnect", {
        connectionId: this.#config.connectionId,
        code: event.code,
        reason: event.reason || null,
        stateAtClose,
        msSinceReady,
        lastFrameType,
        lastFrameAt: lastFrameAt?.toISOString() ?? null,
        reconnectAttempt: this.#reconnectAttempt,
        consecutiveAuthFailures: this.#consecutiveAuthFailures,
        phase: "connection_closed",
      });
      this.#scheduleReconnect();
    };
  }

  // ── Private: frame handling ────────────────────────────────────────────────

  #handleRawFrame(raw: string): void {
    const frame = parseSockJSFrame(raw);
    this.#lastFrameType = frame.type;
    this.#lastFrameAt = new Date();

    switch (frame.type) {
      case "open":
        this.#sendAuthorize();
        break;

      case "heartbeat":
        this.#lastHeartbeatAt = new Date();
        this.#config.onHeartbeat?.(this.#lastHeartbeatAt);
        break;

      case "close":
        // Server-initiated SockJS session close. Log the code/reason before
        // closing the underlying WebSocket — the subsequent ws.onclose will
        // carry the transport-level code (often 1000) rather than this value.
        console.info("[TradovateUserSyncListener] SockJS close frame received", {
          connectionId: this.#config.connectionId,
          sockjsCode: frame.code,
          sockjsReason: frame.reason,
          state: this.#state,
          phase: "sockjs_close",
        });
        this.#ws?.close();
        break;

      case "data":
        for (const msg of frame.messages) {
          this.#handleMessage(msg);
        }
        break;
    }
  }

  #handleMessage(item: unknown): void {
    const parsed = parseTradovateMessage(item);

    if (parsed.kind === "response") {
      const { i: responseId, ...rest } = parsed.data;
      if (responseId === this.#pendingAuthId) {
        if (isSuccessResponse(parsed.data)) {
          this.#consecutiveAuthFailures = 0; // reset on success
          this.#has401Retried = false; // reset 401-retry tracker on success
          console.info("[TradovateUserSyncListener] authorize ok, sending user/syncrequest", {
            connectionId: this.#config.connectionId,
            command: "authorize",
            requestId: responseId,
            status: parsed.data.s,
            phase: "auth_ok",
          });
          this.#setState("syncing");
          this.#pendingAuthId = null;
          const syncId = this.#nextRequestId();
          this.#pendingSyncId = syncId;
          const syncFrame = encodeUserSyncRequest(syncId, this.#config.tradovateUserId);
          console.info("[TradovateUserSyncListener] sending user/syncrequest", {
            connectionId: this.#config.connectionId,
            command: "user/syncrequest",
            requestId: syncId,
            payloadLength: syncFrame.length,
            phase: "user_sync_sent",
          });
          this.#ws?.send(syncFrame);
        } else {
          this.#handleAuthFailed(parsed.data.s, parsed.data.p, responseId);
        }
        void rest; // suppress unused variable lint
      } else if (responseId === this.#pendingSyncId) {
        if (isSuccessResponse(parsed.data)) {
          console.info("[TradovateUserSyncListener] user/syncrequest ok, listener is ready", {
            connectionId: this.#config.connectionId,
            phase: "ready",
          });
          this.#setState("ready");
          this.#pendingSyncId = null;
          this.#reconnectAttempt = 0; // successful connection — reset backoff
        } else {
          console.warn("[TradovateUserSyncListener] user/syncrequest failed", {
            connectionId: this.#config.connectionId,
            command: "user/syncrequest",
            requestId: responseId,
            status: parsed.data.s,
            errorText: extractErrorText(parsed.data.p),
            phase: "sync_failed",
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

  // ── Private: authorize ─────────────────────────────────────────────────────

  /**
   * Send the Tradovate `authorize` request. MUST be called only after the
   * SockJS "o" frame is received — sending earlier causes the server to drop
   * the connection with code 1000 reason "Bye". The token is read from
   * #pendingAccessToken, used once for the wire message, then immediately
   * cleared and never logged.
   */
  #sendAuthorize(): void {
    const token = this.#pendingAccessToken;
    if (!token) {
      console.warn("[TradovateUserSyncListener] SockJS 'o' frame arrived with no pending token", {
        connectionId: this.#config.connectionId,
        phase: "sockjs_open_no_token",
      });
      return;
    }
    // Drop the token immediately so a stray log call cannot reach it.
    this.#pendingAccessToken = null;

    this.#setState("authorizing");
    const authId = this.#nextRequestId();
    this.#pendingAuthId = authId;
    const frame = encodeAuthorizeMessage(authId, token);
    console.info("[TradovateUserSyncListener] sending authorize", {
      connectionId: this.#config.connectionId,
      env: this.#config.env,
      command: "authorize",
      requestId: authId,
      // Log only the frame length, never the token. The on-wire format is
      // `authorize\n<id>\n\n<token>` — the token is sent raw, NOT JSON-quoted
      // (probe variant B_raw confirmed against demo.tradovateapi.com).
      payloadLength: frame.length,
      phase: "auth_sent",
    });
    this.#ws?.send(frame);
  }

  /**
   * Handle a non-200 authorize response.
   *
   * On HTTP 401 specifically, we suspect the stored access token went stale on
   * the broker side (revoked, rotated, or wrong env). The flow:
   *   1st 401 — force a token refresh on the next connect and let the existing
   *             reconnect path retry. Logs `auth_failed` + `auth_retry_forced`.
   *   2nd 401 — give up immediately and emit a terminal error. The forced
   *             refresh did not help, so further retries waste API calls.
   *
   * Non-401 failures fall through to the existing close-during-auth counter,
   * which terminates the listener after maxAuthFailures consecutive closes.
   */
  #handleAuthFailed(status: number, payload: unknown, requestId: number): void {
    const errorText = extractErrorText(payload);
    const wsHost = safeHost(TRADOVATE_WS_URL[this.#config.env]);

    if (status === 401) {
      const willRetryWithForcedRefresh = !this.#has401Retried;
      console.warn("[TradovateUserSyncListener] authorization failed", {
        connectionId: this.#config.connectionId,
        env: this.#config.env,
        wsHost,
        command: "authorize",
        requestId,
        status,
        errorText,
        willRetryWithForcedRefresh,
        phase: "auth_failed",
      });
      this.#config.onAuthFailed?.({ status, errorText, willRetryWithForcedRefresh });

      if (willRetryWithForcedRefresh) {
        this.#has401Retried = true;
        this.#forceRefreshNextConnect = true;
        console.info("[TradovateUserSyncListener] forcing token refresh and retrying once", {
          connectionId: this.#config.connectionId,
          env: this.#config.env,
          phase: "auth_retry_forced",
        });
        this.#ws?.close();
        return;
      }

      // Second 401 — refresh didn't help. Give up immediately.
      const reason = `authorize returned 401 after forced token refresh — re-authorize required`;
      console.warn("[TradovateUserSyncListener] giving up — 401 persisted after forced refresh", {
        connectionId: this.#config.connectionId,
        env: this.#config.env,
        wsHost,
        status,
        phase: "auth_terminal",
      });
      this.#closed = true;
      this.#clearReconnectTimer();
      this.#ws?.close();
      this.#setState("closed");
      this.#config.onTerminalError?.(reason);
      return;
    }

    // Non-401 failure — log, emit callback, close. The onclose handler will
    // count this toward the close-during-auth tally and may terminate.
    console.warn("[TradovateUserSyncListener] authorization failed", {
      connectionId: this.#config.connectionId,
      env: this.#config.env,
      wsHost,
      command: "authorize",
      requestId,
      status,
      errorText,
      willRetryWithForcedRefresh: false,
      phase: "auth_failed",
    });
    this.#config.onAuthFailed?.({ status, errorText, willRetryWithForcedRefresh: false });
    this.#ws?.close();
  }

  // ── Private: state machine ────────────────────────────────────────────────

  #setState(state: ListenerState): void {
    if (this.#state === state) return;
    this.#state = state;
    if (state === "ready") this.#readyAt = new Date();
    this.#config.onStateChange?.(state);
  }

  #nextRequestId(): number {
    return this.#requestIdCounter++;
  }
}

/**
 * Pull a safe-to-log error string out of a Tradovate response payload, if
 * the server returned one. Whitelists known fields (`errorText`, `message`)
 * to avoid accidentally logging other payload contents.
 */
function extractErrorText(p: unknown): string | null {
  if (typeof p === "string") return p;
  if (p && typeof p === "object") {
    const rec = p as Record<string, unknown>;
    if (typeof rec.errorText === "string") return rec.errorText;
    if (typeof rec.message === "string") return rec.message;
  }
  return null;
}

/** Extract the host portion of a wss:// URL for safe logging. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}
