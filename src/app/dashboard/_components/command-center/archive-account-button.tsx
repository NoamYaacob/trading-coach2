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
  className?: string;
};

function ArchiveConfirmDialog({
  isArchiving,
  error,
  onConfirm,
  onCancel,
}: {
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
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        <h2
          id="archive-dialog-title"
          className="text-xl font-semibold tracking-[-0.03em] text-stone-950"
        >
          {ARCHIVE_DIALOG.title}
        </h2>
        <p
          id="archive-dialog-desc"
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          {ARCHIVE_DIALOG.body}
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-70"
          >
            {isArchiving ? "Archiving…" : ARCHIVE_DIALOG.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ArchiveAccountButton({ accountId, className }: Props) {
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
