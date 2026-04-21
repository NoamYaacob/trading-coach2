import type {
  LiveEnforcementState,
  LiveEnforcementTier,
} from "@/lib/live-enforcement-state";
import {
  formatLiveEnforcementTierLabel,
  formatTriggerLabel,
} from "@/lib/live-enforcement-state";

function tierColors(tier: LiveEnforcementTier) {
  switch (tier) {
    case "lockdown":
      return {
        section: "border-red-300 bg-red-100",
        eyebrow: "text-red-700",
        badge: "bg-red-200 text-red-900",
        inner: "border-red-200 bg-red-50 text-red-900",
      };
    case "cooldown":
      return {
        section: "border-orange-300 bg-orange-50",
        eyebrow: "text-orange-700",
        badge: "bg-orange-200 text-orange-900",
        inner: "border-orange-200 bg-orange-50 text-orange-900",
      };
    case "hard_warning":
      return {
        section: "border-amber-300 bg-amber-50",
        eyebrow: "text-amber-700",
        badge: "bg-amber-200 text-amber-900",
        inner: "border-amber-200 bg-amber-50 text-amber-900",
      };
    case "soft_warning":
      return {
        section: "border-yellow-200 bg-yellow-50",
        eyebrow: "text-yellow-700",
        badge: "bg-yellow-200 text-yellow-900",
        inner: "border-yellow-200 bg-yellow-50 text-yellow-900",
      };
    default:
      return {
        section: "border-emerald-200 bg-emerald-50",
        eyebrow: "text-emerald-700",
        badge: "bg-emerald-100 text-emerald-900",
        inner: "border-emerald-200 bg-emerald-50 text-emerald-900",
      };
  }
}

function canTrade(state: LiveEnforcementState): boolean {
  return !state.cooldownActive && state.riskState !== "STOPPED";
}

function tradingStatusHeadline(state: LiveEnforcementState): string {
  if (state.cooldownActive) {
    const until = state.cooldownUntil
      ? ` until ${new Intl.DateTimeFormat("en-US", {
          timeStyle: "short",
        }).format(state.cooldownUntil)}`
      : "";
    return `Account on cooldown${until}.`;
  }
  if (state.riskState === "STOPPED") return "Account is locked — trading stopped.";
  if (state.riskState === "WARNING") return "Account in warning state — trade carefully.";
  return "Trading is open.";
}

function formatOutcomeLabel(outcome: string): string {
  const tier = outcome.split(":")[1];
  switch (tier) {
    case "soft_warning": return "Warning sent";
    case "hard_warning": return "Strong warning — account flagged";
    case "cooldown":     return "Cooldown applied";
    case "lockdown":     return "Account locked";
    default:             return outcome;
  }
}

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

type Props = {
  state: LiveEnforcementState;
  timeZone?: string;
};

export function LiveEnforcementPanel({ state }: Props) {
  const colors = tierColors(state.tier);
  const open = canTrade(state);
  const tierLabel = formatLiveEnforcementTierLabel(state.tier);

  return (
    <div
      className={`rounded-[1.9rem] border px-6 py-6 shadow-[0_24px_80px_-50px_rgba(28,25,23,0.45)] ${colors.section}`}
    >
      <div className="flex items-center justify-between gap-4">
        <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${colors.eyebrow}`}>
          Live enforcement · {state.accountLabel}
        </p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${colors.badge}`}
        >
          {tierLabel}
        </span>
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
        {tradingStatusHeadline(state)}
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/60 bg-white/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Today P&amp;L</p>
          <p
            className={`mt-1 text-lg font-semibold ${
              state.dailyPnl > 0
                ? "text-emerald-700"
                : state.dailyPnl < 0
                  ? "text-red-700"
                  : "text-stone-950"
            }`}
          >
            {state.dailyPnl >= 0 ? "+" : ""}
            {state.dailyPnl.toFixed(2)}
          </p>
          {state.rules.maxDailyLoss !== null ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Limit: {state.rules.maxDailyLoss.toFixed(2)}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Trades today</p>
          <p className="mt-1 text-lg font-semibold text-stone-950">
            {state.tradesCount}
          </p>
          {state.rules.maxTradesPerDay !== null ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Limit: {state.rules.maxTradesPerDay}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-white/60 bg-white/50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Losses in a row</p>
          <p className="mt-1 text-lg font-semibold text-stone-950">
            {state.consecutiveLosses}
          </p>
          {state.rules.stopAfterLosses !== null ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Stop at: {state.rules.stopAfterLosses}
            </p>
          ) : null}
        </div>
      </div>

      {state.lastIntervention ? (
        <div className={`mt-4 rounded-[1.5rem] border px-5 py-4 ${colors.inner}`}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
            Last intervention
          </p>
          <p className="mt-2 font-semibold">
            {formatTriggerLabel(state.lastIntervention.triggerType)}
          </p>
          <p className="mt-1 text-sm opacity-80">
            {formatOutcomeLabel(state.lastIntervention.outcome)} ·{" "}
            {formatDate(state.lastIntervention.createdAt)}
          </p>
          {state.lastIntervention.message ? (
            <p className="mt-2 text-sm opacity-80">{state.lastIntervention.message}</p>
          ) : null}
          {state.lastIntervention.sentAt ? (
            <p className="mt-1 text-xs opacity-60">
              Telegram sent {formatDate(state.lastIntervention.sentAt)}
            </p>
          ) : (
            <p className="mt-1 text-xs opacity-60">Telegram not sent</p>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div
          className={`flex items-center gap-2 rounded-full border border-white/50 bg-white/50 px-3 py-1.5 text-xs font-medium ${
            open ? "text-emerald-800" : "text-red-800"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${open ? "bg-emerald-500" : "bg-red-500"}`}
          />
          {open ? "Can trade now" : "Cannot trade now"}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/50 bg-white/50 px-3 py-1.5 text-xs font-medium text-stone-500">
          <span className="h-2 w-2 rounded-full bg-stone-400" />
          Broker stop: not available
        </div>
      </div>
    </div>
  );
}
