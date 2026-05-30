"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { deriveOpenHref, deriveRulesHref, deriveTradesHref } from "./data-helpers";
import { buildArchiveRequest, parseArchiveResponse } from "./archive-account-helpers";

/**
 * AccountManageMenu — a compact per-account "Manage" dropdown for the Dashboard.
 *
 * Holds ONLY account-level actions (rules, trades, account detail, remove from
 * Guardrail). Service-level / broker connection management lives in Settings and
 * is intentionally absent here. No broker technical diagnostics are exposed.
 *
 * "Remove from Guardrail" reuses the existing guarded archive flow
 * (buildArchiveRequest → POST /api/accounts/:id/protection { archived }). That
 * endpoint enforces the scheduled-removal guard from PR #73/#75: when the
 * account is locked or has rule activity today, the archive is deferred
 * (applied=false) rather than applied immediately, so this menu can never be
 * used to bypass a lock. Historical trade / rule / audit data is never deleted.
 */
export function AccountManageMenu({
  accountId,
  accountLabel,
  canRemove = true,
  buttonClassName,
  align = "right",
}: {
  accountId: string;
  accountLabel?: string;
  /** When false, the "Remove from Guardrail" item is hidden. */
  canRemove?: boolean;
  buttonClassName?: string;
  /**
   * Which edge the dropdown anchors to. The enclosing command-center section is
   * `overflow-x-hidden`, so the menu must expand *into* the card, never past it:
   *   - "right" (desktop, right-aligned actions cell) → expands leftward
   *   - "left"  (mobile card, left-aligned action row) → expands rightward
   */
  align?: "left" | "right";
}) {
  const router = useRouter();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingRemove(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        setOpen(false);
        setConfirmingRemove(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

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

  const itemClass =
    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50";

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
        Manage
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account actions"
          className={`absolute ${align === "left" ? "left-0" : "right-0"} z-30 mt-1.5 w-52 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-[0_12px_32px_-8px_rgba(28,25,23,0.25)]`}
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
        </div>
      )}
    </div>
  );
}
