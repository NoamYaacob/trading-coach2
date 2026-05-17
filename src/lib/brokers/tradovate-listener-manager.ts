/**
 * Tradovate listener manager — manages one listener per broker connection.
 *
 * Guarantees:
 *   - At most one TradovateUserSyncListener per brokerConnectionId.
 *   - Expired / read-only connections are skipped (no listener started).
 *   - Stopping a listener closes it cleanly and removes it from the map.
 *   - Status query returns the current state for health-check and DB heartbeat.
 *
 * Caller responsibilities:
 *   - Provide a WebSocketFactory (injected for testability).
 *   - Call startListener(config) for each healthy connection.
 *   - Poll listenerStatus(id) to update the DB heartbeat fields.
 *   - Call stopListener(id) when a connection is disconnected or expired.
 *   - Call closeAll() on process exit.
 *
 * No DB reads — the manager does not query Prisma. Callers (the worker script
 * or a next-PR integration hook) are responsible for reading DB state and
 * passing the right connections in.
 *
 * Token safety: no function in this module reads, stores, or logs token values.
 */

import {
  TradovateUserSyncListener,
  type TradovateUserSyncListenerConfig,
  type ListenerState,
} from "./tradovate-user-sync-listener.ts";
import type { TradovatePropsEventData } from "./tradovate-websocket-protocol.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** Status snapshot for a single managed listener. */
export type ListenerStatus = {
  connectionId: string;
  state: ListenerState;
  lastHeartbeatAt: Date | null;
  lastEventAt: Date | null;
};

/** Config required to start a listener. Subset of TradovateUserSyncListenerConfig. */
export type ManagedListenerConfig = {
  connectionId: string;
  tradovateUserId: number;
  env: "live" | "demo";
  /** Whether the connection has write permission (full_access). Determines log context. */
  permissionLevel: "full_access" | "read_only" | null;
  /** Called to retrieve the current access token. Never logged. */
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string>;
  /** Callback when a position/fill/order event arrives — triggers enforcement. */
  onPositionEvent?: (connectionId: string, props: TradovatePropsEventData) => void;
  /** Callback on any props event — for broad subscription / heartbeat tracking. */
  onPropsEvent?: (connectionId: string, props: TradovatePropsEventData) => void;
  /** Callback when listener heartbeat arrives — for DB staleness update. */
  onHeartbeat?: (connectionId: string, at: Date) => void;
  /** Callback when listener state transitions — for DB listenerStatus update. */
  onStateChange?: (connectionId: string, state: ListenerState) => void;
  /** Callback when listener gives up (e.g. repeated auth failures). */
  onTerminalError?: (connectionId: string, reason: string) => void;
  /**
   * Callback for non-200 authorize responses. Routed from the listener so the
   * worker can log token-age / env diagnostics alongside. Never receives the
   * access token.
   */
  onAuthFailed?: (
    connectionId: string,
    info: { status: number; errorText: string | null; willRetryWithForcedRefresh: boolean },
  ) => void;
  /**
   * Callback when the WebSocket closes unexpectedly (not via `close()`). Used
   * by the worker to persist `listenerLastCloseCode` / `listenerLastCloseReason`
   * and to log post-ready frame diagnostics.
   */
  onClose?: (
    connectionId: string,
    info: {
      code: number;
      reason: string;
      gracefulRecycle: boolean;
      stateAtClose: ListenerState;
      msSinceReady: number | null;
      lastFrameType: string | null;
      lastFrameAt: Date | null;
    },
  ) => void;
  /** Called when the listener reaches "ready" state (initial connect or reconnect). */
  onReady?: (connectionId: string, info: { isReconnect: boolean }) => void;
};

// ── Manager ──────────────────────────────────────────────────────────────────

export class TradovateListenerManager {
  #listeners = new Map<string, TradovateUserSyncListener>();
  #wsFactory: TradovateUserSyncListenerConfig["wsFactory"];

  constructor(wsFactory: TradovateUserSyncListenerConfig["wsFactory"]) {
    this.#wsFactory = wsFactory;
  }

  /**
   * Start a listener for the given connection. No-op if one is already running.
   *
   * Returns true when a new listener was started, false when a dedup occurred.
   * Skips connections with read_only permission (they cannot be useful for
   * enforcement but can still observe position state if needed).
   */
  async startListener(config: ManagedListenerConfig): Promise<boolean> {
    if (this.#listeners.has(config.connectionId)) {
      console.info("[TradovateListenerManager] listener already running, skipping", {
        connectionId: config.connectionId,
        state: this.#listeners.get(config.connectionId)!.state,
      });
      return false;
    }

    const listener = new TradovateUserSyncListener({
      wsFactory: this.#wsFactory,
      env: config.env,
      connectionId: config.connectionId,
      tradovateUserId: config.tradovateUserId,
      getAccessToken: config.getAccessToken,
      onPositionEvent: config.onPositionEvent
        ? (props) => config.onPositionEvent!(config.connectionId, props)
        : undefined,
      onPropsEvent: config.onPropsEvent
        ? (props) => config.onPropsEvent!(config.connectionId, props)
        : undefined,
      onHeartbeat: config.onHeartbeat
        ? (at) => config.onHeartbeat!(config.connectionId, at)
        : undefined,
      onStateChange: (state) => {
        console.info("[TradovateListenerManager] listener state change", {
          connectionId: config.connectionId,
          state,
        });
        config.onStateChange?.(config.connectionId, state);
      },
      onTerminalError: (reason) => {
        console.warn("[TradovateListenerManager] listener terminal error", {
          connectionId: config.connectionId,
          reason,
        });
        // Drop from the managed set so a future reconcile can retry only after
        // operator action clears listenerErrorMessage.
        this.#listeners.delete(config.connectionId);
        config.onTerminalError?.(config.connectionId, reason);
      },
      onAuthFailed: config.onAuthFailed
        ? (info) => config.onAuthFailed!(config.connectionId, info)
        : undefined,
      onClose: config.onClose
        ? (info) => config.onClose!(config.connectionId, info)
        : undefined,
      onReady: config.onReady
        ? (info) => config.onReady!(config.connectionId, info)
        : undefined,
    });

    this.#listeners.set(config.connectionId, listener);

    console.info("[TradovateListenerManager] starting listener", {
      connectionId: config.connectionId,
      env: config.env,
      tradovateUserId: config.tradovateUserId,
    });

    await listener.start();
    return true;
  }

  /** Stop and remove a listener. No-op if not running. */
  stopListener(connectionId: string): void {
    const listener = this.#listeners.get(connectionId);
    if (!listener) return;
    listener.close();
    this.#listeners.delete(connectionId);
    console.info("[TradovateListenerManager] listener stopped", { connectionId });
  }

  /** Stop all listeners. Call on process exit. */
  closeAll(): void {
    for (const [id, listener] of this.#listeners) {
      listener.close();
      console.info("[TradovateListenerManager] closed listener on shutdown", { connectionId: id });
    }
    this.#listeners.clear();
  }

  /** Get the current status of a specific listener. null if not managed. */
  listenerStatus(connectionId: string): ListenerStatus | null {
    const listener = this.#listeners.get(connectionId);
    if (!listener) return null;
    return {
      connectionId,
      state: listener.state,
      lastHeartbeatAt: listener.lastHeartbeatAt,
      lastEventAt: listener.lastEventAt,
    };
  }

  /** Get status snapshots for all managed listeners. */
  allListenerStatuses(): ListenerStatus[] {
    return Array.from(this.#listeners.entries()).map(([id, listener]) => ({
      connectionId: id,
      state: listener.state,
      lastHeartbeatAt: listener.lastHeartbeatAt,
      lastEventAt: listener.lastEventAt,
    }));
  }

  /** True when a listener is actively managed for this connection. */
  hasListener(connectionId: string): boolean {
    return this.#listeners.has(connectionId);
  }

  /** Count of active managed listeners. */
  get listenerCount(): number {
    return this.#listeners.size;
  }
}

// ── Health-check helpers ─────────────────────────────────────────────────────

/** How long without a heartbeat before a listener is considered stale. */
export const LISTENER_STALE_THRESHOLD_MS = 60_000; // 60 s

/** Returns a human-readable freshness label for dashboard display. */
export function listenerFreshnessLabel(status: ListenerStatus | null): string {
  if (!status) return "No listener";

  if (status.state === "ready" || status.state === "syncing") {
    const lastEvent = status.lastEventAt ?? status.lastHeartbeatAt;
    if (lastEvent) {
      const agoMs = Date.now() - lastEvent.getTime();
      if (agoMs < 60_000) return `Live monitoring · ${Math.round(agoMs / 1000)}s ago`;
      const agoMin = Math.round(agoMs / 60_000);
      return `Live monitoring · ${agoMin}m ago`;
    }
    return "Live monitoring · waiting for first event";
  }

  if (status.state === "reconnecting" || status.state === "connecting") {
    return "Reconnecting…";
  }

  if (status.state === "closed") return "Listener closed";

  return "Connecting…";
}

/** True when a listener is stale (heartbeat overdue or not ready). */
export function isListenerStale(status: ListenerStatus | null): boolean {
  if (!status || status.state !== "ready") return true;
  const lastSignal = status.lastHeartbeatAt ?? status.lastEventAt;
  if (!lastSignal) return true;
  return Date.now() - lastSignal.getTime() > LISTENER_STALE_THRESHOLD_MS;
}
