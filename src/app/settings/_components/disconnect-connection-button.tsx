"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  /** Number of linked active accounts — shown in the confirmation copy. */
  linkedAccountCount: number;
};

export function DisconnectConnectionButton({ connectionId, linkedAccountCount }: Props) {
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

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("confirming")}
        className="inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-red-300 hover:text-red-700"
      >
        Disconnect connection
      </button>
    );
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
    <div className="flex flex-col items-end gap-2 rounded-xl border border-red-100 bg-red-50/60 px-4 py-3">
      <p className="text-xs font-semibold text-stone-700">Disconnect this connection?</p>
      <p className="text-xs leading-relaxed text-stone-600">
        {linkedAccountCount > 0
          ? `All ${linkedAccountCount} linked account(s) will be removed from Guardrail monitoring. `
          : "This connection has no linked accounts. "}
        Historical trades and rules are preserved.
        {" "}
        <span className="text-amber-700">
          If any account is locked or has rule activity today, removal will take effect at the next
          trading session reset — to prevent bypassing your own rules.
        </span>
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setStep("idle"); setError(null); }}
          disabled={step === "working"}
          className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={step === "working"}
          className="inline-flex items-center rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-70"
        >
          {step === "working" ? "Disconnecting…" : "Disconnect connection"}
        </button>
      </div>
    </div>
  );
}
