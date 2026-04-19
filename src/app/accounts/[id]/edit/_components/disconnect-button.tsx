"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { accountId: string };

export function DisconnectButton({ accountId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to remove account.");
        setRemoving(false);
        return;
      }
      router.push("/accounts");
    } catch {
      setError("Network error.");
      setRemoving(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex rounded-full border border-red-200 px-4 py-2 text-xs font-medium text-red-600 transition hover:border-red-400 hover:text-red-700"
      >
        Remove account
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-xs text-stone-600">
        This will deactivate the account and stop all monitoring. Continue?
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleRemove}
          disabled={removing}
          className="inline-flex rounded-full bg-red-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {removing ? "Removing…" : "Yes, remove"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={removing}
          className="inline-flex rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </div>
  );
}
