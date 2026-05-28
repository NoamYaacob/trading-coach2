"use client";

import { useState } from "react";

type SyncSummary = {
  summary: {
    connectionsFound: number;
    connectionsSynced: number;
    connectionsWithErrors: number;
    connectionsSkipped: number;
    accountsInsertedAsPendingDecision: number;
    accountsMarkedMissing: number;
    pendingDecisionBefore: number;
    pendingDecisionAfter: number;
    missingBefore: number;
    missingAfter: number;
  };
  diagnosis: string[];
  perConnection: Array<{
    connectionId: string;
    env: string;
    connectionStatus: string;
    isActive: boolean;
    probe: {
      attempted: boolean;
      httpStatus: number | null;
      accountsReturned: number | null;
      accounts: Array<{ externalAccountId: string; name: string; active: boolean }> | null;
      bodyPreview: string | null;
      errorMessage: string | null;
    };
    discovery: {
      attempted: boolean;
      ok: boolean | null;
      newlyCreatedCount: number;
      newlyCreatedIds: string[];
      missingCount: number;
      missingIds: string[];
      errorMessage: string | null;
    };
  }>;
  currentPendingDecision: Array<{
    id: string;
    label: string;
    externalAccountId: string | null;
    brokerConnectionId: string | null;
  }>;
  error?: string;
};

export function ProbePanel({ connectionIds }: { connectionIds: string[] }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<SyncSummary | null>(null);

  async function runSync() {
    setStatus("running");
    setResult(null);
    try {
      const res = await fetch("/api/debug/broker-sync-summary", { method: "POST" });
      const data = (await res.json()) as SyncSummary;
      setResult(data);
      setStatus(res.ok ? "done" : "error");
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Network error" } as SyncSummary);
      setStatus("error");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runSync}
          disabled={status === "running"}
          className="inline-flex items-center rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
        >
          {status === "running" ? "Running sync + probe…" : "Run sync-all + probe Tradovate API"}
        </button>
        {connectionIds.map((id) => (
          <a
            key={id}
            href={`/api/debug/tradovate-discovery?connectionId=${id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400"
          >
            Full trace: …{id.slice(-8)}
          </a>
        ))}
      </div>

      {status === "running" && (
        <p className="text-sm text-stone-500">
          Calling Tradovate /account/list for each active connection and running reconciliation…
        </p>
      )}

      {result && (
        <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-700 whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
