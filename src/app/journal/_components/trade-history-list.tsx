"use client";

import { Fragment, useState } from "react";

import { getProduct } from "@/lib/trading-products";

import type { TradeEntry } from "./types";

const GROUP_LABELS: Record<string, string> = {
  "cme-equity": "CME Equity",
  "cme-fx": "CME FX",
  "cme-ag-livestock": "CME Livestock",
  "nymex-energy-metals": "NYMEX Energy/Metals",
  "cbot-ag": "CBOT Grains",
  "cbot-equity": "CBOT Equity",
  "cbot-rates": "CBOT Rates",
  "comex-metals": "COMEX Metals",
};

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

function DirectionBadge({ direction }: { direction: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        direction === "LONG" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
      }`}
    >
      {direction === "LONG" ? "Long" : "Short"}
    </span>
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

function ProductInfo({ symbol }: { symbol: string }) {
  const product = getProduct(symbol);
  if (!product) {
    return (
      <div className="text-xs text-stone-500">
        Unrecognized product — specs not added yet.
      </div>
    );
  }
  const groupLabel = GROUP_LABELS[product.group] ?? product.group;
  return (
    <div className="text-xs text-stone-500">
      <span className="text-stone-700 font-medium">{product.name}</span>
      <span className="mx-1.5 text-stone-300">·</span>
      <span>{groupLabel}</span>
      {product.specStatus === "recognized_only" && (
        <>
          <span className="mx-1.5 text-stone-300">·</span>
          <span className="text-amber-700">Specs not added yet</span>
        </>
      )}
    </div>
  );
}

function PnlDetails({ entry }: { entry: TradeEntry }) {
  const pnl = fmtMoney(entry.pnl);
  const source = entry.pnlSource;

  if (source === "override") {
    const expectedNet =
      entry.grossPnl !== null && entry.fees !== null
        ? entry.grossPnl - entry.fees
        : null;
    return (
      <>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          Override — net P&L entered manually
        </div>
        <DetailRow label="Gross P&L" value={entry.grossPnl !== null ? fmtMoney(entry.grossPnl).text : "—"} />
        <DetailRow label="Fees" value={entry.fees !== null ? fmtNum(entry.fees) : "—"} />
        {expectedNet !== null && (
          <DetailRow label="Expected net" value={fmtMoney(expectedNet).text} />
        )}
        <DetailRow label="Override net P&L" value={pnl.text} />
      </>
    );
  }

  if (source === "calculated") {
    return (
      <>
        <DetailRow label="Gross P&L" value={entry.grossPnl !== null ? fmtMoney(entry.grossPnl).text : "—"} />
        <DetailRow label="Fees" value={entry.fees !== null ? fmtNum(entry.fees) : "—"} />
        <DetailRow label="Net P&L" value={pnl.text} />
      </>
    );
  }

  // Broker-reported net P&L (pnlSource null or unrecognized)
  return <DetailRow label="Net P&L" value={pnl.text} />;
}

export function TradeHistoryList({
  entries,
  tz,
}: {
  entries: TradeEntry[];
  tz: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-stone-50 px-6 py-8 text-center">
        <p className="text-base font-semibold text-stone-800">No synced trades found for this session</p>
        <p className="mt-2 text-sm text-stone-600">Trades appear here once your broker account is connected and syncing.</p>
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

          return (
            <div key={e.id} className="py-3">
              <button
                type="button"
                onClick={() => toggle(e.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-stone-950">{e.symbol}</span>
                      <DirectionBadge direction={e.direction} />
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
                    <ChevronIcon open={isExpanded} />
                  </div>
                </div>
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

              {isExpanded && (
                <div className="mt-3 grid gap-2 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <ProductInfo symbol={e.symbol} />
                  {e.ruleBreached && (
                    <span className="self-start rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      Rule breach
                    </span>
                  )}

                  <DetailRow label="Entry" value={fmtNum(e.entryPrice)} />
                  <DetailRow label="Exit" value={fmtNum(e.exitPrice)} />
                  <DetailRow label="Stop" value={fmtNum(e.stopPrice)} />
                  <DetailRow label="Target" value={fmtNum(e.targetPrice)} />
                  <DetailRow label="Quantity" value={e.quantity !== null ? String(e.quantity) : "—"} />

                  <div className="my-0.5 border-t border-stone-100" />
                  <PnlDetails entry={e} />
                  <DetailRow label="Risk" value={fmtNum(e.riskAmount)} />
                  <DetailRow label="R" value={fmtR(e.rMultiple)} />

                  {(e.strategy || e.breachReason || e.notes) && (
                    <div className="my-0.5 border-t border-stone-100" />
                  )}
                  {e.strategy && <DetailRow label="Strategy" value={e.strategy} />}
                  {e.breachReason && <DetailRow label="Breach reason" value={e.breachReason} />}
                  {e.notes && (
                    <div className="text-xs text-stone-500">
                      <span className="font-medium text-stone-600">Notes: </span>{e.notes}
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
              <th className="pb-3">Strategy</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {entries.map((e) => {
              const pnl = fmtMoney(e.pnl);
              const isExpanded = expanded.has(e.id);

              return (
                <Fragment key={e.id}>
                  <tr
                    className="cursor-pointer text-stone-700 hover:bg-stone-50"
                    onClick={() => toggle(e.id)}
                  >
                    <td className="py-3 pr-4 font-mono text-xs text-stone-400">
                      {fmtDate(e.tradedAt, tz)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-stone-950">{e.symbol}</td>
                    <td className="py-3 pr-4">
                      <DirectionBadge direction={e.direction} />
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
                    <td className="py-3 text-stone-500">{e.strategy ?? "—"}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={12} className="bg-stone-50 px-3 pb-4 pt-2">
                        <div className="mb-2">
                          <ProductInfo symbol={e.symbol} />
                        </div>
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                          <DetailRow label="Stop" value={fmtNum(e.stopPrice)} />
                          <DetailRow label="Target" value={fmtNum(e.targetPrice)} />
                          {e.pnlSource && e.pnlSource !== "manual" && (
                            <div className="text-xs text-stone-500">
                              Source:{" "}
                              <span className="font-medium text-stone-700">
                                {e.pnlSource === "calculated" ? "Calculated" : "Override"}
                              </span>
                            </div>
                          )}
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
