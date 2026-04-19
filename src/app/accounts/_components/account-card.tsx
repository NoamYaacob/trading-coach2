import Link from "next/link";
import type { ConnectedAccount, AccountRiskRules, LiveSessionState, GuardianIntervention } from "@prisma/client";
import { SectionCard } from "@/components/ui/section-card";

type AccountWithRelations = ConnectedAccount & {
  riskRules: AccountRiskRules | null;
  sessionState: LiveSessionState | null;
  interventions: GuardianIntervention[];
};

type LastEvent = {
  accountId: string;
  eventType: string;
  occurredAt: Date;
} | null;

const CONNECTION_STATUS_STYLE: Record<
  string,
  { label: string; badge: string; badgeText: string; dot: string }
> = {
  connected_live: {
    label: "Live",
    badge: "bg-emerald-100",
    badgeText: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  pending_webhook: {
    label: "Pending sync",
    badge: "bg-amber-100",
    badgeText: "text-amber-700",
    dot: "bg-amber-400",
  },
  not_connected: {
    label: "Not connected",
    badge: "bg-stone-100",
    badgeText: "text-stone-600",
    dot: "bg-stone-400",
  },
  connection_error: {
    label: "Connection error",
    badge: "bg-red-100",
    badgeText: "text-red-700",
    dot: "bg-red-500",
  },
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

const TRIGGER_LABEL: Record<string, string> = {
  daily_loss_limit: "Daily loss limit",
  consecutive_losses: "Consecutive losses",
  max_trades_reached: "Max trades reached",
  rapid_trading: "Rapid trading",
  revenge_entry: "Revenge entry",
  increased_size_after_loss: "Size increase after loss",
  outside_allowed_hours: "Outside trading hours",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  trade_closed: "Trade closed",
  trade_opened: "Trade opened",
  daily_pnl_updated: "P&L update",
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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AccountCard({
  account,
  lastEvent,
}: {
  account: AccountWithRelations;
  lastEvent: LastEvent;
}) {
  const { sessionState, riskRules, interventions } = account;

  // Session state is only "live" if it belongs to today's date.
  // A stale row (from a previous day) means today's session hasn't started yet —
  // the pipeline resets it lazily on the first incoming event.
  const today = todayKey();
  const hasLiveData = sessionState != null && sessionState.sessionDate === today;

  const riskState = (hasLiveData ? sessionState.riskState : "NORMAL") as keyof typeof RISK_STATE_STYLE;
  const riskStyle = RISK_STATE_STYLE[riskState] ?? RISK_STATE_STYLE.NORMAL;

  // When account is stopped or in warning, surface the most recent trigger as the reason.
  const latestIntervention = interventions[0] ?? null;
  const stateReason =
    (riskState === "STOPPED" || riskState === "WARNING") && latestIntervention
      ? (TRIGGER_LABEL[latestIntervention.triggerType] ??
          latestIntervention.triggerType.replace(/_/g, " "))
      : null;

  const dailyPnl = hasLiveData ? Number(sessionState.dailyPnl) : 0;
  const pnlClass =
    dailyPnl > 0 ? "text-emerald-700" : dailyPnl < 0 ? "text-red-700" : "text-stone-950";

  const maxDailyLoss =
    riskRules?.maxDailyLoss != null ? Number(riskRules.maxDailyLoss) : null;
  // Remaining headroom before daily loss limit: positive = still room, zero/negative = hit.
  const pnlHeadroom =
    maxDailyLoss != null && dailyPnl < 0 ? maxDailyLoss + dailyPnl : null;

  const tradesCount = hasLiveData ? (sessionState.tradesCount ?? 0) : 0;
  const consecutiveLosses = hasLiveData ? (sessionState.consecutiveLosses ?? 0) : 0;
  const stopAfterLosses = riskRules?.stopAfterLosses ?? null;
  const maxTradesPerDay = riskRules?.maxTradesPerDay ?? null;

  const cooldownActive = hasLiveData ? sessionState.cooldownActive : false;
  const cooldownUntil = hasLiveData ? sessionState.cooldownUntil : null;

  const subtitle = [
    PLATFORM_LABEL[account.platform] ?? account.platform,
    account.propFirm ?? null,
    ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType,
    account.currency,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasAnyRule =
    riskRules != null &&
    (riskRules.maxDailyLoss != null ||
      riskRules.maxTradesPerDay != null ||
      riskRules.stopAfterLosses != null ||
      riskRules.riskPerTrade != null ||
      (riskRules.allowedStartHour != null && riskRules.allowedEndHour != null));

  const connStatus = CONNECTION_STATUS_STYLE[account.connectionStatus] ??
    CONNECTION_STATUS_STYLE["not_connected"];

  return (
    <SectionCard title={account.label} description={subtitle}>
      <div className="grid gap-5">
        {/* Connection status badge — primary signal for broker connectivity */}
        <div className="grid gap-1.5">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${connStatus.badge} ${connStatus.badgeText}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connStatus.dot} ${account.connectionStatus === "pending_webhook" ? "animate-pulse" : ""}`} />
              {connStatus.label}
            </span>
            {account.connectionStatus !== "connected_live" && account.platform === "tradovate" && (
              <Link
                href={`/accounts/${account.id}/edit`}
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
              >
                {account.connectionStatus === "not_connected"
                  ? "Connect Tradovate"
                  : account.connectionStatus === "connection_error"
                    ? "Reconnect Tradovate"
                    : !hasAnyRule
                      ? "Configure rules"
                      : "Manage connection"}
              </Link>
            )}
          </div>
          {account.connectionStatus === "pending_webhook" && (
            <p className="text-xs text-amber-700">
              Waiting for first broker event — ensure your Tradovate webhook is configured.
            </p>
          )}
          {account.connectionStatus === "connection_error" && (
            <p className="text-xs text-red-700">
              Events have stopped arriving from Tradovate — check your webhook configuration.
            </p>
          )}
        </div>

        {!hasLiveData && sessionState != null && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-500">
            Today&apos;s session has not started — stats below are reset to zero until the first
            broker event arrives.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* Guardian state */}
          <div className={`rounded-2xl border px-4 py-4 ${riskStyle.card}`}>
            <p
              className={`text-xs font-semibold uppercase tracking-[0.2em] ${riskStyle.text} opacity-80`}
            >
              Guardian state
            </p>
            <p className={`mt-2 text-lg font-semibold ${riskStyle.text}`}>{riskStyle.label}</p>
            {stateReason ? (
              <p className={`mt-1 text-sm ${riskStyle.text}`}>{stateReason}</p>
            ) : cooldownActive ? (
              <p className={`mt-1 text-sm ${riskStyle.text}`}>
                Cooldown{cooldownUntil ? ` until ${shortDate(cooldownUntil)}` : " active"}
              </p>
            ) : (
              <p className={`mt-1 text-sm opacity-60 ${riskStyle.text}`}>
                {hasLiveData ? "No active limit hit" : "Awaiting first event"}
              </p>
            )}
          </div>

          {/* Daily P&L */}
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Daily P&amp;L
            </p>
            <p className={`mt-2 text-lg font-semibold tabular-nums ${pnlClass}`}>
              {dailyPnl >= 0 ? "+" : ""}
              {dailyPnl.toFixed(2)}
            </p>
            {pnlHeadroom !== null ? (
              <p
                className={`mt-1 text-sm tabular-nums ${pnlHeadroom <= 0 ? "text-red-600" : "text-stone-500"}`}
              >
                {pnlHeadroom > 0
                  ? `${pnlHeadroom.toFixed(2)} to limit`
                  : "Limit reached"}
              </p>
            ) : (
              <p className="mt-1 text-sm text-stone-500">
                {maxDailyLoss != null ? `Limit: ${maxDailyLoss}` : account.currency}
              </p>
            )}
          </div>

          {/* Trades today */}
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Trades today
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {tradesCount}
              {maxTradesPerDay != null ? ` / ${maxTradesPerDay}` : ""}
            </p>
            <p className="mt-1 text-sm text-stone-500">
              {consecutiveLosses > 0
                ? stopAfterLosses != null
                  ? `${consecutiveLosses} / ${stopAfterLosses} loss streak`
                  : `${consecutiveLosses} consecutive ${consecutiveLosses === 1 ? "loss" : "losses"}`
                : "No loss streak"}
            </p>
          </div>

          {/* Last activity */}
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Last activity
            </p>
            {lastEvent ? (
              <>
                <p className="mt-2 text-lg font-semibold text-stone-950">
                  {EVENT_TYPE_LABEL[lastEvent.eventType] ??
                    lastEvent.eventType.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-sm text-stone-500">{shortDate(lastEvent.occurredAt)}</p>
              </>
            ) : (
              <p className="mt-2 text-lg font-semibold text-stone-400">No events yet</p>
            )}
            <p className="mt-1 text-xs text-stone-400">
              {account.isActive ? "Active" : "Inactive"}
              {account.externalAccountId ? ` · ID ${account.externalAccountId}` : ""}
            </p>
            {account.platform === "tradovate" && !account.externalAccountId && (
              <p className="mt-1 text-xs text-amber-700">
                No account ID — webhook events will not be received.
              </p>
            )}
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
                  <div
                    key={item.id}
                    className={`rounded-xl border px-4 py-3 text-sm ${borderBg}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid gap-0.5">
                        <p className="font-medium text-stone-950">
                          {OUTCOME_LABEL[item.outcome] ?? item.outcome}
                          <span className="font-normal text-stone-500">
                            {" · "}
                            {TRIGGER_LABEL[item.triggerType] ??
                              item.triggerType.replace(/_/g, " ")}
                          </span>
                        </p>
                        {item.message ? (
                          <p className="text-stone-600">{item.message}</p>
                        ) : null}
                        {item.sentAt ? (
                          <p className="text-xs text-stone-400">
                            Telegram sent {shortDate(item.sentAt)}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-xs text-stone-400">
                        {shortDate(item.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-stone-100 pt-4">
          <Link
            href={`/accounts/${account.id}/edit`}
            className="inline-flex rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
          >
            Manage connection
          </Link>
          {account.connectionStatus === "connected_live" && account.connectedAt && (
            <p className="text-xs text-stone-400">
              Live since {shortDate(account.connectedAt)}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
