"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { buildAccountRulesUrl } from "@/app/rules/_components/rule-scope-utils";

type Props = {
  accountId: string;
  hasDefaultRules: boolean;
  defaultRulesSummary: string | null;
};

export function SetupOptions({ accountId, hasDefaultRules, defaultRulesSummary }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"default" | "ignore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function activate(status: "protected" | "ignored") {
    const key = status === "protected" ? "default" : "ignore";
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: status }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not update account.");
        setBusy(null);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Option A: Use default rules */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-stone-950">Use default trading plan</p>
              {hasDefaultRules && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  Configured
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-stone-600">
              {hasDefaultRules
                ? "Apply your existing default plan to this account and start monitoring immediately."
                : "Activate this account without account-specific rules. Set a default plan from Settings later."}
            </p>
            {defaultRulesSummary && (
              <p className="mt-2 text-xs text-stone-500">{defaultRulesSummary}</p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => activate("protected")}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-60"
          >
            {busy === "default" ? "Activating…" : "Use default plan"}
          </button>
        </div>
      </div>

      {/* Option B: Account-specific rules */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5">
        <p className="text-sm font-semibold text-stone-950">Set account-specific rules</p>
        <p className="mt-1 text-sm text-stone-600">
          Configure custom limits for this account — different drawdown caps, trade counts, or
          prop firm thresholds.
        </p>
        <div className="mt-4">
          <Link
            href={buildAccountRulesUrl(accountId)}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-300 px-5 text-sm font-medium text-stone-900 transition hover:border-stone-950"
          >
            Configure rules for this account
          </Link>
        </div>
      </div>

      {/* Option C: Ignore */}
      <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
        <p className="text-sm font-semibold text-stone-700">Ignore this account</p>
        <p className="mt-1 text-sm text-stone-500">
          Hide this account from Guardrail. No sync, no rule evaluation. You can reconfigure it
          later from Broker Connections.
        </p>
        <div className="mt-4">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => activate("ignored")}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 px-5 text-sm font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950 disabled:pointer-events-none disabled:opacity-60"
          >
            {busy === "ignore" ? "Saving…" : "Ignore this account"}
          </button>
        </div>
      </div>
    </div>
  );
}
