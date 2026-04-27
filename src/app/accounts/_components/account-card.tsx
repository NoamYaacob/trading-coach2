import Link from "next/link";
import type { ConnectedAccount, AccountRiskRules, LiveSessionState, GuardianIntervention } from "@prisma/client";
import { SectionCard } from "@/components/ui/section-card";

type AccountWithRelations = ConnectedAccount & {
  riskRules: AccountRiskRules | null;
  sessionState: LiveSessionState | null;
  interventions: GuardianIntervention[];
};

type RecentEvent = {
  accountId: string;
  eventType: string;
  occurredAt: Date;
  pnl: { toString(): string } | null;
  side: string | null;
};

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
  connected_readonly: {
    label: "Read-only connected",
    badge: "bg-sky-100",
    badgeText: "text-sky-700",
    dot: "bg-sky-500",
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
  expired: {
    label: "Connection expired",
    badge: "bg-orange-100",
    badgeText: "text-orange-700",
    dot: "bg-orange-500",
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

// Enforcement outcome format: "action:tier" (e.g. "warning:soft_warning", "stop:lockdown")
// Older records may use the plain action string without a tier suffix.
function parseOutcome(raw: string): { action: string; tier: string | null } {
  const colon = raw.indexOf(":");
  if (colon === -1) return { action: raw, tier: null };
  return { action: raw.slice(0, colon), tier: raw.slice(colon + 1) };
}

const TIER_LABEL: Record<string, string> = {
  soft_warning: "Warning",
  hard_warning: "Strong warning",
  cooldown:     "Cooldown",
  lockdown:     "Lockdown",
};

const TRIGGER_LABEL: Record<string, string> = {
  daily_loss_limit:           "Daily loss limit",
  consecutive_losses:         "Consecutive losses",
  max_trades_reached:         "Max trades reached",
  rapid_trading:              "Rapid trading",
  revenge_entry:              "Revenge entry",
  increased_size_after_loss:  "Size increase after loss",
  outside_allowed_hours:      "Outside trading hours",
  unrealized_drawdown:        "Unrealized drawdown",
};

const EVENT_TYPE_LABEL: Record<string, { label: string; pnlColor: string }> = {
  trade_closed_win:    { label: "Win",           pnlColor: "text-emerald-700" },
  trade_closed_loss:   { label: "Loss",          pnlColor: "text-red-700" },
  trade_closed:        { label: "Trade closed",  pnlColor: "text-stone-700" },
  trade_opened:        { label: "Trade opened",  pnlColor: "text-stone-500" },
  daily_pnl_updated:   { label: "P&L update",    pnlColor: "text-stone-500" },
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

/** Derive a plain-language enforcement mode label from live account state and rules. */
function deriveEnforcementMode(
  riskState: string,
  cooldownActive: boolean,
  hasLiveData: boolean,
  hasRules: boolean,
): { label: string; detail: string; style: string } {
  if (riskState === "STOPPED" && cooldownActive) {
    return {
      label: "Cooldown",
      detail: "Trading paused — consecutive loss limit hit.",
      style: "text-orange-700 bg-orange-50 border-orange-200",
    };
  }
  if (riskState === "STOPPED") {
    return {
      label: "Locked down",
      detail: "Daily or trade limit reached. Manual reset required.",
      style: "text-red-700 bg-red-50 border-red-200",
    };
  }
  if (riskState === "WARNING") {
    return {
      label: "Warning state",
      detail: "A rule was triggered. Review before continuing.",
      style: "text-amber-700 bg-amber-50 border-amber-200",
    };
  }
  if (!hasRules) {
    return {
      label: "Monitoring only",
      detail: "No rules configured — events are logged but nothing is enforced.",
      style: "text-stone-600 bg-stone-50 border-stone-200",
    };
  }
  if (!hasLiveData) {
    return {
      label: "Enforcement ready",
      detail: "Rules configured — awaiting first live event.",
      style: "text-stone-600 bg-stone-50 border-stone-200",
    };
  }
  return {
    label: "Enforcement active",
    detail: "Watching every trade. Rules will fire when limits are hit.",
    style: "text-emerald-700 bg-emerald-50 border-emerald-200",
  };
}

export function AccountCard({
  account,
  recentEvents,
  telegramReady,
}: {
  account: AccountWithRelations;
  recentEvents: RecentEvent[];
  telegramReady: boolean;
}) {
  const { sessionState, riskRules, interventions } = account;

  const today = todayKey();
  const hasLiveData = sessionState != null && sessionState.sessionDate === today;

  const riskState = (hasLiveData ? sessionState.riskState : "NORMAL") as keyof typeof RISK_STATE_STYLE;
  const riskStyle = RISK_STATE_STYLE[riskState] ?? RISK_STATE_STYLE.NORMAL;

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

  const enfMode = deriveEnforcementMode(
    riskState,
    cooldownActive,
    hasLiveData,
    hasAnyRule,
  );

  return (
    <SectionCard title={account.label} description={subtitle}>
      <div className="grid gap-5">
        {/* Connection status */}
        <div className="grid gap-1.5">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${connStatus.badge} ${connStatus.badgeText}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connStatus.dot} ${account.connectionStatus === "pending_webhook" ? "animate-pulse" : ""}`} />
              {connStatus.label}
            </span>
            {account.platform === "tradovate" &&
            account.connectionStatus !== "connected_live" && (
              <Link
                href={
                  account.connectionStatus === "connected_readonly" ||
                  account.connectionStatus === "expired"
                    ? `/accounts/connect/tradovate`
                    : `/accounts/${account.id}/edit`
                }
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
              >
                {account.connectionStatus === "not_connected"
                  ? "Connect Tradovate"
                  : account.connectionStatus === "connection_error" ||
                      account.connectionStatus === "expired"
                    ? "Re-authorize Tradovate"
                    : account.connectionStatus === "connected_readonly"
                      ? "Re-authorize"
                      : !hasAnyRule
                        ? "Configure rules"
                        : "Manage connection"}
              </Link>
            )}
          </div>
          {account.connectionStatus === "connected_readonly" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-xs text-sky-700">
                Read-only connected — live broker-based risk checks are not yet active.
              </p>
              {account.lastSyncAt && (
                <p className="text-xs text-stone-400">
                  Last sync {shortDate(account.lastSyncAt)}
                </p>
              )}
              <Link
                href={`/accounts/tradovate/verify?accountId=${account.id}`}
                className="text-xs text-sky-600 underline-offset-2 hover:underline"
              >
                Verify read-only connection ↗
              </Link>
            </div>
          )}
          {account.connectionStatus === "expired" && (
            <p className="text-xs text-orange-700">
              Connection expired — reconnect to restore live data.
            </p>
          )}
          {account.connectionStatus === "pending_webhook" && (
            <p className="text-xs text-amber-700">
              Waiting for your first trade from Tradovate.
            </p>
          )}
          {account.connectionStatus === "connection_error" && (
            <p className="text-xs text-red-700">
              No recent activity from Tradovate — check your broker connection.
            </p>
          )}
        </div>

        {!hasLiveData && sessionState != null && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm text-stone-500">
            Today&apos;s session has not started — stats reset until the first broker event arrives.
          </div>
        )}

        {/* Enforcement mode — explicit product truth about what Guardrail is doing */}
        <div className={`rounded-2xl border px-4 py-3 ${enfMode.style}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">
                Enforcement mode
              </p>
              <p className="mt-1 font-semibold">{enfMode.label}</p>
              <p className="mt-0.5 text-sm opacity-80">{enfMode.detail}</p>
            </div>
            <div className="shrink-0 text-right text-xs opacity-60">
              <p>{telegramReady ? "Telegram: active" : "Telegram: not connected"}</p>
              <p className="mt-0.5">Broker stop: not available</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* Guardian state */}
          <div className={`rounded-2xl border px-4 py-4 ${riskStyle.card}`}>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${riskStyle.text} opacity-80`}>
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
              {dailyPnl >= 0 ? "+" : ""}{dailyPnl.toFixed(2)}
            </p>
            {pnlHeadroom !== null ? (
              <p className={`mt-1 text-sm tabular-nums ${pnlHeadroom <= 0 ? "text-red-600" : "text-stone-500"}`}>
                {pnlHeadroom > 0 ? `${pnlHeadroom.toFixed(2)} to limit` : "Limit reached"}
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
              {tradesCount}{maxTradesPerDay != null ? ` / ${maxTradesPerDay}` : ""}
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
            {recentEvents.length > 0 ? (
              <>
                <p className="mt-2 text-lg font-semibold text-stone-950">
                  {EVENT_TYPE_LABEL[recentEvents[0].eventType]?.label ??
                    recentEvents[0].eventType.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {shortDate(recentEvents[0].occurredAt)}
                </p>
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
              {riskRules!.maxDailyLoss != null && (
                <span>Max daily loss: {Number(riskRules!.maxDailyLoss)}</span>
              )}
              {riskRules!.maxTradesPerDay != null && (
                <span>Max trades/day: {riskRules!.maxTradesPerDay}</span>
              )}
              {riskRules!.stopAfterLosses != null && (
                <span>Stop after losses: {riskRules!.stopAfterLosses}</span>
              )}
              {riskRules!.riskPerTrade != null && (
                <span>Risk/trade: {Number(riskRules!.riskPerTrade)}</span>
              )}
              {riskRules!.allowedStartHour != null && riskRules!.allowedEndHour != null && (
                <span>
                  Hours: {riskRules!.allowedStartHour}:00–{riskRules!.allowedEndHour}:00 UTC
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Live event feed */}
        {recentEvents.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
              Live event feed
            </p>
            <div className="grid gap-1.5">
              {recentEvents.map((ev, i) => {
                const meta = EVENT_TYPE_LABEL[ev.eventType];
                const pnlNum = ev.pnl != null ? Number(ev.pnl.toString()) : null;
                const pnlStr =
                  pnlNum != null
                    ? `${pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}`
                    : null;
                return (
                  <div
                    key={i}
                    className="flex items-baseline justify-between gap-4 rounded-xl border border-stone-100 bg-stone-50 px-3.5 py-2 text-sm"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-medium text-stone-800">
                        {meta?.label ?? ev.eventType.replace(/_/g, " ")}
                      </span>
                      {ev.side && (
                        <span className="text-xs text-stone-500">{ev.side}</span>
                      )}
                      {pnlStr && (
                        <span className={`text-xs font-semibold tabular-nums ${meta?.pnlColor ?? "text-stone-700"}`}>
                          {pnlStr}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-stone-400">
                      {shortDate(ev.occurredAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Intervention log */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Recent interventions
          </p>
          {interventions.length === 0 ? (
            <p className="text-sm text-stone-500">No interventions yet.</p>
          ) : (
            <div className="grid gap-2">
              {interventions.map((item) => {
                const { tier } = parseOutcome(item.outcome);
                const isHardStop = tier === "lockdown" || tier === "cooldown";
                const isWarn = tier === "hard_warning" || tier === "soft_warning";
                const borderBg = isHardStop
                  ? "border-red-200 bg-red-50"
                  : isWarn
                    ? "border-amber-200 bg-amber-50"
                    : "border-stone-200 bg-stone-50";

                return (
                  <div key={item.id} className={`rounded-xl border px-4 py-3 text-sm ${borderBg}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid gap-0.5">
                        <p className="font-medium text-stone-950">
                          {tier ? (TIER_LABEL[tier] ?? tier) : item.outcome}
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
                        ) : (
                          <p className="text-xs text-stone-400">Telegram not sent</p>
                        )}
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
          {account.connectionStatus === "connected_readonly" && account.connectedAt && (
            <p className="text-xs text-stone-400">
              Connected {shortDate(account.connectedAt)}
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
