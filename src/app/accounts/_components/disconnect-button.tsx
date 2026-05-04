"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isDisconnecting ? undefined : onCancel}
      />

      {/* Panel */}
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
          Guardrail will stop reading this broker account. Your rules, journal
          entries, and manual mode data will stay saved.
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
  redirectTo = "/accounts",
}: {
  accountId: string;
  providerLabel: string;
  /** Where to navigate after a successful disconnect. Defaults to /accounts. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsDisconnecting(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(
          data.message ?? data.error ?? "Failed to disconnect.",
        );
      }
      setShowDialog(false);
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect. Please try again.",
      );
      setIsDisconnecting(false);
    }
  }

  return (
    <>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button
        type="button"
        onClick={() => {
          setError(null);
          setShowDialog(true);
        }}
        className="inline-flex rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
      >
        Disconnect
      </button>

      {showDialog && (
        <DisconnectDialog
          providerLabel={providerLabel}
          isDisconnecting={isDisconnecting}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!isDisconnecting) setShowDialog(false);
          }}
        />
      )}
    </>
  );
}
