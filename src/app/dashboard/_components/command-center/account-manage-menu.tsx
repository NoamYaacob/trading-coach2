"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { deriveOpenHref, deriveRulesHref, deriveTradesHref } from "./data-helpers";
import { buildArchiveRequest, parseArchiveResponse } from "./archive-account-helpers";

/**
 * AccountManageMenu — a compact per-account actions dropdown for the Dashboard.
 *
 * Holds ONLY account-level actions (rules, trades, account detail, lock for the
 * CME session, remove from Guardrail). Service-level / broker connection
 * management lives in Settings and is intentionally absent here. No broker
 * technical diagnostics are exposed.
 *
 * The dropdown is rendered through a portal to document.body (fixed positioning
 * anchored to the trigger) so it stays fully visible even when the trigger lives
 * inside an `overflow:auto`/`hidden` container — e.g. the Dashboard account
 * strip, which is `overflowX:auto` and would otherwise clip an absolutely
 * positioned dropdown. This mirrors the existing ConfirmDialog portal pattern.
 *
 * "Remove from Guardrail" reuses the existing guarded archive flow
 * (buildArchiveRequest → POST /api/accounts/:id/protection { archived }). That
 * endpoint enforces the scheduled-removal guard: when the account is locked or
 * has rule activity today, the archive is deferred (applied=false) rather than
 * applied immediately, so this menu can never be used to bypass a lock.
 * Historical trade / rule / audit data is never deleted.
 */
export function AccountManageMenu({
  accountId,
  accountLabel,
  canRemove = true,
  canLock = true,
  buttonClassName,
  triggerLabel = "Manage",
  align = "right",
}: {
  accountId: string;
  accountLabel?: string;
  /** When false, the "Remove from Guardrail" item is hidden. */
  canRemove?: boolean;
  /** When false, the "Lock for this CME session" item is hidden (e.g. already locked). */
  canLock?: boolean;
  buttonClassName?: string;
  /** Trigger button content. Defaults to "Manage"; pass "⋯" for a compact icon. */
  triggerLabel?: React.ReactNode;
  /**
   * Which edge the dropdown anchors to relative to the trigger:
   *   - "right" → dropdown's right edge aligns to the trigger's right edge
   *   - "left"  → dropdown's left edge aligns to the trigger's left edge
   */
  align?: "left" | "right";
}) {
  const router = useRouter();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  // Anchor the portalled dropdown to the trigger via fixed coordinates.
  // Recomputed on open and on scroll/resize so it tracks the trigger. The
  // dropdown only opens after a client click, so useEffect timing is fine.
  useEffect(() => {
    if (!open) return;
    function updateCoords() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (align === "left") {
        setCoords({ top: r.bottom + 6, left: r.left });
      } else {
        setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
      }
    }
    updateCoords();
    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [open, align]);

  // Close on outside click / Escape. The dropdown lives in a portal outside
  // containerRef, so the outside-click test must also exempt menuRef.
  useEffect(() => {
    if (!open && !showLockConfirm) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!menuRef.current || !menuRef.current.contains(target))
      ) {
        setOpen(false);
        setConfirmingRemove(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy && !lockBusy) {
        if (showLockConfirm) {
          setShowLockConfirm(false);
          setLockError(null);
        } else {
          setOpen(false);
          setConfirmingRemove(false);
          requestAnimationFrame(() => triggerRef.current?.focus());
        }
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy, showLockConfirm, lockBusy]);

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      const req = buildArchiveRequest(accountId);
      const res = await fetch(req.url, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        error?: string;
        message?: string;
      };
      const result = parseArchiveResponse({ ok: res.ok }, data);
      if (!result.success) {
        setError(result.errorMessage);
        return;
      }
      setOpen(false);
      setConfirmingRemove(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    setLockBusy(true);
    setLockError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/lockout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setLockError(data.error ?? "Failed to lock account. Please try again.");
        return;
      }
      setShowLockConfirm(false);
      router.refresh();
    } catch {
      setLockError("Network error. Please try again.");
    } finally {
      setLockBusy(false);
    }
  }

  const itemClass =
    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50";

  const dropdown =
    open && coords && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Account actions"
            style={{
              position: "fixed",
              top: coords.top,
              ...(coords.left != null ? { left: coords.left } : {}),
              ...(coords.right != null ? { right: coords.right } : {}),
              zIndex: 50,
            }}
            className="w-52 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-[0_12px_32px_-8px_rgba(28,25,23,0.25)]"
          >
            <Link role="menuitem" href={deriveRulesHref(accountId)} className={itemClass}>
              Manage rules
            </Link>
            <Link role="menuitem" href={deriveTradesHref(accountId)} className={itemClass}>
              View trades
            </Link>
            <Link role="menuitem" href={deriveOpenHref(accountId)} className={itemClass}>
              Account details
            </Link>

            {canLock && (
              <div className="mt-1 border-t border-stone-100 pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setShowLockConfirm(true);
                    setLockError(null);
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-orange-700 transition hover:bg-orange-50"
                >
                  Lock for this CME session
                </button>
              </div>
            )}

            {canRemove && (
              <div className="mt-1 border-t border-stone-100 pt-1">
                {!confirmingRemove ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setConfirmingRemove(true);
                      setError(null);
                    }}
                    className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-red-700 transition hover:bg-red-50"
                  >
                    Remove from Guardrail
                  </button>
                ) : (
                  <div className="px-3 py-2">
                    <p className="text-[11px] leading-4 text-stone-600">
                      Stop guarding this account? Historical trades and rules are kept.
                    </p>
                    {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingRemove(false);
                          setError(null);
                        }}
                        disabled={busy}
                        className="inline-flex h-7 items-center rounded-full border border-stone-200 px-3 text-[11px] font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleRemove}
                        disabled={busy}
                        className="inline-flex h-7 items-center rounded-full bg-red-700 px-3 text-[11px] font-medium text-white transition hover:bg-red-800 disabled:opacity-70"
                      >
                        {busy ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Manage ${accountLabel ?? "account"}`}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmingRemove(false);
          setError(null);
        }}
        className={
          buttonClassName ??
          "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
        }
      >
        {triggerLabel}
      </button>

      {dropdown}

      {showLockConfirm &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            data-lock-confirm
            onClick={(e) => {
              if (e.target === e.currentTarget && !lockBusy) {
                setShowLockConfirm(false);
                setLockError(null);
              }
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
              <h2
                id="lock-dialog-title"
                className="mt-3 text-base font-semibold text-stone-900"
              >
                Lock {accountLabel ?? "this account"} for the rest of this CME session?
              </h2>
              <p className="mt-2 text-sm text-stone-600">
                This account is locked or has rule activity today. To prevent bypassing
                Guardrail, removal will take effect at the next trading session reset.
              </p>
              <p className="mt-2 text-sm text-stone-500">
                The manual lock clears automatically when the CME session resets at
                17:00&nbsp;CT.
              </p>
              {lockError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {lockError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowLockConfirm(false);
                    setLockError(null);
                  }}
                  disabled={lockBusy}
                  className="inline-flex h-9 items-center rounded-full border border-stone-200 px-4 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLock}
                  disabled={lockBusy}
                  className="inline-flex h-9 items-center rounded-full bg-red-700 px-4 text-sm font-medium text-white transition hover:bg-red-800 disabled:opacity-70"
                >
                  {lockBusy ? "Locking…" : "Yes, lock this account"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
