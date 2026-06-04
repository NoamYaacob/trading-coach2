"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { isLockoutConfirmed, LOCKOUT_CONFIRM_WORD } from "./account-lockout-logic";

export { isLockoutConfirmed, LOCKOUT_CONFIRM_WORD } from "./account-lockout-logic";

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

/** Cancel-orders step outcome from the emergency lockout. */
export type CancelOrdersOutcome =
  | { ran: true; dryRun: boolean; attempted: number; succeeded: number; failed: number }
  | { ran: false; reason: string };

/** Flatten-positions step outcome from the emergency lockout. */
export type FlattenOutcome =
  | { ran: true; dryRun: boolean; status: string; message: string }
  | { ran: false; reason: string };

/** Full emergency-lockout result surfaced after the internal lock applies. */
export type EmergencyLockoutResult = {
  orderActionsEnabled: boolean;
  cancelOrders: CancelOrdersOutcome;
  flattenPositions: FlattenOutcome;
  brokerLock: BrokerLockOutcome;
};

/** Owns the lock request state. The only caller of the lockout API. */
export function useLockout(accountId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set after a successful internal lock to report the full lockout outcome. */
  const [result, setResult] = useState<EmergencyLockoutResult | null>(null);

  const lock = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setResult(null);
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
      const data = (await res.json()) as Partial<EmergencyLockoutResult>;
      // The internal Guardrail lock succeeded. Surface every step's result —
      // the broker/order halves may have failed or been skipped without
      // affecting the (already-committed) internal lock.
      setResult({
        orderActionsEnabled: data.orderActionsEnabled ?? false,
        cancelOrders: data.cancelOrders ?? { ran: false, reason: "No cancel result returned." },
        flattenPositions:
          data.flattenPositions ?? { ran: false, reason: "No flatten result returned." },
        brokerLock:
          data.brokerLock ?? { status: "unavailable", message: "Broker lock was not attempted." },
      });
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
    setResult(null);
  }, []);

  return { busy, error, setError, result, lock, reset };
}

/** One status line in the result view. */
function ResultLine({
  ok,
  warn,
  children,
}: {
  ok?: boolean;
  warn?: boolean;
  children: ReactNode;
}) {
  const tone = ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-stone-600";
  const glyph = ok ? "✓" : warn ? "⚠" : "•";
  return (
    <p className={`mt-2 flex items-start gap-2 text-sm ${tone}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{children}</span>
    </p>
  );
}

/** The single danger confirmation modal for emergency lockout. Portalled so no
 *  overflow/stacking context can clip it. */
export function LockoutConfirmModal({
  accountLabel,
  busy,
  error,
  result,
  onConfirm,
  onCancel,
  onDone,
}: {
  accountLabel?: string;
  busy: boolean;
  error: string | null;
  /** When set, the lock succeeded — the modal switches to the result view. */
  result?: EmergencyLockoutResult | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Closes the result view. Defaults to onCancel when omitted. */
  onDone?: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = isLockoutConfirmed(typed);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) (result ? (onDone ?? onCancel) : onCancel)();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel, onDone, result]);

  if (typeof document === "undefined") return null;

  // ── Result view — shown after the internal lock has been applied ───────────
  if (result) {
    const close = onDone ?? onCancel;
    const { cancelOrders, flattenPositions, brokerLock, orderActionsEnabled } = result;
    const brokerActive = brokerLock.status === "active";

    // Cancel-orders line.
    let cancelLine: ReactNode;
    if (!cancelOrders.ran) {
      cancelLine = (
        <ResultLine warn>Cancel orders skipped — {cancelOrders.reason}</ResultLine>
      );
    } else if (cancelOrders.dryRun) {
      cancelLine = (
        <ResultLine warn>
          Cancel orders NOT sent (dry-run
          {orderActionsEnabled ? "" : " — order actions disabled on server"}):{" "}
          {cancelOrders.attempted} working order
          {cancelOrders.attempted === 1 ? "" : "s"} would have been cancelled.
        </ResultLine>
      );
    } else {
      const allOk = cancelOrders.failed === 0;
      cancelLine = (
        <ResultLine ok={allOk} warn={!allOk}>
          Cancelled {cancelOrders.succeeded}/{cancelOrders.attempted} working order
          {cancelOrders.attempted === 1 ? "" : "s"}
          {cancelOrders.failed > 0 ? ` (${cancelOrders.failed} failed)` : ""}.
        </ResultLine>
      );
    }

    // Flatten line.
    let flattenLine: ReactNode;
    if (!flattenPositions.ran) {
      flattenLine = (
        <ResultLine warn>Flatten skipped — {flattenPositions.reason}</ResultLine>
      );
    } else if (flattenPositions.dryRun || flattenPositions.status === "dry_run") {
      flattenLine = (
        <ResultLine warn>
          Positions NOT closed (dry-run
          {orderActionsEnabled ? "" : " — order actions disabled on server"}).
        </ResultLine>
      );
    } else {
      const flat =
        flattenPositions.status === "flattened" || flattenPositions.status === "not_needed";
      flattenLine = (
        <ResultLine ok={flat} warn={!flat}>
          {flattenPositions.status === "not_needed"
            ? "No open positions to close."
            : flattenPositions.status === "flattened"
              ? "Open positions closed (confirmed flat)."
              : `Flatten ${flattenPositions.status}: ${flattenPositions.message}`}
        </ResultLine>
      );
    }

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
          {cancelLine}
          {flattenLine}
          {/* The internal Guardrail lock is always active on success. */}
          <ResultLine ok>Locked in Guardrail for the rest of this CME session.</ResultLine>
          {/* The broker half may or may not have succeeded. */}
          {brokerActive ? (
            <ResultLine ok>Broker lock active at Tradovate.</ResultLine>
          ) : (
            <ResultLine warn>
              {brokerLock.status === "failed"
                ? "Broker lock failed — the Guardrail lock is still active."
                : "Broker lock unavailable — the Guardrail lock is still active."}
            </ResultLine>
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
          Emergency lockout
        </div>
        <h2 id="lock-dialog-title" className="mt-3 text-base font-semibold text-stone-900">
          Emergency lockout for {accountLabel ?? "this account"}?
        </h2>
        <p className="mt-2 text-sm font-medium text-stone-800">
          This will cancel working orders, close open positions, and lock this account.
        </p>
        <p className="mt-2 text-sm text-stone-600">
          Working orders are cancelled and open positions are closed at your broker
          (Tradovate), then the account is locked in Guardrail and at the broker so no
          new opening orders can be placed for the rest of this CME session. This affects{" "}
          <span className="font-medium">only this account</span>.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          The Guardrail lock clears automatically when the CME session resets at
          17:00&nbsp;CT.
        </p>
        <label className="mt-4 block text-sm font-medium text-stone-700">
          Type <span className="font-semibold text-red-700">LOCKOUT</span> to confirm
          <input
            type="text"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            aria-label="Type LOCKOUT to confirm"
            className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-400 disabled:opacity-50"
            placeholder="LOCKOUT"
          />
        </label>
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
            disabled={busy || !confirmed}
            className="inline-flex h-9 items-center rounded-full bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800 disabled:opacity-50"
          >
            {busy ? "Locking…" : "Emergency lockout"}
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
  const { busy, error, result, lock, reset } = useLockout(accountId);

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
          "inline-flex h-7 items-center gap-1.5 rounded-full border border-[#efc7bd] bg-[#fff1ee] px-3 text-xs font-medium text-[#9f321f] transition hover:bg-red-100 active:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-1"
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
          result={result}
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
