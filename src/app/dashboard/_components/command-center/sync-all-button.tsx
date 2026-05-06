"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deriveSyncAllStatus,
  formatSyncAllStatus,
  type SyncAllResponse,
  type SyncAllStatus,
} from "./sync-all-button-helpers";

function RotateIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden
      className={`h-3 w-3 shrink-0 ${spinning ? "animate-spin" : ""}`}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 7a5.5 5.5 0 1 1-1.08-3.3" />
      <polyline points="12.5 2 12.5 5.5 9 5.5" />
    </svg>
  );
}

export function SyncAllButton() {
  const router = useRouter();
  const [status, setStatus] = useState<SyncAllStatus>({ kind: "idle" });
  const isSyncing = status.kind === "syncing";

  async function handleClick() {
    setStatus({ kind: "syncing" });
    try {
      const res = await fetch("/api/accounts/sync-all", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as SyncAllResponse;
      const next = deriveSyncAllStatus({ httpOk: res.ok, status: res.status, body });
      setStatus(next);
      if (next.kind === "success") {
        router.refresh();
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Please try again." });
    }
  }

  const message = formatSyncAllStatus(status);
  const messageClass =
    status.kind === "error"
      ? "text-red-600"
      : status.kind === "success" && status.failedAccounts > 0
        ? "text-amber-700"
        : "text-stone-500";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isSyncing}
        aria-label="Sync all accounts"
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RotateIcon spinning={isSyncing} />
        {isSyncing ? "Syncing…" : "Sync all"}
      </button>
      {message && status.kind !== "syncing" ? (
        <span className={`text-[11px] ${messageClass}`} role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
