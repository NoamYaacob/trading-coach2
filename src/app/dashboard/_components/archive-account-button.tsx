"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  accountId: string;
  accountLabel: string;
};

/**
 * Archive button for expired / unavailable accounts.
 *
 * Calls `POST /api/accounts/[id]/protection` with `{ protectionStatus: "archived" }`.
 * The archive transition is reversible and does not delete historical trades,
 * rules, or audit records — `loadCommandCenterData` simply stops loading
 * archived accounts on subsequent requests.
 *
 * The button is intentionally a two-step click (initial → "Confirm") so a
 * stray click on an expired account card cannot quietly remove it from view.
 */
export function ArchiveAccountButton({ accountId, accountLabel }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: "archived" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Failed (${res.status})`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <span style={{ fontSize: 11, color: "var(--gr-bad)" }}>
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{
          padding: "5px 10px",
          fontSize: 11.5,
          border: "1px solid var(--gr-border)",
          background: "var(--gr-bg-elev)",
          color: "var(--gr-text-mid)",
          borderRadius: 7,
          cursor: "pointer",
        }}
        aria-label={`Archive ${accountLabel}`}
      >
        Archive
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        onClick={archive}
        disabled={busy}
        style={{
          padding: "5px 10px",
          fontSize: 11.5,
          border: "1px solid var(--gr-bad)",
          background: "var(--gr-bad)",
          color: "white",
          borderRadius: 7,
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Archiving…" : "Confirm archive"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        style={{
          padding: "5px 8px",
          fontSize: 11.5,
          border: "none",
          background: "transparent",
          color: "var(--gr-text-mute)",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </span>
  );
}
