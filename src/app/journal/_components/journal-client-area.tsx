"use client";

import { useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { TradeEntryForm } from "./trade-entry-form";
import { TradeHistoryList } from "./trade-history-list";
import type { TradeEntry } from "./types";

function toLocalIsoMinute(isoUtc: string): string {
  const d = new Date(isoUtc);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function entryToFormValues(e: TradeEntry) {
  return {
    tradedAt: toLocalIsoMinute(e.tradedAt),
    symbol: e.symbol,
    direction: e.direction as "LONG" | "SHORT",
    entryPrice: e.entryPrice?.toString() ?? "",
    exitPrice: e.exitPrice?.toString() ?? "",
    stopPrice: e.stopPrice?.toString() ?? "",
    targetPrice: e.targetPrice?.toString() ?? "",
    quantity: e.quantity?.toString() ?? "",
    netPnl: e.pnl?.toString() ?? "",
    fees: e.fees?.toString() ?? "",
    riskAmount: e.riskAmount?.toString() ?? "",
    rMultiple: e.rMultiple?.toString() ?? "",
    strategy: e.strategy ?? "",
    notes: e.notes ?? "",
    ruleBreached: e.ruleBreached,
    breachReason: e.breachReason ?? "",
    overrideCalculated: e.pnlSource === "override",
  };
}

export function JournalClientArea({
  entries,
  tz,
}: {
  entries: TradeEntry[];
  tz: string;
}) {
  const [editingTrade, setEditingTrade] = useState<TradeEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  function handleEdit(entry: TradeEntry) {
    setEditingTrade(entry);
    setFormOpen(true);
  }

  function handleFormDone() {
    setEditingTrade(null);
    setFormOpen(false);
  }

  return (
    <>
      <SectionCard
        title="Trade history"
        description={
          entries.length > 0
            ? `${entries.length} trade${entries.length === 1 ? "" : "s"} logged. Newest first.`
            : "No trades logged for this session."
        }
      >
        <TradeHistoryList entries={entries} tz={tz} onEdit={handleEdit} />
      </SectionCard>

      {/* Add / Edit trade panel */}
      <div className="rounded-2xl border border-stone-200 bg-white/90">
        <button
          type="button"
          onClick={() => {
            if (formOpen) {
              handleFormDone();
            } else {
              setFormOpen(true);
            }
          }}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-stone-950"
        >
          {editingTrade ? `Edit trade — ${editingTrade.symbol}` : "Add manual trade"}
          <span className={`text-xs font-normal text-stone-400 transition-transform ${formOpen ? "rotate-45" : ""}`}>
            +
          </span>
        </button>
        {formOpen && (
          <div className="px-5 pb-5 pt-0">
            <TradeEntryForm
              key={editingTrade?.id ?? "new"}
              tradeId={editingTrade?.id}
              initialValues={editingTrade ? entryToFormValues(editingTrade) : undefined}
              onSaved={handleFormDone}
              onCancel={handleFormDone}
            />
          </div>
        )}
      </div>
    </>
  );
}
