"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Maps common IANA zones to trader-friendly location names.
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
  "Europe/Madrid":       "Madrid",
  "Europe/Rome":         "Rome",
  "Europe/Zurich":       "Zurich",
  "Asia/Jerusalem":      "Israel",
  "Asia/Dubai":          "Dubai",
  "Asia/Kolkata":        "India",
  "Asia/Bangkok":        "Bangkok",
  "Asia/Shanghai":       "China",
  "Asia/Hong_Kong":      "Hong Kong",
  "Asia/Singapore":      "Singapore",
  "Asia/Seoul":          "Seoul",
  "Asia/Tokyo":          "Tokyo",
  "Australia/Sydney":    "Sydney",
};

function tzCityName(tz: string): string {
  if (TZ_CITY[tz]) return TZ_CITY[tz]!;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

function formatHHMM(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function dateKeyInTz(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns "today", "tomorrow", or a weekday name (lower-case) for the calendar
 * day of `windowStartMs` in the user's timezone, relative to right now.
 */
function windowDayLabel(windowStartMs: number, tz: string): string {
  const now = new Date();
  const todayKey = dateKeyInTz(now, tz);
  const windowKey = dateKeyInTz(new Date(windowStartMs), tz);
  if (windowKey === todayKey) return "today";
  const tomorrowKey = dateKeyInTz(new Date(now.getTime() + 86_400_000), tz);
  if (windowKey === tomorrowKey) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" })
    .format(new Date(windowStartMs))
    .toLowerCase();
}

/**
 * Formats the maintenance window for display in the user's local timezone.
 * Example: "Available today: 22:00–02:00 Israel time."
 * The end time may cross midnight, which reads naturally as "02:00".
 */
function formatWindowAvailableLabel(
  windowStartMs: number,
  windowEndMs: number,
  userTz: string | null,
): string {
  const tz = userTz ?? "UTC";
  const start = formatHHMM(windowStartMs, tz);
  const end = formatHHMM(windowEndMs, tz);
  const city = tzCityName(tz);
  const day = windowDayLabel(windowStartMs, tz);
  return `Available ${day}: ${start}–${end} ${city} time.`;
}

// ─── BlockedDialog ────────────────────────────────────────────────────────────

function BlockedDialog({
  windowStartMs,
  windowEndMs,
  userTz,
  onClose,
}: {
  windowStartMs: number | null;
  windowEndMs: number | null;
  userTz: string | null;
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

  const availableLabel =
    windowStartMs != null && windowEndMs != null
      ? formatWindowAvailableLabel(windowStartMs, windowEndMs, userTz)
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
          Broker connections can only be disconnected during the futures
          maintenance window, when the trading day is safely outside active
          monitoring.
        </p>
        {availableLabel && (
          <p className="mt-2 text-sm font-medium text-stone-700">{availableLabel}</p>
        )}
        <div className="mt-7 flex justify-end">
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

// ─── RemoveDialog ─────────────────────────────────────────────────────────────

function RemoveDialog({
  isRemoving,
  onConfirm,
  onCancel,
}: {
  isRemoving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isRemoving) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isRemoving, onCancel]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-dialog-title"
      aria-describedby="remove-dialog-desc"
    >
      <div
        className="absolute inset-0 bg-stone-950/50 backdrop-blur-sm"
        onClick={isRemoving ? undefined : onCancel}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-[0_32px_80px_-20px_rgba(28,25,23,0.5)]">
        <h2
          id="remove-dialog-title"
          className="text-xl font-semibold tracking-[-0.03em] text-stone-950"
        >
          Remove from Guardrail?
        </h2>
        <p
          id="remove-dialog-desc"
          className="mt-3 text-sm leading-6 text-stone-600"
        >
          This account is no longer active in Tradovate. Removing it from
          Guardrail will delete the connection record. Your rules and journal
          entries will stay saved.
        </p>
        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={isRemoving}
            className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-6 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isRemoving}
            className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-white transition hover:bg-stone-800 disabled:pointer-events-none disabled:opacity-70"
          >
            {isRemoving ? "Removing…" : "Remove from Guardrail"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DisconnectDialog ─────────────────────────────────────────────────────────

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

// ─── DisconnectButton ─────────────────────────────────────────────────────────

export function DisconnectButton({
  accountId,
  providerLabel,
  isBlocked = false,
  isUnavailable = false,
  windowStartMs = null,
  windowEndMs = null,
  userTz = null,
  redirectTo = "/accounts",
}: {
  accountId: string;
  providerLabel: string;
  /**
   * Pass true when disconnect is outside the futures maintenance window.
   * Driven by getBrokerDisconnectWindow() — NOT by the user's session hours.
   * Ignored when isUnavailable=true.
   */
  isBlocked?: boolean;
  /**
   * Pass true when the account is no longer active in the broker
   * (missingFromBrokerSince is set). Bypasses the disconnect window and
   * shows "Remove from Guardrail" UI instead of the normal disconnect flow.
   */
  isUnavailable?: boolean;
  /** UTC milliseconds of the upcoming maintenance window start. */
  windowStartMs?: number | null;
  /** UTC milliseconds of the upcoming maintenance window end. */
  windowEndMs?: number | null;
  /** User's IANA timezone for displaying the window in local time. */
  userTz?: string | null;
  redirectTo?: string;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialogMode, setDialogMode] = useState<"destructive" | "blocked" | "remove" | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeDialog() {
    setDialogMode(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleClick() {
    setError(null);
    if (isUnavailable) {
      setDialogMode("remove");
    } else {
      setDialogMode(isBlocked ? "blocked" : "destructive");
    }
  }

  async function handleConfirm() {
    setIsDisconnecting(true);
    setError(null);

    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
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

  const availableLabel =
    !isUnavailable && isBlocked && windowStartMs != null && windowEndMs != null
      ? formatWindowAvailableLabel(windowStartMs, windowEndMs, userTz)
      : null;

  return (
    <>
      {error && <p className="text-xs text-red-700">{error}</p>}

      {isUnavailable ? (
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-stone-400">
            No longer active in Tradovate · removable anytime
          </p>
          <button
            ref={triggerRef}
            type="button"
            onClick={handleClick}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-red-300 hover:text-red-700"
          >
            Remove from Guardrail
          </button>
        </div>
      ) : isBlocked ? (
        <div className="flex flex-col items-end gap-1">
          {availableLabel && (
            <p className="text-xs text-amber-700">{availableLabel}</p>
          )}
          <button
            ref={triggerRef}
            type="button"
            onClick={handleClick}
            className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-100 px-4 py-2 text-xs font-medium text-stone-400 transition hover:border-stone-200 hover:text-stone-500"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={handleClick}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
        >
          Disconnect
        </button>
      )}

      {dialogMode === "blocked" && (
        <BlockedDialog
          windowStartMs={windowStartMs}
          windowEndMs={windowEndMs}
          userTz={userTz}
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

      {dialogMode === "remove" && (
        <RemoveDialog
          isRemoving={isDisconnecting}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!isDisconnecting) closeDialog();
          }}
        />
      )}
    </>
  );
}
