"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * Shared centered confirmation modal for destructive Settings actions — the
 * account "Remove from Guardrail" and the connection "Disconnect connection".
 *
 * Uses the Guardrail dialog language: a warm dark overlay over a soft white,
 * rounded card with a subtle border + shadow. Rendered via a portal to
 * document.body so it stays centered and fully visible even when triggered from
 * inside a collapsing menu (the account "More" dropdown) or a width-constrained
 * connection card — the previous inline expansions could overflow there.
 *
 * UI only: it renders copy and calls back onConfirm / onCancel. It never
 * performs the request itself — callers keep their existing guarded flows,
 * endpoints, and payloads unchanged.
 */
export function ConfirmDialog({
  title,
  body,
  note,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  /** Calm secondary line (e.g. the locked / session-reset caveat). */
  note?: string;
  confirmLabel: string;
  /** Label while the request is in flight (e.g. "Removing…"). */
  busyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
    >
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={busy ? undefined : onCancel}
      />
      <div className="relative w-full max-w-[460px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_24px_64px_-12px_rgba(28,25,23,0.3)]">
        <h2 id="confirm-dialog-title" className="text-[17px] font-semibold tracking-[-0.02em] text-stone-950">
          {title}
        </h2>
        <p id="confirm-dialog-desc" className="mt-2 text-sm leading-6 text-stone-600">
          {body}
        </p>
        {note && <p className="mt-2 text-xs leading-5 text-stone-400">{note}</p>}
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-900 px-5 text-sm font-medium text-white transition hover:bg-stone-950 disabled:pointer-events-none disabled:opacity-70"
          >
            {busy ? (busyLabel ?? "Working…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
