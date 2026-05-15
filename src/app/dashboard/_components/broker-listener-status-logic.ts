/**
 * Pure logic for BrokerListenerStatus — no JSX, no DOM.
 * Extracted so unit tests can import without a JSX transform.
 */

// ── Listener status data shape ───────────────────────────────────────────────

export type BrokerListenerStatusData = {
  /**
   * Current listener status from DB (BrokerConnection.listenerStatus).
   * null = no listener has been started for this connection.
   * "connected" | "connecting" | "reconnecting" | "closed"
   */
  listenerStatus: string | null;
  /** Timestamp of the last WebSocket event (BrokerConnection.listenerLastEventAt). */
  listenerLastEventAt: Date | null;
  /** Timestamp of the last WebSocket heartbeat (BrokerConnection.listenerLastHeartbeatAt). */
  listenerLastHeartbeatAt: Date | null;
  /** Timestamp of the last cron sync (ConnectedAccount.lastSyncAt). */
  lastSyncAt: Date | null;
  /** WebSocket close code from the most recent close (BrokerConnection.listenerLastCloseCode). */
  listenerLastCloseCode: number | null;
  /** WebSocket close reason from the most recent close (BrokerConnection.listenerLastCloseReason). */
  listenerLastCloseReason: string | null;
  /**
   * OAuth / connection health status (BrokerConnection.connectionStatus).
   * "expired" and "connection_error" short-circuit to a re-authorize label —
   * these states mean the OAuth grant is dead, not just that the listener is
   * temporarily offline.
   */
  connectionStatus: string | null;
  /** Whether the account has max position size configured. */
  hasMaxPositionSize: boolean;
  /** Whether raw broker hard limit mode is enabled for this account. */
  rawBrokerHardLimitEnabled: boolean;
};

// ── Time-ago helpers ─────────────────────────────────────────────────────────

export function msAgo(date: Date | null): number {
  if (!date) return Infinity;
  return Date.now() - date.getTime();
}

export function shortAgo(date: Date | null): string | null {
  const ms = msAgo(date);
  if (ms === Infinity) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

// ── Freshness label ──────────────────────────────────────────────────────────

export type FreshnessInfo = {
  label: string;
  isLive: boolean;
  isStale: boolean;
  isReconnecting: boolean;
};

export const STALE_THRESHOLD_MS = 5 * 60_000; // 5 min — same as cron cycle

/**
 * How long after the last heartbeat/event we still treat a reconnecting
 * listener as "Live". Tradovate recycles sessions with 1000/Bye every ~30s
 * and reconnects in seconds — the dashboard should stay green throughout.
 */
export const RECONNECT_LIVE_THRESHOLD_MS = 90_000; // 90 s

export function computeListenerFreshness(data: BrokerListenerStatusData): FreshnessInfo {
  const {
    listenerStatus,
    listenerLastEventAt,
    listenerLastHeartbeatAt,
    lastSyncAt,
    listenerLastCloseCode,
    listenerLastCloseReason,
    connectionStatus,
  } = data;

  // ── Dead OAuth grant — short-circuit before any listener checks ───────────
  // "expired" and "connection_error" mean the OAuth grant is dead and must be
  // re-authorized. These accounts must never borrow a Live label from another
  // connection — they need the user to act, not to look healthy.
  if (connectionStatus === "expired") {
    return { label: "Expired — re-authorize", isLive: false, isStale: true, isReconnecting: false };
  }
  if (connectionStatus === "connection_error") {
    return { label: "Connection error — re-authorize", isLive: false, isStale: true, isReconnecting: false };
  }

  // ── Live listener ──────────────────────────────────────────────────────────
  if (listenerStatus === "connected") {
    const lastSignal = listenerLastEventAt ?? listenerLastHeartbeatAt;
    const agoStr = shortAgo(lastSignal);
    return {
      label: agoStr ? `Live · ${agoStr}` : "Live · waiting for first event",
      isLive: true,
      isStale: false,
      isReconnecting: false,
    };
  }

  if (listenerStatus === "connecting" || listenerStatus === "reconnecting") {
    const lastSignal = listenerLastEventAt ?? listenerLastHeartbeatAt;
    // Keep the dashboard green while the session recycles. Tradovate sends a
    // 1000/Bye close every ~30 s and the listener reconnects in a few seconds.
    // As long as the last heartbeat/event is within the threshold, show Live.
    if (lastSignal && msAgo(lastSignal) <= RECONNECT_LIVE_THRESHOLD_MS) {
      const agoStr = shortAgo(lastSignal);
      return {
        label: `Live · ${agoStr} · reconnecting`,
        isLive: true,
        isStale: false,
        isReconnecting: true,
      };
    }
    const suffix = lastSignal ? ` · last signal ${shortAgo(lastSignal)}` : "";
    return {
      label: `Reconnecting…${suffix}`,
      isLive: false,
      isStale: false,
      isReconnecting: true,
    };
  }

  // ── Closed after graceful 1000/Bye recycle ────────────────────────────────
  // The worker writes "closed" on SIGTERM/process restart. If the last close was
  // a normal Tradovate session recycle (code=1000, reason="Bye") and the heartbeat
  // is still fresh, keep the dashboard green rather than flashing "Fallback sync"
  // during the brief restart window.
  if (listenerStatus === "closed" && listenerLastCloseCode === 1000 && listenerLastCloseReason === "Bye") {
    const lastSignal = listenerLastEventAt ?? listenerLastHeartbeatAt;
    if (lastSignal && msAgo(lastSignal) <= RECONNECT_LIVE_THRESHOLD_MS) {
      const agoStr = shortAgo(lastSignal);
      return {
        label: `Live · ${agoStr} · reconnecting`,
        isLive: true,
        isStale: false,
        isReconnecting: true,
      };
    }
  }

  // ── Fallback: cron sync ────────────────────────────────────────────────────
  const agoMs = msAgo(lastSyncAt);
  const agoStr = shortAgo(lastSyncAt);
  const isStale = agoMs > STALE_THRESHOLD_MS;

  if (!agoStr) {
    return {
      label: "No sync yet",
      isLive: false,
      isStale: true,
      isReconnecting: false,
    };
  }

  return {
    label: isStale ? `Stale · ${agoStr}` : `Fallback sync · ${agoStr}`,
    isLive: false,
    isStale,
    isReconnecting: false,
  };
}
