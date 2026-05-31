"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

type AccountResult = {
  id: string;
  label: string;
  status: "archived_now" | "scheduled";
  scheduledFor?: string;
  lockReason?: string;
};

type DisconnectResponse = {
  ok?: boolean;
  status?: "removed_now" | "scheduled" | "partial";
  connectionDeleted?: boolean;
  effectiveAt?: string | null;
  affectedAccounts?: AccountResult[];
  error?: string;
  message?: string;
};

type Props = {
  connectionId: string;
  /** Number of linked active accounts. Accepted for API compatibility with the
   *  connection card; the confirmation copy no longer interpolates it. */
  linkedAccountCount?: number;
};

/**
 * "Disconnect connection" trigger + centered confirmation modal.
 *
 * The destructive confirmation moved from an inline red warning box (which could
 * overflow horizontally inside a narrow connection card) to the shared centered
 * ConfirmDialog. The disconnect request, response handling, and the per-account
 * result summary are unchanged.
 */
export function DisconnectConnectionButton({ connectionId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "confirming" | "working" | "result">("idle");
  const [result, setResult] = useState<DisconnectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setStep("working");
    setError(null);
    try {
      const res = await fetch(`/api/broker-connections/${connectionId}/disconnect`, {
        method: "POST",
      });
      const data = (await res.json()) as DisconnectResponse;
      if (!res.ok || !data.ok) {
        setError(data.message ?? data.error ?? "Failed to disconnect. Please try again.");
        setStep("confirming");
        return;
      }
      setResult(data);
      setStep("result");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setStep("confirming");
    }
  }

  if (step === "result" && result) {
    const immediate = result.affectedAccounts?.filter((a) => a.status === "archived_now") ?? [];
    const scheduled = result.affectedAccounts?.filter((a) => a.status === "scheduled") ?? [];
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs">
        <p className="font-medium text-stone-700">Connection disconnected</p>
        {immediate.length > 0 && (
          <p className="text-stone-500">
            {immediate.length} account(s) removed immediately.
          </p>
        )}
        {scheduled.length > 0 && (
          <p className="text-amber-700">
            {scheduled.length} account(s) scheduled for removal at next session reset
            {result.effectiveAt ? ` (${result.effectiveAt})` : ""}.
          </p>
        )}
        {result.connectionDeleted && (
          <p className="text-stone-400">Connection removed.</p>
        )}
        <button
          type="button"
          onClick={() => { setStep("idle"); setResult(null); }}
          className="mt-1 self-start text-stone-400 underline hover:text-stone-600"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(null); setStep("confirming"); }}
        className="inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-300 hover:text-red-700"
      >
        Disconnect connection
      </button>
      {(step === "confirming" || step === "working") && (
        <ConfirmDialog
          title="Disconnect this connection?"
          body="All linked accounts under this connection will be removed from Guardrail monitoring. Historical trades and rules are preserved."
          note="If any account is locked or has rule activity today, removal will take effect at the next trading session reset to prevent bypassing your own rules."
          confirmLabel="Disconnect connection"
          busyLabel="Disconnecting…"
          busy={step === "working"}
          error={error}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (step !== "working") {
              setStep("idle");
              setError(null);
            }
          }}
        />
      )}
    </>
  );
}
