"use client";

import { useEffect, useRef, useState } from "react";

export type CopySourceAccount = {
  id: string;
  label: string;
  env?: string | null;
};

const ENV_LABEL: Record<string, string> = { live: "Live", demo: "Demo / Sim" };

type Status = "idle" | "loading" | "success" | "locked" | "error";

export function CopyRulesModal({
  targetAccountId,
  sourceAccounts,
  onClose,
  onSuccess,
}: {
  targetAccountId: string;
  sourceAccounts: CopySourceAccount[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(
    sourceAccounts.length === 1 ? sourceAccounts[0].id : "",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status !== "loading") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [status, onClose]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  async function handleCopy() {
    if (!selectedId) return;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/accounts/${targetAccountId}/rules/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceAccountId: selectedId }),
      });
      if (res.status === 423) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setStatus("locked");
        setErrorMessage(
          (data.message as string | undefined) ??
            "Rules are locked for this session — this account has already traded. Changes can be made after the session resets.",
        );
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setStatus("error");
        setErrorMessage(
          (data.error as string | undefined) === "source_has_no_rules"
            ? "The selected account has no Trading Plan to copy."
            : "Something went wrong. Please try again.",
        );
        return;
      }
      setStatus("success");
      setTimeout(() => {
        onSuccess();
      }, 800);
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  }

  const isLoading = status === "loading";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-rules-dialog-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isLoading ? undefined : onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        <h2
          id="copy-rules-dialog-title"
          className="text-base font-semibold tracking-tight text-stone-950"
        >
          Copy Trading Plan
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Copy all rules from another account into this one. Existing rules will be replaced.
        </p>

        {status === "success" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Trading Plan copied successfully.
          </div>
        ) : status === "locked" ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {errorMessage}
          </div>
        ) : status === "error" ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : sourceAccounts.length === 0 ? (
          <p className="mt-5 text-sm text-stone-500">
            No other Trading Plans to copy yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-2">
            {sourceAccounts.map((account) => {
              const envLabel = account.env ? (ENV_LABEL[account.env] ?? account.env) : null;
              return (
                <label
                  key={account.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                    selectedId === account.id
                      ? "border-stone-950 bg-stone-50"
                      : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="source-account"
                    value={account.id}
                    checked={selectedId === account.id}
                    onChange={() => setSelectedId(account.id)}
                    className="h-4 w-4 accent-stone-950"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-900">{account.label}</p>
                    {envLabel && (
                      <p className="mt-0.5 text-xs text-stone-500">{envLabel}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        )}

        {status !== "success" && (
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="inline-flex items-center justify-center rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            {sourceAccounts.length > 0 && status !== "locked" && status !== "error" && (
              <button
                type="button"
                onClick={handleCopy}
                disabled={!selectedId || isLoading}
                className="inline-flex items-center justify-center rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Copying…" : "Copy rules"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
