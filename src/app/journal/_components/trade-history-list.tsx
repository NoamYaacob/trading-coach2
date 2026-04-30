"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { TradeEntry } from "./types";

function fmtMoney(n: number | null): { text: string; cls: string } {
  if (n === null) return { text: "—", cls: "text-stone-400" };
  if (n > 0) return { text: `+$${n.toFixed(2)}`, cls: "text-emerald-700 font-medium" };
  if (n < 0) return { text: `−$${Math.abs(n).toFixed(2)}`, cls: "text-red-700 font-medium" };
  return { text: "$0.00", cls: "text-stone-500" };
}

function fmtNum(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtR(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtDate(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(isoUtc));
}

function PnlSourceBadge({ source }: { source: string | null }) {
  if (!source) return null;
  const styles: Record<string, string> = {
    calculated: "bg-emerald-50 text-emerald-700",
    manual: "bg-stone-100 text-stone-600",
    override: "bg-amber-50 text-amber-700",
  };
  const labels: Record<string, string> = {
    calculated: "Auto",
    manual: "Manual",
    override: "Override",
  };
  const cls = styles[source] ?? "bg-stone-100 text-stone-600";
  const label = labels[source] ?? source;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (value === "—") return null;
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-stone-500">{label}</span>
      <span className="font-mono text-stone-800">{value}</span>
    </div>
  );
}

export function TradeHistoryList({
  entries,
  tz,
  onEdit,
}: {
  entries: TradeEntry[];
  tz: string;
  onEdit: (entry: TradeEntry) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/journal/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to delete trade.");
      }
      setConfirmingDelete(null);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete trade.");
    } finally {
      setDeleting(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-6 py-8 text-center">
        <p className="text-base font-semibold text-stone-800">No trades logged for this session</p>
        <p className="mt-2 text-sm text-stone-600">Add a manual trade below to track risk state.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: expandable cards */}
      <div className="md:hidden divide-y divide-stone-100">
        {entries.map((e) => {
          const pnl = fmtMoney(e.pnl);
          const isExpanded = expanded.has(e.id);
          const isConfirming = confirmingDelete === e.id;
          const isDeleting = deleting === e.id;

          return (
            <div key={e.id} className="py-3">
              {/* Card header — tap to expand */}
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-stone-950">{e.symbol}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          e.direction === "LONG"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {e.direction === "LONG" ? "Long" : "Short"}
                      </span>
                      {e.quantity !== null && (
                        <span className="text-xs text-stone-500">
                          {e.quantity} {e.quantity === 1 ? "contract" : "contracts"}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-stone-400">
                      {fmtDate(e.tradedAt, tz)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`font-mono text-sm font-medium ${pnl.cls}`}>
                      {pnl.text}
                    </span>
                    <span className="text-xs text-stone-300">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>
                {/* Second line: risk/R/breach (always visible) */}
                {(e.riskAmount !== null || e.rMultiple !== null || e.ruleBreached) && !isExpanded && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                    {e.riskAmount !== null && <span>Risk {fmtNum(e.riskAmount)}</span>}
                    {e.rMultiple !== null && <span>{fmtR(e.rMultiple)}</span>}
                    {e.ruleBreached && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">
                        Breach
                      </span>
                    )}
                  </div>
                )}
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-3 grid gap-2 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <PnlSourceBadge source={e.pnlSource} />
                    {e.ruleBreached && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        Rule breach
                      </span>
                    )}
                  </div>
                  <DetailRow label="Entry" value={fmtNum(e.entryPrice)} />
                  <DetailRow label="Exit" value={fmtNum(e.exitPrice)} />
                  <DetailRow label="Stop" value={fmtNum(e.stopPrice)} />
                  <DetailRow label="Target" value={fmtNum(e.targetPrice)} />
                  <DetailRow label="Quantity" value={e.quantity !== null ? String(e.quantity) : "—"} />
                  <DetailRow label="Gross P&L" value={e.grossPnl !== null ? fmtMoney(e.grossPnl).text : "—"} />
                  <DetailRow label="Fees" value={e.fees !== null ? fmtNum(e.fees) : "—"} />
                  <DetailRow label="Net P&L" value={pnl.text !== "—" ? pnl.text : "—"} />
                  <DetailRow label="Risk" value={fmtNum(e.riskAmount)} />
                  <DetailRow label="R" value={fmtR(e.rMultiple)} />
                  {e.strategy && <DetailRow label="Strategy" value={e.strategy} />}
                  {e.breachReason && <DetailRow label="Breach reason" value={e.breachReason} />}
                  {e.notes && (
                    <div className="mt-1 text-xs text-stone-500">
                      <span className="font-medium text-stone-600">Notes: </span>{e.notes}
                    </div>
                  )}

                  {isConfirming ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
                      <span className="text-xs text-stone-600">Delete this trade?</span>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleDelete(e.id)}
                        className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {isDeleting ? "Deleting..." : "Yes, delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setConfirmingDelete(null); setDeleteError(null); }}
                        className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600"
                      >
                        Cancel
                      </button>
                      {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
                    </div>
                  ) : (
                    <div className="mt-2 flex gap-2 border-t border-stone-100 pt-2">
                      <button
                        type="button"
                        onClick={() => onEdit(e)}
                        className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(e.id)}
                        className="rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table with expand rows */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              <th className="pb-3 pr-4">Date</th>
              <th className="pb-3 pr-4">Symbol</th>
              <th className="pb-3 pr-4">Dir</th>
              <th className="pb-3 pr-4">Entry</th>
              <th className="pb-3 pr-4">Exit</th>
              <th className="pb-3 pr-4">Qty</th>
              <th className="pb-3 pr-4">Gross P&L</th>
              <th className="pb-3 pr-4">Fees</th>
              <th className="pb-3 pr-4">Net P&L</th>
              <th className="pb-3 pr-4">Risk</th>
              <th className="pb-3 pr-4">R</th>
              <th className="pb-3 pr-4">Strategy</th>
              <th className="pb-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {entries.map((e) => {
              const pnl = fmtMoney(e.pnl);
              const isExpanded = expanded.has(e.id);
              const isConfirming = confirmingDelete === e.id;
              const isDeleting = deleting === e.id;

              return (
                <>
                  <tr
                    key={e.id}
                    className="cursor-pointer text-stone-700 hover:bg-stone-50"
                    onClick={() => toggle(e.id)}
                  >
                    <td className="py-3 pr-4 font-mono text-xs text-stone-400">
                      {fmtDate(e.tradedAt, tz)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-stone-950">{e.symbol}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          e.direction === "LONG"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {e.direction}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono">{fmtNum(e.entryPrice)}</td>
                    <td className="py-3 pr-4 font-mono">{fmtNum(e.exitPrice)}</td>
                    <td className="py-3 pr-4 font-mono">{e.quantity ?? "—"}</td>
                    <td className="py-3 pr-4 font-mono text-stone-500">
                      {e.grossPnl !== null ? fmtMoney(e.grossPnl).text : "—"}
                    </td>
                    <td className="py-3 pr-4 font-mono text-stone-500">
                      {e.fees !== null ? fmtNum(e.fees) : "—"}
                    </td>
                    <td className={`py-3 pr-4 font-mono ${pnl.cls}`}>{pnl.text}</td>
                    <td className="py-3 pr-4 font-mono text-stone-500">{fmtNum(e.riskAmount)}</td>
                    <td className="py-3 pr-4 font-mono text-stone-500">{fmtR(e.rMultiple)}</td>
                    <td className="py-3 pr-4 text-stone-500">{e.strategy ?? "—"}</td>
                    <td className="py-3" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(e)}
                          className="text-xs text-stone-500 hover:text-stone-950 underline-offset-2 hover:underline"
                        >
                          Edit
                        </button>
                        <span className="text-stone-200">|</span>
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(isConfirming ? null : e.id)}
                          className="text-xs text-red-500 hover:text-red-700 underline-offset-2 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={13} className="bg-stone-50 px-3 pb-4 pt-2">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                          <DetailRow label="Stop" value={fmtNum(e.stopPrice)} />
                          <DetailRow label="Target" value={fmtNum(e.targetPrice)} />
                          <DetailRow label="P&L source" value={e.pnlSource ?? "—"} />
                          {e.ruleBreached && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-stone-500">Rule breach:</span>
                              <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Yes</span>
                              {e.breachReason && <span className="text-stone-600">{e.breachReason}</span>}
                            </div>
                          )}
                          {e.notes && (
                            <div className="col-span-2 text-xs text-stone-500">
                              <span className="font-medium text-stone-600">Notes: </span>{e.notes}
                            </div>
                          )}
                        </div>
                        {isConfirming && (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-stone-600">Delete this trade?</span>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDelete(e.id)}
                              className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              {isDeleting ? "Deleting..." : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setConfirmingDelete(null); setDeleteError(null); }}
                              className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600"
                            >
                              Cancel
                            </button>
                            {deleteError && <span className="text-xs text-red-600">{deleteError}</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
