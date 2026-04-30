"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

// Returns YYYY-MM-DD in the given timezone (sv-SE locale gives ISO date format).
function toDateKey(isoUtc: string, tz: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short" }).format(
    new Date(isoUtc),
  );
}

function formatDateLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === yesterdayKey) return "Yesterday";
  // Parse the YYYY-MM-DD key and format as "Apr 29, 2026".
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
}

function groupByDate(
  entries: TradeEntry[],
  tz: string,
): Array<{ label: string; entries: TradeEntry[] }> {
  const now = new Date();
  const todayKey = toDateKey(now.toISOString(), tz);
  const yesterdayKey = toDateKey(
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    tz,
  );

  // entries are newest-first; we accumulate in order to preserve that ordering.
  const seen: string[] = [];
  const map: Record<string, TradeEntry[]> = {};

  for (const e of entries) {
    const key = toDateKey(e.tradedAt, tz);
    if (!map[key]) {
      map[key] = [];
      seen.push(key);
    }
    map[key].push(e);
  }

  return seen.map((key) => ({
    label: formatDateLabel(key, todayKey, yesterdayKey),
    entries: map[key] ?? [],
  }));
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function JournalClientArea({
  entries,
  tz,
  windowStartIso,
}: {
  entries: TradeEntry[];
  tz: string;
  windowStartIso: string;
}) {
  const [editingTrade, setEditingTrade] = useState<TradeEntry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [olderOpen, setOlderOpen] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Split entries into today vs older. Entries from the server already exclude
  // future-dated rows (queried with `lte: now`), so the split is just by
  // whether the trade falls within today's trading-day window.
  const { todayEntries, olderEntries } = useMemo(() => {
    const today: TradeEntry[] = [];
    const older: TradeEntry[] = [];
    for (const e of entries) {
      if (e.tradedAt >= windowStartIso) today.push(e);
      else older.push(e);
    }
    return { todayEntries: today, olderEntries: older };
  }, [entries, windowStartIso]);

  const olderGroups = useMemo(
    () => groupByDate(olderEntries, tz),
    [olderEntries, tz],
  );

  // Scroll to the form panel whenever a trade is selected for editing.
  useEffect(() => {
    if (!editingTrade) return;
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [editingTrade?.id]);

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
      {/* Today's trades */}
      <SectionCard
        title="Today's trades"
        description={
          todayEntries.length > 0
            ? `${todayEntries.length} trade${todayEntries.length === 1 ? "" : "s"} logged today. Newest first.`
            : "No trades logged today."
        }
      >
        <TradeHistoryList entries={todayEntries} tz={tz} onEdit={handleEdit} />
      </SectionCard>

      {/* Older trades — collapsed by default, expanded on demand */}
      {olderEntries.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white/90">
          <button
            type="button"
            onClick={() => setOlderOpen((prev) => !prev)}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-stone-950"
          >
            <span className="flex items-center gap-3">
              Older trades
              {!olderOpen && (
                <span className="text-xs font-normal text-stone-400">
                  View previous trading days.
                </span>
              )}
            </span>
            <ChevronIcon open={olderOpen} />
          </button>

          {olderOpen && (
            <div className="px-5 pb-5 pt-0 grid gap-8">
              {olderGroups.map((group) => (
                <div key={group.label}>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                    {group.label}
                  </p>
                  <TradeHistoryList entries={group.entries} tz={tz} onEdit={handleEdit} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit trade panel */}
      <div ref={formRef} className="rounded-2xl border border-stone-200 bg-white/90">
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
