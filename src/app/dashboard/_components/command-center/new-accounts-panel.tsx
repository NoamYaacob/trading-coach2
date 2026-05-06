"use client";

import Link from "next/link";

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
            ? `Guardrail found a new ${platformName} account. Choose which rules should apply before it is monitored.`
            : `Guardrail found ${accounts.length} new ${platformName} accounts. Choose which rules should apply before they are monitored.`}
        </p>
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3">
      <div>
        <p className="text-sm font-medium text-stone-950">{account.label}</p>
        <p className="mt-0.5 text-[11px] text-stone-500">
          {account.platformLabel}
          <span aria-hidden> · </span>
          {account.accountTypeLabel}
          {account.externalAccountId ? ` · ID ${account.externalAccountId}` : ""}
        </p>
      </div>
      <Link
        href={`/accounts/${account.id}/setup`}
        className="inline-flex h-8 items-center rounded-full bg-stone-950 px-4 text-xs font-medium text-white transition hover:bg-stone-800"
      >
        Choose rules
      </Link>
    </div>
  );
}
