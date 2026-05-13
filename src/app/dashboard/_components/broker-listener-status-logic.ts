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

export function computeListenerFreshness(data: BrokerListenerStatusData): FreshnessInfo {
  const { listenerStatus, listenerLastEventAt, listenerLastHeartbeatAt, lastSyncAt } = data;

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
    const suffix = lastSignal ? ` · last event ${shortAgo(lastSignal)}` : "";
    return {
      label: `Reconnecting…${suffix}`,
      isLive: false,
      isStale: false,
      isReconnecting: true,
    };
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
