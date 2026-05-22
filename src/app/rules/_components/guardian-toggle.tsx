"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  initialEnabled: boolean;
  /** When at least one of the user's accounts has Tradovate full_access permission,
   *  the active card upgrades its copy to mention broker risk settings. */
  hasFullAccessAccount?: boolean;
};

export function GuardianToggle({ initialEnabled, hasFullAccessAccount = false }: Props) {
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
    const secondary = hasFullAccessAccount
      ? "Monitoring each session · Broker enforcement not active"
      : "Monitoring each session against your rules";

    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs text-emerald-900">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <span className="min-w-0 truncate">
          <span className="font-semibold">Guardian active</span>
          <span className="text-emerald-800/70"> · {secondary}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-amber-900">Guardian is off</p>
            <p className="mt-0.5 text-xs text-stone-600">
              Guardian is the rule engine that watches your account during the session. Your rules
              are saved but not currently active.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-pressed={false}
          onClick={handleEnable}
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500 sm:w-auto sm:shrink-0"
        >
          {loading ? "Enabling..." : "Turn on Guardian"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
