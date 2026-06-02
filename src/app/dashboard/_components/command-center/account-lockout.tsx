"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * Shared manual-lockout action — the single implementation of the
 * "Lock for this CME session" flow, reused by:
 *   - the per-account ⋯ menu item (AccountManageMenu), and
 *   - the always-visible "Lockout" pill on each dashboard account card.
 *
 * There is exactly ONE place that POSTs to /api/accounts/[id]/lockout
 * (useLockout) and exactly ONE confirmation modal (LockoutConfirmModal), so the
 * two entry points can never drift apart. No broker / Tradovate write paths are
 * touched — the route it calls only writes the internal lock.
 */

/** Owns the lock request state. The only caller of the lockout API. */
export function useLockout(accountId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lock = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/lockout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to lock account. Please try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [accountId, router]);

  return { busy, error, setError, lock };
}

/** The single danger confirmation modal for manual lockout. Portalled so no
 *  overflow/stacking context can clip it. */
export function LockoutConfirmModal({
  accountLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  accountLabel?: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      data-lock-confirm
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-dialog-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
          Danger
        </div>
        <h2 id="lock-dialog-title" className="mt-3 text-base font-semibold text-stone-900">
          Lock {accountLabel ?? "this account"} for the rest of this CME session?
        </h2>
        <p className="mt-2 text-sm text-stone-600">
          This account is locked or has rule activity today. To prevent bypassing
          Guardrail, removal will take effect at the next trading session reset.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          The manual lock clears automatically when the CME session resets at 17:00&nbsp;CT.
        </p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full border border-stone-200 px-4 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-full bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800 disabled:opacity-70"
          >
            {busy ? "Locking…" : "Yes, lock this account"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Always-visible "Lockout" pill for the dashboard account card. Self-contained
 * (serializable props only) so it can be rendered from the server component
 * dashboard/page.tsx. Uses the shared useLockout + LockoutConfirmModal.
 */
export function AccountLockoutButton({
  accountId,
  accountLabel,
  className,
}: {
  accountId: string;
  accountLabel?: string;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, setError, lock } = useLockout(accountId);

  return (
    <>
      <button
        type="button"
        aria-label={`Lock ${accountLabel ?? "account"} for this CME session`}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        className={
          className ??
          "inline-flex h-10 items-center gap-2 rounded-xl bg-red-500 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-600 active:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
        }
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5 shrink-0"
        >
          <path
            fillRule="evenodd"
            d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5V4.5a2 2 0 1 0-4 0V6h4Z"
            clipRule="evenodd"
          />
        </svg>
        Lockout
      </button>
      {confirming && (
        <LockoutConfirmModal
          accountLabel={accountLabel}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) {
              setConfirming(false);
              setError(null);
            }
          }}
          onConfirm={async () => {
            const ok = await lock();
            if (ok) setConfirming(false);
          }}
        />
      )}
    </>
  );
}
