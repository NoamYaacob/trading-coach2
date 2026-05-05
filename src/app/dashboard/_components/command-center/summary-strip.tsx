import type { CommandCenterSummary } from "./types";

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

type Tile = {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  dotClass?: string;
};

export function SummaryStrip({ summary }: { summary: CommandCenterSummary }) {
  const tiles: Tile[] = [
    {
      label: "Active accounts",
      value: summary.totalActive.toString(),
    },
    {
      label: "Allowed",
      value: summary.counts.allowed.toString(),
      dotClass: "bg-emerald-500",
    },
    {
      label: "Warning",
      value: summary.counts.warning.toString(),
      dotClass: "bg-amber-400",
    },
    {
      label: "Locked",
      value: summary.counts.locked.toString(),
      dotClass: "bg-red-500",
    },
    {
      label: "Setup needed",
      value: (summary.counts.setup_needed + summary.counts.not_connected).toString(),
      dotClass: "bg-stone-400",
      hint:
        summary.counts.not_connected > 0
          ? `${summary.counts.not_connected} not connected`
          : undefined,
    },
    {
      label: "Daily P&L",
      value: summary.hasPnlData ? formatSignedCurrency(summary.totalDailyPnl) : "—",
      valueClass: summary.hasPnlData ? pnlClass(summary.totalDailyPnl) : undefined,
      hint: summary.hasPnlData ? "Across synced accounts" : "Awaiting first sync",
    },
    {
      label: "Loss budget left",
      value: summary.hasRiskData ? CURRENCY_FORMATTER.format(summary.totalRiskRemaining) : "—",
      hint: !summary.hasRiskData
        ? "Set rules to track"
        : summary.counts.locked > 0
          ? "Excludes locked accounts"
          : "Based on configured rules",
    },
    {
      label: "Open issues",
      value: summary.openInterventions.toString(),
      dotClass: summary.openInterventions > 0 ? "bg-red-500" : "bg-stone-300",
      hint: summary.openInterventions > 0 ? "Last 24h" : undefined,
    },
  ];

  return (
    <section
      aria-label="Account risk summary"
      className="overflow-x-hidden rounded-2xl border border-stone-200 bg-white/95 p-2.5 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)] sm:p-4"
    >
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2 lg:grid-cols-8 lg:gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-stone-100 bg-stone-50/60 px-2.5 py-2 sm:px-3.5 sm:py-3"
          >
            <div className="flex items-center gap-1.5">
              {tile.dotClass ? (
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tile.dotClass}`} aria-hidden />
              ) : null}
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                {tile.label}
              </p>
            </div>
            <p
              className={`mt-1 font-mono text-base font-semibold tracking-tight sm:mt-1.5 sm:text-lg ${tile.valueClass ?? "text-stone-950"}`}
            >
              {tile.value}
            </p>
            {tile.hint ? (
              <p className="mt-0.5 text-[10px] text-stone-400">{tile.hint}</p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
