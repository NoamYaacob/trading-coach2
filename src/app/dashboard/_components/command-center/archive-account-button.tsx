"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildArchiveRequest,
  parseArchiveResponse,
  ARCHIVE_DIALOG,
} from "./archive-account-helpers";

type Props = {
  accountId: string;
  accountLabel?: string;
  className?: string;
};

function ArchiveConfirmDialog({
  accountLabel,
  isArchiving,
  error,
  onConfirm,
  onCancel,
}: {
  accountLabel: string | undefined;
  isArchiving: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isArchiving) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isArchiving, onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-dialog-title"
      aria-describedby="archive-dialog-desc"
    >
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isArchiving ? undefined : onCancel}
      />
      <div className="relative w-full max-w-[460px] rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_24px_64px_-12px_rgba(28,25,23,0.3)]">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-amber-800">
          Unavailable account
        </span>
        <h2
          id="archive-dialog-title"
          className="mt-3 text-[17px] font-semibold tracking-[-0.02em] text-stone-950"
        >
          {ARCHIVE_DIALOG.title}
        </h2>
        <p
          id="archive-dialog-desc"
          className="mt-2 text-sm leading-6 text-stone-600"
        >
          {ARCHIVE_DIALOG.body}
        </p>
        {accountLabel && (
          <p className="mt-3 text-sm text-stone-500">
            Account:{" "}
            <span className="font-medium text-stone-700">{accountLabel}</span>
          </p>
        )}
        <p className="mt-2 text-xs text-stone-400">{ARCHIVE_DIALOG.note}</p>
        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isArchiving}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {ARCHIVE_DIALOG.cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isArchiving}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-800 px-6 text-sm font-medium text-white transition hover:bg-stone-950 disabled:pointer-events-none disabled:opacity-70"
          >
            {isArchiving ? "Archiving…" : ARCHIVE_DIALOG.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArchiveAccountButton({ accountId, accountLabel, className }: Props) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function handleConfirm() {
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
      setShowDialog(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        className={className}
      >
        Archive
      </button>
      {showDialog && (
        <ArchiveConfirmDialog
          accountLabel={accountLabel}
          isArchiving={busy}
          error={error}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!busy) closeDialog();
          }}
        />
      )}
    </>
  );
}
