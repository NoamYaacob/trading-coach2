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

/** User-facing broker-lock outcome surfaced after a successful internal lock. */
export type BrokerLockOutcome = {
  status: "active" | "failed" | "unavailable";
  message: string;
};

/** True when the connection is read-only and the broker write will be skipped. */
function isReadOnlyConnection(
  connectionStatus?: string | null,
  permissionLevel?: string | null,
): boolean {
  return permissionLevel === "read_only" || connectionStatus === "connected_readonly";
}

/** Owns the lock request state. The only caller of the lockout API. */
export function useLockout(accountId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set after a successful internal lock to report the broker-side outcome. */
  const [brokerLock, setBrokerLock] = useState<BrokerLockOutcome | null>(null);

  const lock = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setBrokerLock(null);
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
      const data = (await res.json()) as { brokerLock?: BrokerLockOutcome };
      // The internal Guardrail lock succeeded. Surface the broker-side result
      // (the broker half may have failed/been unavailable without affecting
      // the internal lock).
      setBrokerLock(
        data.brokerLock ?? { status: "unavailable", message: "Broker lock was not attempted." },
      );
      router.refresh();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [accountId, router]);

  const reset = useCallback(() => {
    setError(null);
    setBrokerLock(null);
  }, []);

  return { busy, error, setError, brokerLock, lock, reset };
}

/** The single danger confirmation modal for manual lockout. Portalled so no
 *  overflow/stacking context can clip it. */
export function LockoutConfirmModal({
  accountLabel,
  busy,
  error,
  brokerLock,
  isReadOnly,
  onConfirm,
  onCancel,
  onDone,
}: {
  accountLabel?: string;
  busy: boolean;
  error: string | null;
  /** When set, the lock succeeded — the modal switches to the result view. */
  brokerLock?: BrokerLockOutcome | null;
  /**
   * When true the connection is read-only; the broker write will be skipped.
   * Shows a pre-warning in the confirm view so the user understands the
   * Guardrail lock will not prevent trading in Tradovate.
   */
  isReadOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Closes the result view. Defaults to onCancel when omitted. */
  onDone?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) (brokerLock ? (onDone ?? onCancel) : onCancel)();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel, onDone, brokerLock]);

  if (typeof document === "undefined") return null;

  // ── Result view — shown after the internal lock has been applied ───────────
  if (brokerLock) {
    const close = onDone ?? onCancel;
    const brokerActive = brokerLock.status === "active";
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
        data-lock-result
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lock-result-title"
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2 id="lock-result-title" className="text-base font-semibold text-stone-900">
            {accountLabel ?? "Account"} locked
          </h2>
          {/* The internal Guardrail lock is always active on success. */}
          <p className="mt-3 flex items-start gap-2 text-sm text-emerald-700">
            <span aria-hidden="true">✓</span>
            <span>Locked in Guardrail for the rest of this CME session.</span>
          </p>
          {/* The broker half may or may not have succeeded. */}
          {brokerActive ? (
            <p className="mt-2 flex items-start gap-2 text-sm text-emerald-700">
              <span aria-hidden="true">✓</span>
              <span>Broker lock active at Tradovate.</span>
            </p>
          ) : (
            <p className="mt-2 flex items-start gap-2 text-sm text-amber-700">
              <span aria-hidden="true">⚠</span>
              <span>
                {brokerLock.status === "failed"
                  ? "Broker lock failed — the Guardrail lock is still active."
                  : "Broker lock unavailable — the Guardrail lock is still active."}
              </span>
            </p>
          )}
          {/* When broker lock did not apply, surface an explicit trading-still-possible warning. */}
          {!brokerActive && (
            <p className="mt-2 text-sm font-medium text-amber-800" data-broker-unavailable-trading-warning>
              You may still be able to place trades in Tradovate.
            </p>
          )}
          <p className="mt-2 text-xs text-stone-500">{brokerLock.message}</p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={close}
              className="inline-flex h-9 items-center rounded-full bg-stone-900 px-4 text-sm font-medium text-white transition hover:bg-stone-950"
            >
              Done
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Confirm view ───────────────────────────────────────────────────────────
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
          This locks the account in Guardrail and attempts to lock it at your broker
          (Tradovate) so no new opening orders can be placed for the rest of this CME
          session. Existing positions are not closed.
        </p>
        {/* Read-only pre-warning — shown before the user confirms when the
            broker write will definitely be skipped. The Guardrail lock still
            applies, but the user must know they can still trade in Tradovate. */}
        {isReadOnly && (
          <div
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            data-readonly-broker-warning
          >
            <strong>Read-only connection.</strong> Guardrail will lock the dashboard, but cannot write to Tradovate — you may still be able to place trades there.
          </div>
        )}
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
  connectionStatus,
  permissionLevel,
  className,
}: {
  accountId: string;
  accountLabel?: string;
  /** Used to derive the pre-warning when the connection is read-only. */
  connectionStatus?: string | null;
  /** Used to derive the pre-warning when the permission level is read_only. */
  permissionLevel?: string | null;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, setError, brokerLock, lock, reset } = useLockout(accountId);
  const readOnly = isReadOnlyConnection(connectionStatus, permissionLevel);

  return (
    <>
      <button
        type="button"
        aria-label={`Lock ${accountLabel ?? "account"} for this CME session`}
        onClick={() => {
          reset();
          setConfirming(true);
        }}
        className={
          className ??
          "inline-flex h-8 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 text-[11px] font-semibold text-red-700 transition active:scale-[0.97] active:bg-red-100 hover:border-red-300 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1"
        }
      >
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3 w-3 shrink-0"
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
          brokerLock={brokerLock}
          isReadOnly={readOnly}
          onCancel={() => {
            if (!busy) {
              setConfirming(false);
              reset();
            }
          }}
          onConfirm={() => {
            // Keep the modal open on success so it can switch to the result
            // view (brokerLock); only the internal-lock failure path closes via
            // the error message.
            void lock();
          }}
          onDone={() => {
            setConfirming(false);
            reset();
          }}
        />
      )}
    </>
  );
}
