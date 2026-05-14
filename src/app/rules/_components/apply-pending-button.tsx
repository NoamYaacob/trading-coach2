"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ApplyPendingButton({ url }: { url: string }) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApply() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json()) as {
        promoted?: number;
        skipped?: number;
        skipReason?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to apply pending rules.");
        return;
      }
      if (data.promoted && data.promoted > 0) {
        router.refresh();
      } else {
        setError(`Could not apply yet${data.skipReason ? ` (${data.skipReason})` : ""}. Try again at the next safe window.`);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleApply}
        disabled={applying}
        className="inline-flex items-center justify-center rounded-full bg-amber-800 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-amber-900 disabled:opacity-50"
      >
        {applying ? "Applying…" : "Apply pending now"}
      </button>
      {error && <p className="mt-1 text-[10px] text-red-700">{error}</p>}
    </div>
  );
}
