import Link from "next/link";

import type { ManualRiskState } from "@/lib/manual-risk-state";

type Props = {
  state: ManualRiskState;
  hasRules: boolean;
  /** When true, hide the "Edit rules" CTA (e.g. on Guardian which has its own). */
  hideEditRulesCta?: boolean;
};

function styles(permission: ManualRiskState["permission"]) {
  switch (permission) {
    case "LOCKED":
      return {
        shell: "border-red-300 bg-red-50",
        chip: "bg-red-600 text-white",
        accent: "text-red-700",
        label: "Locked",
      };
    case "WARNING":
      return {
        shell: "border-amber-300 bg-amber-50",
        chip: "bg-amber-500 text-white",
        accent: "text-amber-700",
        label: "Warning",
      };
    default:
      return {
        shell: "border-emerald-200 bg-emerald-50",
        chip: "bg-emerald-600 text-white",
        accent: "text-emerald-700",
        label: "Safe",
      };
  }
}

function fmtMoney(n: number): string {
  return `${n >= 0 ? "" : "−"}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function headlineFor(state: ManualRiskState, hasRules: boolean): string {
  if (!hasRules) return "No risk rules set yet.";
  if (state.permission === "LOCKED") {
    switch (state.blockReason) {
      case "daily_loss_limit":
        return "Trading is locked — daily loss limit reached.";
      case "daily_profit_target":
        return "Trading is locked — daily profit target reached.";
      case "max_trades":
        return "Trading is locked — max trades for today reached.";
      case "stop_after_losses":
        return "Trading is locked — consecutive loss stop hit.";
      default:
        return "Trading is locked.";
    }
  }
  if (state.permission === "WARNING") return "Trading is open — limits are close.";
  return "Trading is open. All limits clear.";
}

function detailFor(state: ManualRiskState, hasRules: boolean): string {
  if (!hasRules) {
    return "Set your risk rules so Guardrail can calculate today's permission.";
  }
  if (state.permission === "LOCKED") {
    return state.lastBreach?.detail ?? "A daily limit was reached. New trades you log are still recorded but flagged.";
  }
  if (state.permission === "WARNING") {
    const notes: string[] = [];
    if (state.approachingDailyLoss) notes.push("approaching daily loss limit");
    if (state.approachingMaxTrades) notes.push("one trade left before max");
    if (state.approachingLossStreak) notes.push("one more loss triggers your stop");
    if (state.riskPerTradeExceeded) notes.push("a trade exceeded max risk per trade");
    if (state.ruleBreachesToday > 0) notes.push(`${state.ruleBreachesToday} rule breach${state.ruleBreachesToday > 1 ? "es" : ""} logged`);
    if (notes.length === 0) return "One or more rules are approaching their thresholds.";
    return `Heads up: ${notes.join(", ")}.`;
  }
  return "No rule limits hit yet today. Manual Mode evaluates trades as you log them.";
}

export function ManualRiskPanel({ state, hasRules, hideEditRulesCta }: Props) {
  const s = styles(state.permission);

  const tiles = [
    {
      label: "Today P&L",
      value: fmtMoney(state.todayPnL),
      cls:
        state.todayPnL > 0
          ? "text-emerald-700"
          : state.todayPnL < 0
            ? "text-red-700"
            : "text-stone-950",
    },
    {
      label: "Trades taken",
      value:
        state.remainingTrades !== null
          ? `${state.todayTradesCount} / ${state.todayTradesCount + state.remainingTrades}`
          : String(state.todayTradesCount),
    },
    {
      label: "Risk budget left",
      value:
        state.remainingDailyLossBudget !== null
          ? fmtMoney(state.remainingDailyLossBudget)
          : "—",
      cls: state.remainingDailyLossBudget !== null && state.remainingDailyLossBudget > 0 ? "text-stone-950" : "text-stone-400",
    },
    {
      label: "Loss streak",
      value: String(state.consecutiveLosses),
    },
  ];

  return (
    <section className={`rounded-[2rem] border px-6 py-6 shadow-[0_24px_70px_-50px_rgba(28,25,23,0.4)] ${s.shell}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${s.chip}`}>
          {s.label}
        </span>
        <span className="text-xs text-stone-500">Manual Mode · App-level enforcement</span>
      </div>

      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
        {headlineFor(state, hasRules)}
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">{detailFor(state, hasRules)}</p>

      {/* Tiles */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{t.label}</p>
            <p className={`mt-1.5 text-lg font-semibold tabular-nums ${t.cls ?? "text-stone-950"}`}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      {/* Profit progress (only when target set) */}
      {state.dailyProfitTargetProgress !== null && (
        <div className="mt-5 rounded-2xl border border-white/70 bg-white/80 px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
              Daily profit target
            </p>
            <p className="text-xs font-medium text-stone-700 tabular-nums">
              {Math.round(state.dailyProfitTargetProgress * 100)}%
            </p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full ${state.dailyProfitTargetHit ? "bg-emerald-600" : "bg-stone-700"}`}
              style={{ width: `${Math.round(state.dailyProfitTargetProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Last breach */}
      {state.lastBreach && (
        <div className="mt-5 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${s.accent}`}>
            Last breach · {state.lastBreach.label}
          </p>
          <p className="mt-1 text-stone-700">{state.lastBreach.detail}</p>
        </div>
      )}

      {/* Footer note + CTAs */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/60 pt-4 text-xs text-stone-500">
        <span>
          Manual Mode calculates risk from trades logged in{" "}
          <Link href="/journal" className="font-medium text-stone-700 underline-offset-2 hover:underline">
            Journal
          </Link>
          .
        </span>
        {!hideEditRulesCta && (
          <Link
            href="/rules"
            className="ml-auto rounded-full border border-stone-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-800 hover:border-stone-950 hover:text-stone-950"
          >
            Edit rules →
          </Link>
        )}
      </div>

      {state.permission === "LOCKED" && (
        <p className="mt-3 text-xs text-stone-500">
          Manual Mode lock applies inside Guardrail only. Broker-level blocking requires a supported broker connection.
        </p>
      )}
    </section>
  );
}
