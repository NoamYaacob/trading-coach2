"use client";

import { useState } from "react";

function shortDate(date: Date): string {
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
 * Triggers a server-side Tradovate sync for one account or a whole connection.
 * Pass `accountId` for a single account, `connectionId` to sync all accounts
 * linked to a BrokerConnection. Exactly one must be provided.
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
        const msg = data.message ?? data.error ?? "Sync failed. Please try again.";
        setError(
          msg.includes("TOKEN_EXPIRED") || msg.includes("expired")
            ? "Connection expired — re-authorize Tradovate to sync."
            : msg.includes("NO_ACCESS_TOKEN") || msg.includes("NO_TOKENS")
              ? "No tokens found — re-authorize Tradovate."
              : "Sync failed. Please try again.",
        );
      } else {
        if (data.lastSyncAt) setLastSync(new Date(data.lastSyncAt));
        // Reload to show updated balance / P&L data.
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
            Syncing…
          </>
        ) : (
          "Sync now"
        )}
      </button>
      {lastSync && !error && (
        <p className="text-[10px] text-stone-400">Last sync {shortDate(lastSync)}</p>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
