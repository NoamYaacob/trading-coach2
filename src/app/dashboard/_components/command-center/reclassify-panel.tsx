"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ReclassifiableAccount } from "./types";

type Props = {
  accounts: ReclassifiableAccount[];
};

export function ReclassifyPanel({ accounts }: Props) {
  if (accounts.length === 0) return null;

  return (
    <section
      aria-label="Classification update available"
      className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:p-5"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">
          Classification update available
        </p>
        <p className="mt-1 text-sm text-sky-900">
          {accounts.length === 1
            ? "One account can be moved to its correct firm group based on your other accounts on the same connection."
            : `${accounts.length} accounts can be moved to their correct firm groups based on sibling accounts on the same connection.`}
        </p>
      </header>
      <ul className="mt-4 grid gap-2">
        {accounts.map((a) => (
          <li key={a.id}>
            <ReclassifyRow account={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReclassifyRow({ account }: { account: ReclassifiableAccount }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "busy" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);

  if (mode === "dismissed") return null;

  const typeLabel = account.inheritedAccountType
    ? account.inheritedAccountType.charAt(0).toUpperCase() + account.inheritedAccountType.slice(1)
    : null;

  async function handleFix() {
    setMode("busy");
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/classification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propFirm: account.inheritedPropFirm,
          accountType: account.inheritedAccountType ?? "evaluation",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        const msg = data.error === "already_classified"
          ? "This account already has a classification set."
          : (data.error ?? "Could not update classification.");
        setError(msg);
        setMode("idle");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setMode("idle");
    }
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-950">{account.label}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">
            Move to:{" "}
            <span className="font-medium text-stone-700">
              {account.inheritedPropFirm}
              {typeLabel ? ` · ${typeLabel}` : ""}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={mode === "busy"}
            onClick={handleFix}
            className="inline-flex h-8 items-center rounded-full bg-sky-700 px-3.5 text-xs font-medium text-white transition hover:bg-sky-800 disabled:pointer-events-none disabled:opacity-60"
          >
            {mode === "busy" ? "Fixing…" : `Move to ${account.inheritedPropFirm}`}
          </button>
          <button
            type="button"
            disabled={mode === "busy"}
            onClick={() => setMode("dismissed")}
            className="inline-flex h-8 items-center rounded-full border border-stone-200 px-3.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950 disabled:pointer-events-none disabled:opacity-60"
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-red-700">{error}</p>
      )}
    </div>
  );
}
