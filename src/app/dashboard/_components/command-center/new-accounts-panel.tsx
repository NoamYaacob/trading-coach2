"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PendingDiscoveredAccount } from "./types";

type Props = {
  accounts: PendingDiscoveredAccount[];
};

export function NewAccountsPanel({ accounts }: Props) {
  if (accounts.length === 0) return null;

  const firstPlatformLabel = accounts[0]!.platformLabel;
  const platformName = accounts.every((a) => a.platformLabel === firstPlatformLabel)
    ? firstPlatformLabel
    : "broker";

  return (
    <section
      aria-label="New broker account detected"
      className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
          {accounts.length === 1 ? "New broker account detected" : "New broker accounts detected"}
        </p>
        <p className="mt-1 text-sm text-amber-900">
          {accounts.length === 1
            ? `We found a new ${platformName} account on your connected broker login.`
            : `We found ${accounts.length} new ${platformName} accounts on your connected broker logins.`}
        </p>
      </header>
      <ul className="mt-4 grid gap-2">
        {accounts.map((a) => (
          <li key={a.id}>
            <PendingAccountRow account={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function buildMetaParts(account: PendingDiscoveredAccount): string[] {
  const parts: string[] = [];
  parts.push(account.platformLabel);
  if (account.envLabel) parts.push(account.envLabel);
  parts.push(account.propFirm?.trim() ? account.propFirm.trim() : "Unassigned");
  if (account.accountTypeLabel) parts.push(account.accountTypeLabel);
  if (account.externalAccountId) parts.push(`ID ${account.externalAccountId}`);
  return parts;
}

function PendingAccountRow({ account }: { account: PendingDiscoveredAccount }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"add" | "ignore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Add to Guardrail" sets protectionStatus="protected". This is the same
  // transition the /accounts/[id]/setup "Use default plan" path uses, so the
  // account inherits whatever default Trading Plan the user has. Per-connection
  // permissionLevel still gates whether broker writes are issued — adding here
  // never elevates broker permissions beyond what the OAuth grant carries.
  async function activate(status: "protected" | "ignored") {
    const key = status === "protected" ? "add" : "ignore";
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${account.id}/protection`, {
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
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setBusy(null);
    }
  }

  const metaParts = buildMetaParts(account);

  return (
    <div className="rounded-xl border border-amber-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-950">{account.label}</p>
          <p className="mt-0.5 truncate text-[11px] text-stone-500">
            {metaParts.join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy != null}
            onClick={() => activate("protected")}
            className="inline-flex h-8 items-center rounded-full bg-stone-950 px-3.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-60"
          >
            {busy === "add" ? "Adding…" : "Add to Guardrail"}
          </button>
          <button
            type="button"
            disabled={busy != null}
            onClick={() => activate("ignored")}
            className="inline-flex h-8 items-center rounded-full border border-stone-200 px-3.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950 disabled:pointer-events-none disabled:opacity-60"
          >
            {busy === "ignore" ? "Saving…" : "Ignore for now"}
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-red-700">
          <span>{error}</span>
          <Link
            href={`/accounts/${account.id}/setup`}
            className="underline-offset-2 hover:underline"
          >
            Open setup
          </Link>
        </p>
      )}
    </div>
  );
}
