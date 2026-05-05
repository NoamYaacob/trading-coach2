"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Maps common IANA zones to trader-friendly city names.
// Falls back to the short TZ abbreviation (e.g. "EST") for unlisted zones.
const TZ_CITY: Record<string, string> = {
  "America/New_York":    "New York",
  "America/Chicago":     "Chicago",
  "America/Denver":      "Denver",
  "America/Los_Angeles": "Los Angeles",
  "America/Toronto":     "Toronto",
  "America/Sao_Paulo":   "São Paulo",
  "Europe/London":       "London",
  "Europe/Berlin":       "Frankfurt",
  "Europe/Paris":        "Paris",
  "Europe/Amsterdam":    "Amsterdam",
  "Asia/Jerusalem":      "Tel Aviv",
  "Asia/Dubai":          "Dubai",
  "Asia/Tokyo":          "Tokyo",
  "Asia/Hong_Kong":      "Hong Kong",
  "Asia/Singapore":      "Singapore",
  "Asia/Seoul":          "Seoul",
  "Australia/Sydney":    "Sydney",
};

function tzCityName(tz: string): string {
  if (TZ_CITY[tz]) return TZ_CITY[tz]!;
  // Fall back to the short abbreviation, e.g. "EST" or "GMT+3".
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

function formatUnlockLabel(lockedUntilMs: number, tz: string): string {
  const now = Date.now();
  const diffMin = Math.ceil((lockedUntilMs - now) / 60_000);

  if (diffMin <= 0) return "soon";

  if (diffMin <= 90) {
    return `in ${diffMin} minute${diffMin !== 1 ? "s" : ""}`;
  }

  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(lockedUntilMs));

  return `after ${timeStr} ${tzCityName(tz)} time`;
}

function BlockedDialog({
  lockedUntilMs,
  lockedUntilTz,
  onClose,
}: {
  lockedUntilMs: number | null;
  lockedUntilTz: string | null;
  onClose: () => void;
}) {
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

  const unlockSuffix =
    lockedUntilMs != null && lockedUntilTz
      ? formatUnlockLabel(lockedUntilMs, lockedUntilTz)
      : null;

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
          This account is protected during today&apos;s trading session.{" "}
          {unlockSuffix
            ? `You can disconnect ${unlockSuffix}.`
            : "You can disconnect after today's protected session ends."}
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
  lockedUntilMs = null,
  lockedUntilTz = null,
  redirectTo = "/accounts",
}: {
  accountId: string;
  providerLabel: string;
  /** Pass true when the account is protected during an active trading session. */
  isBlocked?: boolean;
  /** UTC millisecond timestamp of when the session lock lifts. */
  lockedUntilMs?: number | null;
  /** IANA timezone for formatting the unlock time. */
  lockedUntilTz?: string | null;
  redirectTo?: string;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialogMode, setDialogMode] = useState<"destructive" | "blocked" | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeDialog() {
    setDialogMode(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

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

  const unlockLabel =
    isBlocked && lockedUntilMs != null && lockedUntilTz
      ? formatUnlockLabel(lockedUntilMs, lockedUntilTz)
      : null;

  return (
    <>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {isBlocked ? (
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-amber-700">
            Protected session active ·{" "}
            {unlockLabel
              ? `Disconnect available ${unlockLabel}.`
              : "Disconnect available after session ends."}
          </p>
          <button
            ref={triggerRef}
            type="button"
            onClick={handleClick}
            className="inline-flex rounded-full border border-stone-100 px-4 py-2 text-xs font-medium text-stone-400 transition hover:border-stone-200 hover:text-stone-500"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleClick}
          className="inline-flex rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
        >
          Disconnect
        </button>
      )}

      {dialogMode === "blocked" && (
        <BlockedDialog
          lockedUntilMs={lockedUntilMs}
          lockedUntilTz={lockedUntilTz}
          onClose={closeDialog}
        />
      )}

      {dialogMode === "destructive" && (
        <DisconnectDialog
          providerLabel={providerLabel}
          isDisconnecting={isDisconnecting}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!isDisconnecting) closeDialog();
          }}
        />
      )}
    </>
  );
}
