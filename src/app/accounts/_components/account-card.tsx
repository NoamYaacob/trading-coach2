import Link from "next/link";
import type { ConnectedAccount, AccountRiskRules, LiveSessionState, GuardianIntervention } from "@prisma/client";
import { SectionCard } from "@/components/ui/section-card";

type AccountWithRelations = ConnectedAccount & {
  riskRules: AccountRiskRules | null;
  sessionState: LiveSessionState | null;
  interventions: GuardianIntervention[];
};

const RISK_STATE_STYLE = {
  NORMAL: { label: "Normal", card: "border-emerald-200 bg-emerald-50", text: "text-emerald-700" },
  WARNING: { label: "Warning", card: "border-amber-200 bg-amber-50", text: "text-amber-700" },
  STOPPED: { label: "Stopped", card: "border-red-200 bg-red-50", text: "text-red-700" },
};

const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
  manual: "Manual",
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

const OUTCOME_LABEL: Record<string, string> = {
  warning: "Warning",
  stop: "Stop",
  cooldown: "Cooldown",
  telegram_message_trigger: "Coaching message",
};

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function AccountCard({ account }: { account: AccountWithRelations }) {
  const { sessionState, riskRules, interventions } = account;

  const riskState = (sessionState?.riskState ?? "NORMAL") as keyof typeof RISK_STATE_STYLE;
  const riskStyle = RISK_STATE_STYLE[riskState] ?? RISK_STATE_STYLE.NORMAL;

  const dailyPnl = sessionState ? Number(sessionState.dailyPnl) : 0;
  const pnlClass = dailyPnl > 0 ? "text-emerald-700" : dailyPnl < 0 ? "text-red-700" : "text-stone-950";

  const subtitle = [
    PLATFORM_LABEL[account.platform] ?? account.platform,
    account.propFirm ?? null,
    ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType,
    account.currency,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasAnyRule = riskRules != null && (
    riskRules.maxDailyLoss != null ||
    riskRules.maxTradesPerDay != null ||
    riskRules.stopAfterLosses != null ||
    riskRules.riskPerTrade != null ||
    (riskRules.allowedStartHour != null && riskRules.allowedEndHour != null)
  );

  return (
    <SectionCard title={account.label} description={subtitle}>
      <div className="grid gap-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className={`rounded-2xl border px-4 py-4 ${riskStyle.card}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${riskStyle.text} opacity-80`}>
              Guardian state
            </p>
            <p className={`mt-2 text-lg font-semibold ${riskStyle.text}`}>{riskStyle.label}</p>
            {sessionState?.cooldownActive ? (
              <p className={`mt-1 text-sm ${riskStyle.text}`}>
                Cooldown
                {sessionState.cooldownUntil ? ` until ${shortDate(sessionState.cooldownUntil)}` : " active"}
              </p>
            ) : (
              <p className={`mt-1 text-sm opacity-60 ${riskStyle.text}`}>No cooldown</p>
            )}
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Daily P&amp;L</p>
            <p className={`mt-2 text-lg font-semibold tabular-nums ${pnlClass}`}>
              {dailyPnl >= 0 ? "+" : ""}
              {dailyPnl.toFixed(2)}
            </p>
            <p className="mt-1 text-sm text-stone-500">{account.currency}</p>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Trades today</p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {sessionState?.tradesCount ?? 0}
              {riskRules?.maxTradesPerDay != null ? ` / ${riskRules.maxTradesPerDay}` : ""}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {(sessionState?.consecutiveLosses ?? 0) > 0
                ? `${sessionState?.consecutiveLosses} consecutive losses`
                : "No loss streak"}
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Account</p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {account.isActive ? "Active" : "Inactive"}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {account.externalAccountId ? `ID: ${account.externalAccountId}` : "No external ID"}
            </p>
          </div>
        </div>

        {hasAnyRule ? (
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Account rules
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-700">
              {riskRules.maxDailyLoss != null && (
                <span>Max daily loss: {Number(riskRules.maxDailyLoss)}</span>
              )}
              {riskRules.maxTradesPerDay != null && (
                <span>Max trades/day: {riskRules.maxTradesPerDay}</span>
              )}
              {riskRules.stopAfterLosses != null && (
                <span>Stop after losses: {riskRules.stopAfterLosses}</span>
              )}
              {riskRules.riskPerTrade != null && (
                <span>Risk/trade: {Number(riskRules.riskPerTrade)}</span>
              )}
              {riskRules.allowedStartHour != null && riskRules.allowedEndHour != null && (
                <span>
                  Hours: {riskRules.allowedStartHour}:00–{riskRules.allowedEndHour}:00 UTC
                </span>
              )}
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Recent interventions
          </p>
          {interventions.length === 0 ? (
            <p className="text-sm text-stone-500">No interventions yet.</p>
          ) : (
            <div className="grid gap-2">
              {interventions.map((item) => {
                const isStop = item.outcome === "stop" || item.outcome === "cooldown";
                const isWarn = item.outcome === "warning";
                const borderBg = isStop
                  ? "border-red-200 bg-red-50"
                  : isWarn
                    ? "border-amber-200 bg-amber-50"
                    : "border-stone-200 bg-stone-50";
                return (
                  <div key={item.id} className={`rounded-xl border px-4 py-3 text-sm ${borderBg}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid gap-0.5">
                        <p className="font-medium text-stone-950">
                          {OUTCOME_LABEL[item.outcome] ?? item.outcome}
                          <span className="font-normal text-stone-500">
                            {" · "}
                            {item.triggerType.replace(/_/g, " ")}
                          </span>
                        </p>
                        {item.message ? <p className="text-stone-600">{item.message}</p> : null}
                        {item.sentAt ? (
                          <p className="text-xs text-stone-400">
                            Telegram sent {shortDate(item.sentAt)}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-xs text-stone-400">{shortDate(item.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-stone-100 pt-4">
          <Link
            href={`/accounts/${account.id}/edit`}
            className="inline-flex rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
          >
            Edit account
          </Link>
        </div>
      </div>
    </SectionCard>
  );
}
