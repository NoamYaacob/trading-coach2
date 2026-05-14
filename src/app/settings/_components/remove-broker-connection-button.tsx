"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "Remove connection" button for orphaned expired BrokerConnections
 * (those with no linked accounts). Calls DELETE /api/broker-connections/:id.
 */
export function RemoveBrokerConnectionButton({
  connectionId,
  redirectTo = "/settings",
}: {
  connectionId: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/broker-connections/${connectionId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Failed to remove.");
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove. Please try again.");
      setRemoving(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {error && <p className="text-xs text-red-700">{error}</p>}
        <p className="text-xs text-stone-500">Remove this connection permanently?</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={removing}
            className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={removing}
            className="inline-flex items-center rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-70"
          >
            {removing ? "Removing…" : "Remove connection"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-300 hover:text-red-700"
    >
      Remove connection
    </button>
  );
}
