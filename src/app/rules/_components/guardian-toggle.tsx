"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  initialEnabled: boolean;
};

export function GuardianToggle({ initialEnabled }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian/enable", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Unable to enable Guardian.");
      setEnabled(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to enable Guardian.");
    } finally {
      setLoading(false);
    }
  }

  if (enabled) {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="text-sm font-medium text-emerald-800">Guardian active — monitoring this session.</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-amber-900">Guardian is paused.</p>
          <p className="mt-0.5 text-xs text-stone-600">
            Your rules are saved but not monitoring the session.
          </p>
        </div>
        <button
          type="button"
          onClick={handleEnable}
          disabled={loading}
          className="inline-flex shrink-0 rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
        >
          {loading ? "Enabling..." : "Enable Guardian"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
