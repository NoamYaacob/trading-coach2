"use client";

import { useEffect, useState } from "react";

/** Returns a human-friendly relative time: "just now", "2m ago", "1h ago". */
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function RotateIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden
      className={`h-3 w-3 shrink-0 ${spinning ? "animate-spin" : ""}`}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 7a5.5 5.5 0 1 1-1.08-3.3" />
      <polyline points="12.5 2 12.5 5.5 9 5.5" />
    </svg>
  );
}

type Props = {
  accountId?: string;
  connectionId?: string;
  lastSyncAt: Date | null;
  /** "default" = standard bordered button (desktop/connection pages).
   *  "compact" = icon+text inline action with muted sync time (mobile cards). */
  variant?: "default" | "compact";
};

/**
 * Manual refresh button for a single account or a whole broker connection.
 * Pass `accountId` for a single account, `connectionId` to refresh all
 * accounts linked to a BrokerConnection. Exactly one must be provided.
 */
export function SyncButton({ accountId, connectionId, lastSyncAt, variant = "default" }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(lastSyncAt);
  // Relative time label is computed client-side only to prevent React
  // hydration mismatch (#418): Date.now() produces different values on
  // the server and client, so we never render it during SSR.
  const [relativeLabel, setRelativeLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!lastSync) return;
    const update = () => setRelativeLabel(relativeTime(lastSync));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [lastSync]);

  async function handleSync() {
    setSyncing(true);
    setError(null);

    const url = accountId
      ? `/api/accounts/${accountId}/sync`
      : `/api/brokers/${connectionId}/sync`;

    try {
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json()) as {
        ok?: boolean;
        lastSyncAt?: string;
        error?: string;
        message?: string;
      };

      if (!res.ok || !data.ok) {
        const msg = data.message ?? data.error ?? "Refresh failed. Please try again.";
        setError(
          msg === "reconnect_required" || res.status === 409
            ? "Connection expired — re-authorize Tradovate to refresh."
            : msg.includes("TOKEN_EXPIRED") || msg.includes("expired")
              ? "Connection expired — re-authorize Tradovate to refresh."
              : msg.includes("NO_ACCESS_TOKEN") || msg.includes("NO_TOKENS")
                ? "No tokens found — re-authorize Tradovate."
                : "Refresh failed. Please try again.",
        );
      } else {
        if (data.lastSyncAt) setLastSync(new Date(data.lastSyncAt));
        window.location.reload();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          aria-label="Refresh account data"
          className="inline-flex items-center gap-1 text-[11px] text-stone-400 transition hover:text-stone-700 disabled:opacity-40"
        >
          <RotateIcon spinning={syncing} />
          {syncing ? "Refreshing…" : "Refresh"}
        </button>
        {lastSync && !error && relativeLabel && (
          <span className="ml-auto text-[10px] text-stone-400">
            Synced {relativeLabel}
          </span>
        )}
        {error && (
          <span className="ml-auto text-[10px] text-red-500">{error}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        aria-label="Refresh account data"
        className="inline-flex items-center gap-1 text-[11px] text-stone-500 transition hover:text-stone-900 disabled:opacity-40"
      >
        <RotateIcon spinning={syncing} />
        {syncing ? "Refreshing…" : "Refresh data"}
      </button>
      {lastSync && !error && relativeLabel && (
        <p className="text-[10px] text-stone-400">Synced {relativeLabel}</p>
      )}
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
