import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Journal — Guardrail",
};

type DecimalLike = { toNumber?: () => number } | string | number | null;

function toNum(val: DecimalLike): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  if (typeof val === "object" && typeof val.toNumber === "function") return val.toNumber();
  return null;
}

function fmt(val: DecimalLike): string {
  const n = toNum(val);
  if (n === null) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPnl(val: DecimalLike): { text: string; cls: string } {
  const n = toNum(val);
  if (n === null) return { text: "—", cls: "text-stone-400" };
  if (n > 0) return { text: `+$${n.toFixed(2)}`, cls: "text-emerald-700 font-medium" };
  if (n < 0) return { text: `−$${Math.abs(n).toFixed(2)}`, cls: "text-red-700 font-medium" };
  return { text: "$0.00", cls: "text-stone-500" };
}

function fmtR(val: DecimalLike): string {
  const n = toNum(val);
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export default async function JournalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const hasBroker = await prisma.connectedAccount
    .count({ where: { userId: user.id, isActive: true } })
    .then((c) => c > 0);

  const entries = await prisma.manualTradeEntry.findMany({
    where: { userId: user.id },
    orderBy: { tradedAt: "desc" },
    take: 100,
  });

  return (
    <AppShell
      eyebrow="Trade Journal"
      title="Your trade log."
      description={
        hasBroker
          ? "Trades from your connected broker appear here automatically. You can also add manual entries."
          : "Log trades manually to track your rule compliance, R-multiple, and session performance."
      }
    >
      <div className="grid gap-6">

        {/* Broker sync notice */}
        {hasBroker ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm">
            <p className="font-medium text-emerald-900">Broker sync active</p>
            <p className="mt-0.5 text-stone-700">
              Trades are imported automatically from your connected account. Manual entries are
              merged into the same log.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
            <p className="font-medium text-amber-900">Manual mode · Journal feeds enforcement</p>
            <p className="mt-0.5 text-stone-700">
              No broker connected — Guardian only sees trades you log here. Trade count, P&L, and loss streak rules all evaluate against this journal until a broker is connected.{" "}
              <a href="/accounts" className="font-medium text-stone-950 underline-offset-2 hover:underline">
                Connect a broker →
              </a>
            </p>
          </div>
        )}

        {/* Trade log */}
        <SectionCard
          title="Trade history"
          description="All trades, newest first."
        >
          {entries.length === 0 ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="grid gap-3">
                <p className="text-sm text-stone-600">
                  No trades logged yet. Use the form below to add your first trade, or connect a
                  broker for automatic import.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                  What gets tracked
                </p>
                <ul className="grid gap-1.5 text-stone-600">
                  <li>Symbol, direction, entry/exit prices</li>
                  <li>P&amp;L and R-multiple</li>
                  <li>Strategy tag</li>
                  <li>Rule breach flag</li>
                </ul>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Symbol</th>
                    <th className="pb-3 pr-4">Dir</th>
                    <th className="pb-3 pr-4">Entry</th>
                    <th className="pb-3 pr-4">Exit</th>
                    <th className="pb-3 pr-4">P&amp;L</th>
                    <th className="pb-3 pr-4">R</th>
                    <th className="pb-3 pr-4">Strategy</th>
                    <th className="pb-3">Breach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {entries.map((e) => {
                    const pnl = fmtPnl(e.pnl);
                    return (
                      <tr key={e.id} className="text-stone-700">
                        <td className="py-3 pr-4 font-mono text-xs text-stone-400">
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(e.tradedAt)}
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
                        <td className="py-3 pr-4 font-mono">{fmt(e.entryPrice)}</td>
                        <td className="py-3 pr-4 font-mono">{fmt(e.exitPrice)}</td>
                        <td className={`py-3 pr-4 font-mono ${pnl.cls}`}>{pnl.text}</td>
                        <td className="py-3 pr-4 font-mono text-stone-500">{fmtR(e.rMultiple)}</td>
                        <td className="py-3 pr-4 text-stone-500">{e.strategy ?? "—"}</td>
                        <td className="py-3">
                          {e.ruleBreached ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                              Yes
                            </span>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Add trade — placeholder until full form ships */}
        <SectionCard
          title="Add trade · Coming soon"
          description="Detailed trade entry (entry/exit, R-multiple, strategy tag, breach flag) is in progress."
        >
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
            <p>
              Until the full form ships, you can log basic session events (trade opened/closed, win, loss, P&L update) from the{" "}
              <a href="/dashboard" className="font-medium text-stone-950 underline-offset-2 hover:underline">
                Dashboard
              </a>
              . Those events feed Guardian's rule evaluation in manual mode.
            </p>
          </div>
        </SectionCard>

      </div>
    </AppShell>
  );
}
