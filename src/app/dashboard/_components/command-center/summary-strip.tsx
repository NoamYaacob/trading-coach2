import type { CommandCenterSummary } from "./types";
import { formatBreakdownHint, TRADABLE_ACCOUNTS_TILE_LABEL } from "./summary-strip-helpers";

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatSignedCurrency(amount: number): string {
  if (amount === 0) return CURRENCY_FORMATTER.format(0);
  const formatted = CURRENCY_FORMATTER.format(Math.abs(amount));
  return amount < 0 ? `−${formatted}` : `+${formatted}`;
}

function pnlClass(amount: number): string {
  if (amount > 0) return "text-emerald-700";
  if (amount < 0) return "text-red-700";
  return "text-stone-900";
}

export function SummaryStrip({ summary }: { summary: CommandCenterSummary }) {
  const setupNeededCount = summary.counts.setup_needed + summary.counts.not_connected;

  return (
    <section
      aria-label="Account risk summary"
      className="overflow-x-hidden rounded-2xl border border-stone-200 bg-white/95 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)]"
    >
      {/* Featured financial row — Daily P&L and Loss Budget Left */}
      <div className="grid grid-cols-2 divide-x divide-stone-100 border-b border-stone-100">
        {/* Daily P&L */}
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            Daily P&L
          </p>
          <p
            className={`mt-1.5 font-mono text-2xl font-semibold tracking-tight sm:text-3xl ${
              summary.hasPnlData ? pnlClass(summary.totalDailyPnl) : "text-stone-300"
            }`}
          >
            {summary.hasPnlData ? formatSignedCurrency(summary.totalDailyPnl) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">
            {summary.hasPnlData ? "Across synced accounts" : "Awaiting first sync"}
          </p>
        </div>

        {/* Loss budget left */}
        <div className="px-4 py-4 sm:px-6 sm:py-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            Loss budget left
          </p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tracking-tight text-stone-950 sm:text-3xl">
            {summary.hasRiskData ? CURRENCY_FORMATTER.format(summary.totalRiskRemaining) : "—"}
          </p>
          <p className="mt-1 text-[11px] text-stone-400">
            {!summary.hasRiskData
              ? "Set rules to track"
              : summary.counts.locked > 0
                ? "Across all accounts · Excludes locked"
                : "Across all accounts"}
          </p>
        </div>
      </div>

      {/* Compact count row */}
      <div className="grid grid-cols-3 divide-x divide-stone-100 sm:grid-cols-6">
        {/* Active */}
        <div className="px-3 py-2.5 sm:px-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
            Active
          </p>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {summary.totalActive}
          </p>
        </div>

        {/* Tradable */}
        <div className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              {TRADABLE_ACCOUNTS_TILE_LABEL}
            </p>
          </div>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {summary.counts.allowed}
          </p>
          {formatBreakdownHint(summary.breakdown.allowed) ? (
            <p className="mt-0.5 text-[10px] text-stone-400">
              {formatBreakdownHint(summary.breakdown.allowed)}
            </p>
          ) : null}
        </div>

        {/* Warning */}
        <div className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Warning
            </p>
          </div>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {summary.counts.warning}
          </p>
          {formatBreakdownHint(summary.breakdown.warning) ? (
            <p className="mt-0.5 text-[10px] text-stone-400">
              {formatBreakdownHint(summary.breakdown.warning)}
            </p>
          ) : null}
        </div>

        {/* Locked */}
        <div className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Locked
            </p>
          </div>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {summary.counts.locked}
          </p>
          {formatBreakdownHint(summary.breakdown.locked) ? (
            <p className="mt-0.5 text-[10px] text-stone-400">
              {formatBreakdownHint(summary.breakdown.locked)}
            </p>
          ) : null}
        </div>

        {/* Setup needed */}
        <div className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" aria-hidden />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Setup
            </p>
          </div>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {setupNeededCount}
          </p>
          {summary.counts.not_connected > 0 ? (
            <p className="mt-0.5 text-[10px] text-stone-400">
              {summary.counts.not_connected} not connected
            </p>
          ) : null}
        </div>

        {/* Open issues */}
        <div className="px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${summary.openInterventions > 0 ? "bg-red-500" : "bg-stone-300"}`}
              aria-hidden
            />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
              Issues
            </p>
          </div>
          <p className="mt-0.5 font-mono text-base font-semibold text-stone-950">
            {summary.openInterventions}
          </p>
          {summary.openInterventions > 0 ? (
            <p className="mt-0.5 text-[10px] text-stone-400">Last 24h</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
