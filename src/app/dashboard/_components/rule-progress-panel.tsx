export type RuleProgressPanelProps = {
  todayPnL: number;
  todayTradesCount: number;
  consecutiveLosses: number;
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  dailyProfitTarget: number | null;
  dataSource: "broker" | "none";
};

type BarColor = "emerald" | "green" | "amber" | "red";

function lossBarColor(pct: number): BarColor {
  if (pct >= 0.8) return "red";
  if (pct >= 0.5) return "amber";
  return "green";
}

const BAR_TRACK = "h-2 w-full rounded-full bg-stone-100";
const BAR_FILL: Record<BarColor, string> = {
  emerald: "bg-emerald-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};
const VALUE_COLOR: Record<BarColor, string> = {
  emerald: "text-emerald-600",
  green: "text-stone-800",
  amber: "text-amber-600",
  red: "text-red-600",
};

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function ProgressBar({ pct, color }: { pct: number; color: BarColor }) {
  const clampedPct = Math.min(Math.max(pct, 0), 1);
  return (
    <div className={BAR_TRACK} role="presentation">
      <div
        className={`h-full rounded-full transition-all ${BAR_FILL[color]}`}
        style={{ width: `${Math.round(clampedPct * 100)}%` }}
      />
    </div>
  );
}

type RuleRowProps = {
  label: string;
  current: string;
  limit: string;
  pct: number;
  color: BarColor;
};

function RuleRow({ label, current, limit, pct, color }: RuleRowProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <span className="shrink-0 text-xs">
          <span className={`font-semibold ${VALUE_COLOR[color]}`}>{current}</span>
          <span className="text-stone-400"> / {limit}</span>
        </span>
      </div>
      <ProgressBar pct={pct} color={color} />
    </div>
  );
}

export function RuleProgressPanel({
  todayPnL,
  todayTradesCount,
  consecutiveLosses,
  maxDailyLoss,
  maxTradesPerDay,
  stopAfterLosses,
  dailyProfitTarget,
  dataSource,
}: RuleProgressPanelProps) {
  const rows: RuleRowProps[] = [];

  if (maxDailyLoss !== null && maxDailyLoss > 0) {
    const loss = Math.max(-todayPnL, 0);
    const pct = loss / maxDailyLoss;
    rows.push({
      label: "Daily loss",
      current: fmt(-loss),
      limit: fmt(-maxDailyLoss),
      pct,
      color: lossBarColor(pct),
    });
  }

  if (maxTradesPerDay !== null && maxTradesPerDay > 0) {
    const pct = todayTradesCount / maxTradesPerDay;
    rows.push({
      label: "Trades today",
      current: String(todayTradesCount),
      limit: String(maxTradesPerDay),
      pct,
      color: lossBarColor(pct),
    });
  }

  if (stopAfterLosses !== null && stopAfterLosses > 0) {
    const pct = consecutiveLosses / stopAfterLosses;
    rows.push({
      label: "Loss streak",
      current: String(consecutiveLosses),
      limit: String(stopAfterLosses),
      pct,
      color: lossBarColor(pct),
    });
  }

  if (dailyProfitTarget !== null && dailyProfitTarget > 0) {
    const progress = Math.max(todayPnL, 0);
    const pct = progress / dailyProfitTarget;
    rows.push({
      label: "Daily profit target",
      current: fmt(progress),
      limit: fmt(dailyProfitTarget),
      pct: Math.min(pct, 1),
      color: "emerald",
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white/90 px-5 py-5 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)]">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
          Rule progress
        </p>
        <p className="text-sm text-stone-500">
          No limits configured.{" "}
          <a
            href="/rules"
            className="font-medium text-stone-700 underline-offset-2 hover:underline"
          >
            Set rules →
          </a>
        </p>
      </div>
    );
  }

  const sourceLabel = dataSource === "broker" ? "From broker data" : null;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white/90 px-5 py-5 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
          Rule progress
        </p>
        {sourceLabel && (
          <span className="text-xs text-stone-400">{sourceLabel}</span>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <RuleRow key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}
