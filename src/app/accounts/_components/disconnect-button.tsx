"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function BlockedDialog({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-blocked-title"
      aria-describedby="disconnect-blocked-desc"
    >
      <div className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        <h2
          id="disconnect-blocked-title"
          className="text-xl font-semibold tracking-[-0.03em] text-stone-950"
        >
          Disconnect blocked
        </h2>
        <p
          id="disconnect-blocked-desc"
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          This account is protected during today&apos;s trading session. You can disconnect after the session ends.
        </p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link
            href="/guardian"
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            View Guardian status
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-stone-800"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function DisconnectDialog({
  providerLabel,
  isDisconnecting,
  onConfirm,
  onCancel,
}: {
  providerLabel: string;
  isDisconnecting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isDisconnecting) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isDisconnecting, onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-dialog-title"
      aria-describedby="disconnect-dialog-desc"
    >
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isDisconnecting ? undefined : onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        <h2
          id="disconnect-dialog-title"
          className="text-xl font-semibold tracking-[-0.03em] text-stone-950"
        >
          Disconnect {providerLabel}?
        </h2>
        <p
          id="disconnect-dialog-desc"
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          Guardrail will stop reading this broker account. Your rules and settings will stay saved.
        </p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isDisconnecting}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
          >
            Keep connected
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDisconnecting}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-70"
          >
            {isDisconnecting ? "Disconnecting…" : `Disconnect ${providerLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DisconnectButton({
  accountId,
  providerLabel,
  isBlocked = false,
  redirectTo = "/accounts",
}: {
  accountId: string;
  providerLabel: string;
  /** Pass true when the account is protected during an active trading session. */
  isBlocked?: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [dialogMode, setDialogMode] = useState<"destructive" | "blocked" | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setDialogMode(isBlocked ? "blocked" : "destructive");
  }

  async function handleConfirm() {
    setIsDisconnecting(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        if (res.status === 409 && data.error === "protection_locked") {
          setIsDisconnecting(false);
          setDialogMode("blocked");
          return;
        }
        throw new Error(data.message ?? data.error ?? "Failed to disconnect.");
      }
      setDialogMode(null);
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect. Please try again.");
      setIsDisconnecting(false);
    }
  }

  return (
    <>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
      >
        Disconnect
      </button>

      {dialogMode === "blocked" && (
        <BlockedDialog onClose={() => setDialogMode(null)} />
      )}

      {dialogMode === "destructive" && (
        <DisconnectDialog
          providerLabel={providerLabel}
          isDisconnecting={isDisconnecting}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!isDisconnecting) setDialogMode(null);
          }}
        />
      )}
    </>
  );
}
