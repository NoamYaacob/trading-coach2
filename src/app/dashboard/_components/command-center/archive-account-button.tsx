"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildArchiveRequest, ARCHIVE_CONFIRM_MSG } from "./archive-account-helpers";

type Props = {
  accountId: string;
  className?: string;
};

/**
 * One-click Archive button for unavailable broker accounts.
 *
 * Shows a native confirm dialog, then POSTs to the protection endpoint with
 * protectionStatus="archived". On success the router is refreshed so the
 * account is removed from all active views without a full page reload.
 *
 * Generic: driven by accountId only, not hardcoded to any broker or prop firm.
 */
export function ArchiveAccountButton({ accountId, className }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(ARCHIVE_CONFIRM_MSG)) return;
    setBusy(true);
    setError(null);
    try {
      const req = buildArchiveRequest(accountId);
      const res = await fetch(req.url, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Could not archive account.");
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="contents">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={`${className ?? ""} disabled:opacity-50`}
      >
        {busy ? "Archiving…" : "Archive"}
      </button>
      {error && (
        <p className="w-full text-[10px] text-red-600">{error}</p>
      )}
    </div>
  );
}
