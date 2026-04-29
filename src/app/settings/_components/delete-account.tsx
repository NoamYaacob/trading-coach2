"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function ConfirmDialog({
  isDeleting,
  onConfirm,
  onCancel,
}: {
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDeleting) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDeleting, onCancel]);

  // Focus cancel button on mount
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-desc"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isDeleting ? undefined : onCancel}
      />

      {/* Panel */}
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        {/* Icon */}
        <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-red-600"
            aria-hidden="true"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <h2
          id="delete-dialog-title"
          className="text-xl font-semibold tracking-[-0.03em] text-stone-950"
        >
          Are you sure you want to delete your account?
        </h2>
        <p
          id="delete-dialog-desc"
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          This permanently deletes your account, rules, journal, alerts, and connected accounts. This action cannot be undone.
        </p>

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex h-10 items-center justify-center rounded-full bg-red-600 px-6 text-sm font-medium text-white transition hover:bg-red-700 disabled:pointer-events-none disabled:opacity-70"
          >
            {isDeleting ? "Deleting account…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmText === "DELETE";

  async function handleConfirmedDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete account.");
      setShowDialog(false);
      setDeleted(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account.");
      setIsDeleting(false);
    }
  }

  if (deleted) {
    return (
      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
        Your account has been deleted. Redirecting…
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-stone-600">
          This permanently deletes your account, rules, journal, alerts, and connected accounts. This action cannot be undone.
        </p>

        <div className="grid gap-2">
          <label
            htmlFor="delete-confirm"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500"
          >
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="h-11 w-full max-w-xs rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowDialog(true)}
            disabled={!confirmed}
            className="inline-flex h-10 items-center justify-center rounded-full bg-red-600 px-6 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
          >
            Delete my account
          </button>
        </div>
      </div>

      {showDialog && (
        <ConfirmDialog
          isDeleting={isDeleting}
          onConfirm={handleConfirmedDelete}
          onCancel={() => !isDeleting && setShowDialog(false)}
        />
      )}
    </>
  );
}
