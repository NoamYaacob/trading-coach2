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

  async function handleDisable() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian/disable", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Unable to disable Guardian.");
      setEnabled(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disable Guardian.");
    } finally {
      setLoading(false);
    }
  }

  if (enabled) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white" aria-hidden>
              ✓
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Guardian is active</p>
              <p className="mt-0.5 text-xs text-emerald-800/80">Guardrail is monitoring each session against your rules.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={loading}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-white px-5 text-sm font-medium text-emerald-900 transition hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Turning off..." : "Turn off Guardian"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-amber-900">Guardian is off</p>
            <p className="mt-0.5 text-xs text-stone-600">
              Your rules are saved but not monitoring the session.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleEnable}
          disabled={loading}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
        >
          {loading ? "Enabling..." : "Turn on Guardian"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
