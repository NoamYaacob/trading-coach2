"use client";

import { useState } from "react";

import type { PendingDiscoveredAccount } from "./types";

type Props = {
  accounts: PendingDiscoveredAccount[];
  isLocked: boolean;
};

export function NewAccountsPanel({ accounts, isLocked }: Props) {
  if (accounts.length === 0) return null;
  return (
    <section
      aria-label="New accounts found"
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
            New accounts found
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {accounts.length === 1
              ? "A new broker account was discovered on your last sync. Choose how to handle it."
              : `${accounts.length} new broker accounts were discovered on your last sync. Choose how to handle each.`}
          </p>
        </div>
        {isLocked && (
          <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-amber-700">
            Session is locked — first-time choices apply immediately
          </span>
        )}
      </header>
      <div className="mt-4 grid gap-2">
        {accounts.map((a) => (
          <PendingAccountRow key={a.id} account={a} />
        ))}
      </div>
    </section>
  );
}

function PendingAccountRow({ account }: { account: PendingDiscoveredAccount }) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ status: string; effectiveDate?: string } | null>(null);

  async function choose(status: "protected" | "monitor_only" | "ignored") {
    setSubmitting(status);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: status }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        status?: string;
        effectiveDate?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not update protection.");
        return;
      }
      setDone({
        status: data.status ?? status,
        effectiveDate: data.effectiveDate,
      });
      window.location.reload();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-800">{account.label}</p>
        <p className="mt-1 text-xs text-emerald-700">
          Set to {done.status === "monitor_only" ? "Monitor only" : done.status}
          {done.effectiveDate ? ` (effective ${done.effectiveDate})` : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-stone-950">{account.label}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">
            {account.platformLabel}
            <span aria-hidden> · </span>
            {account.accountTypeLabel}
            {account.externalAccountId ? ` · ID ${account.externalAccountId}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={submitting != null}
            onClick={() => choose("protected")}
            className="rounded-full bg-stone-950 px-3 py-1 text-[11px] font-medium text-stone-50 transition hover:bg-stone-800 disabled:opacity-50"
          >
            {submitting === "protected" ? "Saving…" : "Protect"}
          </button>
          <button
            type="button"
            disabled={submitting != null}
            onClick={() => choose("monitor_only")}
            className="rounded-full border border-stone-300 px-3 py-1 text-[11px] font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950 disabled:opacity-50"
          >
            {submitting === "monitor_only" ? "Saving…" : "Monitor only"}
          </button>
          <button
            type="button"
            disabled={submitting != null}
            onClick={() => choose("ignored")}
            className="rounded-full border border-stone-200 px-3 py-1 text-[11px] font-medium text-stone-500 transition hover:border-stone-300 hover:text-stone-700 disabled:opacity-50"
          >
            {submitting === "ignored" ? "Saving…" : "Ignore"}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
