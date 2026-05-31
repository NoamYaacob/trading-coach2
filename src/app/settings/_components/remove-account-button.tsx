"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * "Remove from Guardrail" trigger + centered confirmation modal.
 * Used for expired and inactive accounts in the broker connections section, and
 * inside the per-account "More" menu (variant="menuItem").
 *
 * Calls POST /api/accounts/:id/protection with protectionStatus="archived"
 * (soft-delete — preserves all historical trade data, rules, and audit logs).
 *
 * The archive endpoint applies a rule-breach / session-lock guard:
 *   - Clean accounts are archived immediately.
 *   - Accounts locked today have removal scheduled for the next session reset.
 *
 * Only the confirmation surface changed (inline expansion → centered modal);
 * the guarded request, payload, and scheduled/immediate handling are unchanged.
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
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "scheduled" | "error" } | null>(null);

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
        // Keep the modal open and surface the error inside it.
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
        setOpen(false);
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
    return <p className="text-xs text-amber-700">{message.text}</p>;
  }

  const triggerClass =
    variant === "menuItem"
      ? "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 hover:text-red-700"
      : "inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-300 hover:text-red-700";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Close the surrounding "More" menu (if any) before opening the modal.
          e.currentTarget.closest("details")?.removeAttribute("open");
          setMessage(null);
          setOpen(true);
        }}
        className={triggerClass}
      >
        Remove from Guardrail
      </button>
      {open && (
        <ConfirmDialog
          title="Remove this account from Guardrail?"
          body="Guardrail will stop monitoring this account. Historical trades, rules, and alerts are preserved."
          note="If this account is locked or has rule activity today, removal may take effect after the next trading session reset."
          confirmLabel="Remove from Guardrail"
          busyLabel="Removing…"
          busy={removing}
          error={message?.kind === "error" ? message.text : null}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!removing) {
              setOpen(false);
              setMessage(null);
            }
          }}
        />
      )}
    </>
  );
}
