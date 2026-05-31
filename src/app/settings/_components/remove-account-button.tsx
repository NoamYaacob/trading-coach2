"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "Remove from Guardrail" button with a simple confirm step.
 * Used for expired and inactive accounts in the broker connections section.
 *
 * Calls POST /api/accounts/:id/protection with protectionStatus="archived"
 * (soft-delete — preserves all historical trade data, rules, and audit logs).
 *
 * The archive endpoint applies a rule-breach / session-lock guard:
 *   - Clean accounts are archived immediately.
 *   - Accounts locked today have removal scheduled for the next session reset.
 */
export function RemoveAccountButton({
  accountId,
  redirectTo = "/settings",
  variant = "pill",
}: {
  accountId: string;
  redirectTo?: string;
  /** Visual style of the trigger only — "pill" (standalone) or "menuItem"
   *  (left-aligned destructive row inside a dropdown menu). Does NOT change the
   *  guarded archive request or behavior. */
  variant?: "pill" | "menuItem";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "scheduled" | "error" } | null>(null);

  async function handleConfirm() {
    setRemoving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}/protection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectionStatus: "archived" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: boolean;
        error?: string;
        message?: string;
        effectiveDate?: string;
      };
      if (!res.ok || !data.ok) {
        setMessage({ text: data.message ?? data.error ?? "Failed to remove.", kind: "error" });
        setRemoving(false);
        return;
      }
      if (data.applied === false) {
        setMessage({
          text: data.message ?? `Removal scheduled for ${data.effectiveDate ?? "next session reset"}.`,
          kind: "scheduled",
        });
        setRemoving(false);
        setConfirming(false);
        router.refresh();
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setMessage({ text: "Network error. Please try again.", kind: "error" });
      setRemoving(false);
    }
  }

  if (message?.kind === "scheduled") {
    return (
      <p className="text-xs text-amber-700">{message.text}</p>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {message?.kind === "error" && <p className="text-xs text-red-700">{message.text}</p>}
        <p className="text-xs text-stone-500">Remove this account from Guardrail?</p>
        <p className="text-xs text-stone-400">Historical data is preserved.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={removing}
            className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={removing}
            className="inline-flex items-center rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-70"
          >
            {removing ? "Removing…" : "Remove from Guardrail"}
          </button>
        </div>
      </div>
    );
  }

  const triggerClass =
    variant === "menuItem"
      ? "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700"
      : "inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-300 hover:text-red-700";

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={triggerClass}
    >
      Remove from Guardrail
    </button>
  );
}
