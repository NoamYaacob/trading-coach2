import Link from "next/link";
import type {
  LiveEnforcementState,
  LiveEnforcementTier,
} from "@/lib/live-enforcement-state";
import {
  formatLiveEnforcementTierLabel,
  deriveLiveStatusMessage,
} from "@/lib/live-enforcement-state";

function tierColors(tier: LiveEnforcementTier) {
  switch (tier) {
    case "lockdown":
      return {
        shell: "border-red-300 bg-[linear-gradient(135deg,rgba(254,226,226,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-red-600 text-white",
        accent: "text-red-700",
        inner: "border-red-200 bg-red-50",
        innerText: "text-red-900",
        scopeBg: "border-red-200 bg-red-50",
        scopeText: "text-red-800",
      };
    case "cooldown":
      return {
        shell: "border-orange-300 bg-[linear-gradient(135deg,rgba(255,237,213,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-orange-600 text-white",
        accent: "text-orange-700",
        inner: "border-orange-200 bg-orange-50",
        innerText: "text-orange-900",
        scopeBg: "border-orange-200 bg-orange-50",
        scopeText: "text-orange-800",
      };
    case "hard_warning":
      return {
        shell: "border-amber-300 bg-[linear-gradient(135deg,rgba(254,243,199,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-amber-500 text-white",
        accent: "text-amber-700",
        inner: "border-amber-200 bg-amber-50",
        innerText: "text-amber-900",
        scopeBg: "border-amber-200 bg-amber-50",
        scopeText: "text-amber-800",
      };
    case "soft_warning":
      return {
        shell: "border-yellow-200 bg-[linear-gradient(135deg,rgba(254,249,195,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-yellow-500 text-white",
        accent: "text-yellow-700",
        inner: "border-yellow-200 bg-yellow-50",
        innerText: "text-yellow-900",
        scopeBg: "border-stone-200 bg-stone-50",
        scopeText: "text-stone-700",
      };
    default:
      return {
        shell: "border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-emerald-600 text-white",
        accent: "text-emerald-700",
        inner: "border-emerald-200 bg-emerald-50",
        innerText: "text-emerald-900",
        scopeBg: "border-stone-200 bg-stone-50",
        scopeText: "text-stone-700",
      };
  }
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

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function canTrade(state: LiveEnforcementState): boolean {
  return !state.cooldownActive && state.riskState !== "STOPPED";
}

type Props = {
  state: LiveEnforcementState;
  timeZone?: string;
};

export function LiveEnforcementPanel({ state }: Props) {
  const colors = tierColors(state.tier);
  const tierLabel = formatLiveEnforcementTierLabel(state.tier);
  const msg = deriveLiveStatusMessage(state);
  const open = canTrade(state);

  return (
    <section
      className={`w-full min-w-0 rounded-[2rem] border px-4 py-5 shadow-[0_25px_70px_-45px_rgba(28,25,23,0.4)] sm:px-6 sm:py-6 ${colors.shell}`}
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
        {/* Left column: headline + intervention context + what next */}
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${colors.chip}`}
            >
              {tierLabel}
            </span>
            <span className="text-xs text-stone-500">{state.accountLabel}</span>
          </div>

          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
            {msg.headline}
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-700">
            {msg.detail}
          </p>

          {/* Why triggered — shown when an intervention exists */}
          {state.lastIntervention ? (
            <div className={`mt-5 rounded-[1.4rem] border px-5 py-4 ${colors.inner}`}>
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] opacity-70 ${colors.innerText}`}>
                Why this triggered
              </p>
              <p className={`mt-2 font-semibold ${colors.innerText}`}>
                {msg.whyLabel}
              </p>
              {state.lastIntervention.message ? (
                <p className={`mt-1 text-sm opacity-80 ${colors.innerText}`}>
                  {state.lastIntervention.message}
                </p>
              ) : null}
              <p className={`mt-2 text-xs opacity-60 ${colors.innerText}`}>
                {formatOutcomeLabel(state.lastIntervention.outcome)} ·{" "}
                {formatTime(state.lastIntervention.createdAt)}
              </p>
              <p className={`mt-0.5 text-xs opacity-60 ${colors.innerText}`}>
                {state.lastIntervention.sentAt
                  ? `Telegram sent ${formatTime(state.lastIntervention.sentAt)}`
                  : "Telegram: not sent"}
              </p>
            </div>
          ) : null}

          {/* What to do next */}
          <div className="mt-5 rounded-[1.4rem] border border-white/70 bg-white/80 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              What to do next
            </p>
            <p className="mt-2 text-base font-medium text-stone-950">{msg.whatNext}</p>
            <Link
              href="/accounts"
              className="mt-4 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
            >
              View account details
            </Link>
          </div>
        </div>

        {/* Right column: stats + enforcement scope */}
        <div className="grid gap-3">
          {/* Stats */}
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Today P&amp;L
              </p>
              <p
                className={`mt-2 text-lg font-semibold tabular-nums ${
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
                <p className="mt-1 text-sm text-stone-500">
                  Limit: {state.rules.maxDailyLoss.toFixed(2)}
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Completed trades
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {state.tradesCount}
                {state.rules.maxTradesPerDay !== null ? ` / ${state.rules.maxTradesPerDay}` : ""}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                {state.consecutiveLosses > 0
                  ? state.rules.stopAfterLosses !== null
                    ? `${state.consecutiveLosses} / ${state.rules.stopAfterLosses} losses in a row`
                    : `${state.consecutiveLosses} consecutive loss${state.consecutiveLosses !== 1 ? "es" : ""}`
                  : "No loss streak"}
              </p>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Account status
              </p>
              <p className={`mt-2 text-lg font-semibold ${colors.accent}`}>
                {open ? "Can trade" : "Cannot trade"}
              </p>
              <p className="mt-1 text-sm text-stone-500">
                {open
                  ? "No hard limit active"
                  : state.cooldownActive
                    ? "Cooldown in effect"
                    : "Hard stop applied"}
              </p>
            </div>
          </div>

          {/* Enforcement scope — explicit, always shown */}
          <div className={`rounded-2xl border px-4 py-4 ${colors.scopeBg}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] opacity-70 ${colors.scopeText}`}>
              Enforcement scope
            </p>
            <div className={`mt-3 grid gap-2 text-sm ${colors.scopeText}`}>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  <span className="font-medium">Guardian monitoring active</span> — Guardrail sets
                  account state and sends Telegram alerts.
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-stone-300" />
                <span>
                  <span className="font-medium">Broker-level enforcement: coming soon</span> — Live
                  orders at the broker are not cancelled or blocked yet.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
