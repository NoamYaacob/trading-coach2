"use client";

import { useState } from "react";

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

type Props = {
  accountId?: string;
  connectionId?: string;
  lastSyncAt: Date | null;
};

/**
 * Manual refresh button for a single account or a whole broker connection.
 * Pass `accountId` for a single account, `connectionId` to refresh all
 * accounts linked to a BrokerConnection. Exactly one must be provided.
 */
export function SyncButton({ accountId, connectionId, lastSyncAt }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(lastSyncAt);

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
          msg.includes("TOKEN_EXPIRED") || msg.includes("expired")
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

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleSync}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950 disabled:opacity-50"
      >
        {syncing ? (
          <>
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-stone-400 border-t-stone-700" />
            Refreshing…
          </>
        ) : (
          "Refresh"
        )}
      </button>
      {lastSync && !error && (
        <p className="text-[10px] text-stone-400">Synced {relativeTime(lastSync)}</p>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
