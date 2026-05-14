"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { accountId: string };

export function DisconnectButton({ accountId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleanupWarning, setCleanupWarning] = useState<string | null>(null);

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    setCleanupWarning(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        cleanupWarning?: string | null;
      };
      if (!res.ok) {
        setError(data.message ?? data.error ?? "Failed to disconnect account.");
        setRemoving(false);
        return;
      }
      if (data.cleanupWarning) {
        setCleanupWarning(data.cleanupWarning);
        setConfirming(false);
        setRemoving(false);
      } else {
        router.push("/accounts");
      }
    } catch {
      setError("Network error.");
      setRemoving(false);
    }
  }

  if (cleanupWarning) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="w-full text-xs text-amber-700">{cleanupWarning}</p>
        <button
          type="button"
          onClick={() => router.push("/accounts")}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-white transition hover:bg-stone-800"
        >
          Got it
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition hover:border-red-400 hover:text-red-700"
      >
        Disconnect account
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-xs text-stone-600">
        This deactivates the account and stops all monitoring. Continue?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-red-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {removing ? "Disconnecting…" : "Yes, disconnect"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={removing}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
