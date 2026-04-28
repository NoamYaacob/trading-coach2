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
      <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white" aria-hidden>
          ✓
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900">Protection active</p>
          <p className="mt-0.5 text-xs text-emerald-800/80">Guardrail is monitoring this session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-amber-900">Protection is paused</p>
            <p className="mt-0.5 text-xs text-stone-600">
              Your rules are saved but not monitoring the session.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleEnable}
          disabled={loading}
          className="inline-flex shrink-0 rounded-full bg-stone-950 px-4 py-2 text-xs font-semibold text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
        >
          {loading ? "Enabling..." : "Enable protection"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
