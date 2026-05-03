"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type DiscoveredAccount = {
  externalAccountId: string;
  name: string;
  accountType: string;
  active: boolean;
};

type AccountRow = {
  externalAccountId: string;
  name: string;
  active: boolean;
  selected: boolean;
  label: string;
  accountType: "evaluation" | "funded" | "personal" | "demo";
  propFirm: string;
};

const ACCOUNT_TYPE_OPTIONS: { value: AccountRow["accountType"]; label: string }[] = [
  { value: "evaluation", label: "Evaluation" },
  { value: "funded", label: "Funded" },
  { value: "personal", label: "Personal" },
  { value: "demo", label: "Demo / Sim" },
];

function guessAccountType(
  brokerType: string,
  env: string,
  accountSource: string,
): AccountRow["accountType"] {
  if (env === "demo" && accountSource === "demo") return "demo";
  if (env === "demo") return "evaluation";
  const t = brokerType.toLowerCase();
  if (t.includes("fund")) return "funded";
  if (t.includes("eval") || t.includes("challenge")) return "evaluation";
  if (accountSource === "personal") return "personal";
  return "evaluation";
}

type Props = {
  setupId: string;
  env: string;
  accountSource: string;
  propFirmName: string | null;
  displayName: string | null;
  discoveredAccounts: DiscoveredAccount[];
};

export function SelectAccountsForm({
  setupId,
  env,
  accountSource,
  propFirmName,
  displayName,
  discoveredAccounts,
}: Props) {
  const router = useRouter();

  const [rows, setRows] = useState<AccountRow[]>(() =>
    discoveredAccounts.map((a) => ({
      externalAccountId: a.externalAccountId,
      name: a.name,
      active: a.active,
      selected: a.active,
      label: displayName
        ? `${displayName} — ${a.name}`
        : a.name,
      accountType: guessAccountType(a.accountType, env, accountSource),
      propFirm: propFirmName ?? "",
    })),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<AccountRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const selectedCount = rows.filter((r) => r.selected).length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const selected = rows.filter((r) => r.selected);
    if (selected.length === 0) {
      setError("Select at least one account to import.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/tradovate/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupId,
          selectedAccounts: selected.map((r) => ({
            externalAccountId: r.externalAccountId,
            label: r.label.trim() || r.name,
            accountType: r.accountType,
            propFirm: r.propFirm.trim() || null,
          })),
        }),
      });

      const data = (await res.json()) as { ok?: boolean; redirectTo?: string; error?: string };

      if (!res.ok) {
        setError(
          data.error === "setup_not_found" || data.error === "setup_expired"
            ? "Setup session expired. Please start the connection again."
            : "Could not save accounts. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      router.push(data.redirectTo ?? "/accounts");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleRetrySync() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch("/api/auth/tradovate/retry-account-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupId }),
      });
      const data = (await res.json()) as { ok?: boolean; count?: number; error?: string };
      if (!res.ok) {
        setRetryError("Could not sync accounts. Please try again or start a new connection.");
        return;
      }
      if (!data.ok || (data.count ?? 0) === 0) {
        setRetryError(
          "Still no accounts found. Check that the correct environment (Demo or Live) is active for your Tradovate account.",
        );
        return;
      }
      // Accounts found — reload to get the updated server-rendered list.
      window.location.reload();
    } catch {
      setRetryError("Network error. Please try again.");
    } finally {
      setRetrying(false);
    }
  }

  if (discoveredAccounts.length === 0) {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5">
          <p className="text-sm font-semibold text-amber-800">Account list not available yet</p>
          <p className="mt-1 text-sm text-amber-700">
            We connected Tradovate, but could not read your account list. This can happen if the
            authorization hasn&rsquo;t fully synced yet, or if the{" "}
            {env === "demo" ? "demo" : "live"} environment isn&rsquo;t activated for your account.
          </p>
          {retryError && (
            <p className="mt-3 text-xs font-medium text-red-700">{retryError}</p>
          )}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={handleRetrySync}
            disabled={retrying}
            className="inline-flex items-center justify-center rounded-full bg-stone-950 px-6 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:opacity-50"
          >
            {retrying ? "Syncing…" : "Retry account sync"}
          </button>
          <Link
            href="/accounts"
            className="inline-flex items-center justify-center rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-900 transition hover:border-stone-950"
          >
            Back to accounts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      <div className="grid gap-3">
        {rows.map((row, idx) => (
          <div
            key={row.externalAccountId}
            className={`rounded-2xl border p-5 transition ${
              row.selected
                ? "border-stone-300 bg-white shadow-sm"
                : "border-stone-200 bg-stone-50 opacity-60"
            }`}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id={`account-${idx}`}
                  checked={row.selected}
                  onChange={(e) => updateRow(idx, { selected: e.target.checked })}
                  className="h-4 w-4 rounded accent-stone-950"
                />
                <label htmlFor={`account-${idx}`} className="cursor-pointer">
                  <span className="block text-sm font-semibold text-stone-950">{row.name}</span>
                  <span className="text-xs text-stone-500">ID {row.externalAccountId}</span>
                </label>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  row.active
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-stone-100 text-stone-500"
                }`}
              >
                {row.active ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Editable fields — only visible when selected */}
            {row.selected && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-stone-700">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateRow(idx, { label: e.target.value })}
                    maxLength={80}
                    className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-950 focus:border-stone-950 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-stone-700">
                    Account type
                  </label>
                  <select
                    value={row.accountType}
                    onChange={(e) =>
                      updateRow(idx, { accountType: e.target.value as AccountRow["accountType"] })
                    }
                    className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-950 focus:border-stone-950 focus:outline-none"
                  >
                    {ACCOUNT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {accountSource === "prop_firm" && (
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-xs font-medium text-stone-700">
                      Prop firm <span className="text-stone-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={row.propFirm}
                      onChange={(e) => updateRow(idx, { propFirm: e.target.value })}
                      maxLength={80}
                      placeholder={propFirmName ?? "Firm name"}
                      className="w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2 text-sm text-stone-950 focus:border-stone-950 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="rounded-2xl border border-stone-100 bg-stone-50 px-5 py-4 text-xs text-stone-500">
        Read-only connected — Guardrail can read account data and evaluate your rules. It cannot place or modify orders, and broker-side enforcement is not active.
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={submitting || selectedCount === 0}
          className="inline-flex items-center justify-center rounded-full bg-stone-950 px-7 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:opacity-50"
        >
          {submitting
            ? "Importing…"
            : `Import ${selectedCount} account${selectedCount === 1 ? "" : "s"}`}
        </button>
        <Link
          href="/accounts"
          className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
