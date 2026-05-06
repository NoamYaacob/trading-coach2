import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountForm } from "../../_components/account-form";
import type { AccountFormInitialData } from "../../_components/account-form";
import {
  deriveRuleSource,
  deriveRuleSourceLabel,
  hasAnyCoverage,
} from "../../_components/account-detail-helpers";
import { ConnectionPoller } from "./_components/connection-poller";
import { DiagnosticsPanel } from "./_components/diagnostics-panel";
import { DisconnectButton } from "./_components/disconnect-button";
import { ReactivateButton } from "./_components/reactivate-button";
import { mapRiskState, buildWebhookUrl } from "./_components/diagnostics-helpers";

export const metadata: Metadata = {
  title: "Manage Connection",
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

type ReadinessLevel =
  | "active"
  | "pending_first_event"
  | "no_rules"
  | "not_connected"
  | "connection_error"
  | "disconnected";

const READINESS_CONFIG: Record<
  ReadinessLevel,
  {
    border: string;
    bg: string;
    badgeBg: string;
    badgeText: string;
    badgeLabel: string;
    status: string;
    description: string;
  }
> = {
  active: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
    badgeLabel: "Ready",
    status: "Active",
    description:
      "Broker events are arriving and protection rules are in effect.",
  },
  pending_first_event: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
    badgeLabel: "Pending sync",
    status: "Waiting for first event",
    description:
      "Account ID and protection rules are configured. No events received yet — complete the webhook setup below.",
  },
  no_rules: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
    badgeLabel: "Set up rules",
    status: "No protection rules",
    description:
      "No protection rules are configured. Add rules in Trading Plan to enable automatic enforcement.",
  },
  not_connected: {
    border: "border-red-200",
    bg: "bg-red-50",
    badgeBg: "bg-red-100",
    badgeText: "text-red-700",
    badgeLabel: "Connect required",
    status: "Not connected",
    description:
      "Tradovate account ID is missing. Authorize Tradovate to link this account, or enter the account ID manually below.",
  },
  connection_error: {
    border: "border-red-200",
    bg: "bg-red-50",
    badgeBg: "bg-red-100",
    badgeText: "text-red-700",
    badgeLabel: "Error",
    status: "Connection error",
    description:
      "Broker events have stopped arriving. Reauthorize with Tradovate or verify your webhook configuration.",
  },
  disconnected: {
    border: "border-stone-200",
    bg: "bg-stone-50",
    badgeBg: "bg-stone-200",
    badgeText: "text-stone-700",
    badgeLabel: "Inactive",
    status: "Disconnected",
    description:
      "This account is deactivated. Monitoring is paused and no events are processed. Reactivate to resume.",
  },
};

export default async function EditAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { id } = await params;
  const { oauth } = await searchParams;

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
    include: {
      riskRules: true,
      sessionState: true,
      brokerConnection: { select: { permissionLevel: true, connectionStatus: true } },
    },
  });

  if (!account) {
    notFound();
  }

  // Fetch the user's default plan to determine rule coverage.
  const defaultRulesRecord = await prisma.riskRules.findUnique({
    where: { userId: currentUser.id },
    select: { id: true },
  });

  // Recent broker events — first row drives the readiness panel; full list feeds diagnostics.
  const recentEvents = await prisma.normalizedTradeEvent.findMany({
    where: { accountId: account.id },
    orderBy: { occurredAt: "desc" },
    take: 5,
    select: { eventType: true, occurredAt: true, pnl: true, side: true },
  });
  const lastEvent = recentEvents[0] ?? null;

  const recentInterventions =
    account.platform === "tradovate"
      ? await prisma.guardianIntervention.findMany({
          where: { accountId: account.id },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { triggerType: true, outcome: true, createdAt: true, message: true },
        })
      : [];

  // Readiness checks
  const hasAccountId = !!account.externalAccountId;
  const rr = account.riskRules;

  // Account is "rule-covered" if it has its own rules OR the default plan exists.
  const hasAccountRules =
    rr != null &&
    (rr.maxDailyLoss != null ||
      rr.riskPerTrade != null ||
      rr.maxTradesPerDay != null ||
      rr.stopAfterLosses != null ||
      (rr.allowedStartHour != null && rr.allowedEndHour != null));
  const hasDefaultRules = defaultRulesRecord != null;
  const ruleSource = deriveRuleSource({ hasAccountRules, hasDefaultRules });
  const ruleSourceLabel = deriveRuleSourceLabel(ruleSource);
  const hasRules = hasAnyCoverage({ hasAccountRules, hasDefaultRules });
  const hasEvent = lastEvent != null;

  const isTradovate = account.platform === "tradovate";
  const oauthConfigured = !!process.env.TRADOVATE_CLIENT_ID;

  const readiness: ReadinessLevel = !account.isActive
    ? "disconnected"
    : account.connectionStatus === "connection_error"
      ? "connection_error"
      : isTradovate && !hasAccountId
        ? "not_connected"
        : !hasRules
          ? "no_rules"
          : !hasEvent
            ? "pending_first_event"
            : "active";

  const cfg = READINESS_CONFIG[readiness];

  // OAuth env mirrors the account type — demo accounts authorize against demo.
  const oauthEnv = account.accountType === "demo" ? "demo" : "live";

  // The rules URL pre-selects this account in Trading Plan.
  const manageRulesHref = `/rules?scope=account&id=${account.id}`;

  // Static checks (account ID + rules) are passed to the client ConnectionPoller
  // when in pending state so it can render the full panel with live broker-events check.
  const staticChecks = [
    {
      label: isTradovate ? "Tradovate account ID" : "Account ID",
      pass: hasAccountId,
      detail: hasAccountId
        ? account.externalAccountId!
        : isTradovate
          ? "Missing — enter it in the form below"
          : "Not configured",
    },
    {
      label: "Protection rules",
      pass: hasRules,
      detail: hasRules
        ? ruleSourceLabel
        : "None — set up rules in Trading Plan",
    },
  ];

  // Full check list for static (non-polling) panel states.
  const checks = [
    ...staticChecks,
    ...(isTradovate
      ? [
          readiness === "connection_error"
            ? {
                label: "Webhook active",
                pass: false,
                detail: "Events have stopped — verify the webhook in Tradovate is still enabled",
              }
            : {
                label: "Broker events received",
                pass: hasEvent,
                detail: hasEvent
                  ? `Last: ${EVENT_TYPE_LABEL[lastEvent.eventType] ?? lastEvent.eventType.replace(/_/g, " ")} · ${shortDate(lastEvent.occurredAt)}`
                  : "No events yet — complete webhook setup",
              },
        ]
      : []),
  ];

  const initialData: AccountFormInitialData = {
    label: account.label,
    platform: account.platform,
    propFirm: account.propFirm,
    accountType: account.accountType,
    externalAccountId: account.externalAccountId,
    currency: account.currency,
    isActive: account.isActive,
    balance: account.balance != null ? Number(account.balance) : null,
    riskRules: account.riskRules
      ? {
          maxDailyLoss:
            account.riskRules.maxDailyLoss != null
              ? Number(account.riskRules.maxDailyLoss)
              : null,
          riskPerTrade:
            account.riskRules.riskPerTrade != null
              ? Number(account.riskRules.riskPerTrade)
              : null,
          maxTradesPerDay: account.riskRules.maxTradesPerDay,
          stopAfterLosses: account.riskRules.stopAfterLosses,
          allowedStartHour: account.riskRules.allowedStartHour,
          allowedEndHour: account.riskRules.allowedEndHour,
          propFirmAccountSize:
            account.riskRules.propFirmAccountSize != null
              ? Number(account.riskRules.propFirmAccountSize)
              : null,
          propFirmDailyLossLimit:
            account.riskRules.propFirmDailyLossLimit != null
              ? Number(account.riskRules.propFirmDailyLossLimit)
              : null,
          propFirmMaxDrawdown:
            account.riskRules.propFirmMaxDrawdown != null
              ? Number(account.riskRules.propFirmMaxDrawdown)
              : null,
          propFirmPhase: account.riskRules.propFirmPhase ?? null,
          propFirmTrailingDrawdown: account.riskRules.propFirmTrailingDrawdown,
          propFirmEODDrawdown:
            account.riskRules.propFirmEODDrawdown != null
              ? Number(account.riskRules.propFirmEODDrawdown)
              : null,
          propFirmDrawdownRemaining:
            account.riskRules.propFirmDrawdownRemaining != null
              ? Number(account.riskRules.propFirmDrawdownRemaining)
              : null,
          propFirmProfitTarget:
            account.riskRules.propFirmProfitTarget != null
              ? Number(account.riskRules.propFirmProfitTarget)
              : null,
          propFirmMinTradingDays: account.riskRules.propFirmMinTradingDays ?? null,
        }
      : null,
  };

  return (
    <AppShell
      eyebrow="Broker Connections"
      title={account.label}
      description="Review this account's connection, protection status, and latest broker activity."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          All connections
        </Link>
      }
    >
      <div className="grid gap-6">
        {oauth === "connected" && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
            Tradovate authorized. Go to{" "}
            <Link href={manageRulesHref} className="font-medium underline underline-offset-2">
              Trading Plan
            </Link>{" "}
            to set up protection rules, then complete webhook setup to go live.
          </div>
        )}

        {/* When pending, hand off to the client ConnectionPoller which polls for the
            first broker event and transitions the panel to the active state in-place. */}
        {readiness === "pending_first_event" ? (
          <ConnectionPoller accountId={account.id} staticChecks={staticChecks} />
        ) : (
          <div className={`rounded-[1.75rem] border ${cfg.border} ${cfg.bg} p-6`}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Connection readiness
                </p>
                <p className="mt-1 text-lg font-semibold text-stone-950">{cfg.status}</p>
                <p className="mt-1 text-sm text-stone-600">{cfg.description}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${cfg.badgeBg} ${cfg.badgeText}`}
              >
                {cfg.badgeLabel}
              </span>
            </div>

            {/* State-specific primary action */}
            {readiness === "disconnected" ? (
              <div className="mb-4">
                <ReactivateButton accountId={account.id} />
              </div>
            ) : isTradovate && oauthConfigured && readiness === "not_connected" ? (
              <div className="mb-4">
                <a
                  href={`/api/auth/tradovate/connect?env=${oauthEnv}`}
                  className="inline-flex w-fit rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Connect Tradovate
                </a>
              </div>
            ) : isTradovate && oauthConfigured && readiness === "connection_error" ? (
              <div className="mb-4">
                <a
                  href={`/api/auth/tradovate/connect?env=${oauthEnv}`}
                  className="inline-flex w-fit rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Reconnect Tradovate
                </a>
              </div>
            ) : null}

            {readiness !== "disconnected" && (
              <div className="grid gap-2">
                {checks.map((check) => (
                  <div key={check.label} className="flex items-baseline gap-3 text-sm">
                    <span
                      className={`shrink-0 font-semibold ${check.pass ? "text-emerald-600" : "text-red-500"}`}
                    >
                      {check.pass ? "✓" : "✗"}
                    </span>
                    <span className="text-stone-700">
                      <span className="font-medium">{check.label}</span>
                      <span className="text-stone-500"> — {check.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Protection rules summary + CTA */}
        <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 px-6 py-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
            Protection rules
          </p>
          <p className="mt-1 text-sm text-stone-700">{ruleSourceLabel}</p>
          <p className="mt-0.5 text-xs text-stone-500">
            Protection limits, session hours, and enforcement settings are managed in Trading Plan.
          </p>
          <div className="mt-3">
            <Link
              href={manageRulesHref}
              className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
            >
              Manage protection rules
            </Link>
          </div>
        </div>

        {/* Session summary — surfaced for active accounts so traders see today's state */}
        {account.sessionState && (
          <div className="rounded-[1.75rem] border border-stone-200 bg-white px-6 py-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Today&rsquo;s session
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-stone-500">Risk state</dt>
                <dd
                  className={`mt-0.5 font-semibold ${
                    account.sessionState.riskState === "STOPPED"
                      ? "text-red-700"
                      : account.sessionState.riskState === "WARNING"
                        ? "text-amber-700"
                        : "text-emerald-700"
                  }`}
                >
                  {mapRiskState(account.sessionState.riskState)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Daily P&amp;L</dt>
                <dd
                  className={`mt-0.5 font-mono font-semibold ${
                    Number(account.sessionState.dailyPnl) < 0
                      ? "text-red-700"
                      : Number(account.sessionState.dailyPnl) > 0
                        ? "text-emerald-700"
                        : "text-stone-900"
                  }`}
                >
                  {Number(account.sessionState.dailyPnl) >= 0 ? "+" : ""}
                  {Number(account.sessionState.dailyPnl).toFixed(2)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Trades</dt>
                <dd className="mt-0.5 font-semibold text-stone-900">
                  {account.sessionState.tradesCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500">Loss streak</dt>
                <dd className="mt-0.5 font-semibold text-stone-900">
                  {account.sessionState.consecutiveLosses ?? 0}
                </dd>
              </div>
              {account.sessionState.cooldownActive && (
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-xs text-stone-500">Cooldown</dt>
                  <dd className="mt-0.5 font-medium text-amber-700">
                    {account.sessionState.cooldownUntil
                      ? `Active until ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(account.sessionState.cooldownUntil)}`
                      : "Active"}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <SectionCard
          title="Account details"
          description="Update account identity and connection settings. Save to apply changes immediately."
        >
          <AccountForm mode="edit" accountId={account.id} initialData={initialData} hideRules hideEventRouting />
        </SectionCard>

        {account.isActive && (
          <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 px-6 py-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Connection management
            </p>
            <DisconnectButton accountId={account.id} />
          </div>
        )}

        {isTradovate && (
          <DiagnosticsPanel
            accountId={account.id}
            connectionStatus={account.connectionStatus}
            externalAccountId={account.externalAccountId}
            connectedAt={account.connectedAt?.toISOString() ?? null}
            recentEvents={recentEvents.map((e) => ({
              eventType: e.eventType,
              occurredAt: e.occurredAt.toISOString(),
              pnl: e.pnl?.toString() ?? null,
              side: e.side,
            }))}
            recentInterventions={recentInterventions.map((iv) => ({
              triggerType: iv.triggerType,
              outcome: iv.outcome,
              createdAt: iv.createdAt.toISOString(),
              message: iv.message,
            }))}
            isDev={process.env.NODE_ENV !== "production"}
            showEventRouting={readiness === "pending_first_event" || readiness === "not_connected"}
            webhookUrl={buildWebhookUrl(process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app-url")}
          />
        )}
      </div>
    </AppShell>
  );
}
