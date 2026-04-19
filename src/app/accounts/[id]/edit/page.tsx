import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountForm } from "../../_components/account-form";
import type { AccountFormInitialData } from "../../_components/account-form";
import { ConnectionPoller } from "./_components/connection-poller";

export const metadata: Metadata = {
  title: "Edit Account",
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

type ReadinessLevel = "active" | "pending_first_event" | "no_rules" | "not_connected";

const READINESS_CONFIG: Record<
  ReadinessLevel,
  {
    border: string;
    bg: string;
    badgeBg: string;
    badgeText: string;
    status: string;
    description: string;
  }
> = {
  active: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    badgeBg: "bg-emerald-100",
    badgeText: "text-emerald-700",
    status: "Live protection active",
    description:
      "Events are arriving and guardian rules are in effect. The guardian will intervene when limits are hit.",
  },
  pending_first_event: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
    status: "Webhook pending",
    description:
      "Account ID and rules are configured. No events received yet — complete the webhook setup below.",
  },
  no_rules: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-700",
    status: "Monitoring only",
    description:
      "Events will be received and logged, but no intervention rules are set. Add at least one limit to enable protection.",
  },
  not_connected: {
    border: "border-red-200",
    bg: "bg-red-50",
    badgeBg: "bg-red-100",
    badgeText: "text-red-700",
    status: "Not connected",
    description:
      "Tradovate account ID is missing. Webhook events cannot be routed to this account without it.",
  },
};

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { id } = await params;

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
    include: { riskRules: true, sessionState: true },
  });

  if (!account) {
    notFound();
  }

  // Most recent broker event for this account — used in the readiness panel.
  const lastEvent = await prisma.normalizedTradeEvent.findFirst({
    where: { accountId: account.id },
    orderBy: { occurredAt: "desc" },
    select: { eventType: true, occurredAt: true },
  });

  // Readiness checks
  const hasAccountId = !!account.externalAccountId;
  const rr = account.riskRules;
  const hasRules =
    rr != null &&
    (rr.maxDailyLoss != null ||
      rr.riskPerTrade != null ||
      rr.maxTradesPerDay != null ||
      rr.stopAfterLosses != null ||
      (rr.allowedStartHour != null && rr.allowedEndHour != null));
  const hasEvent = lastEvent != null;

  const rulesCount = rr
    ? [
        rr.maxDailyLoss,
        rr.riskPerTrade,
        rr.maxTradesPerDay != null ? rr.maxTradesPerDay : null,
        rr.stopAfterLosses != null ? rr.stopAfterLosses : null,
        rr.allowedStartHour != null && rr.allowedEndHour != null ? 1 : null,
      ].filter((v) => v != null).length
    : 0;

  const isTradovate = account.platform === "tradovate";

  const readiness: ReadinessLevel = isTradovate && !hasAccountId
    ? "not_connected"
    : !hasRules
      ? "no_rules"
      : !hasEvent
        ? "pending_first_event"
        : "active";

  const cfg = READINESS_CONFIG[readiness];

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
      label: "Guardian rules",
      pass: hasRules,
      detail: hasRules
        ? `${rulesCount} rule${rulesCount !== 1 ? "s" : ""} configured`
        : "None — add at least one limit",
    },
  ];

  // Full check list for static (non-polling) panel states.
  const checks = [
    ...staticChecks,
    ...(isTradovate
      ? [
          {
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
        }
      : null,
  };

  return (
    <AppShell
      eyebrow="Accounts"
      title={account.label}
      description="Update this account's details and guardian rules."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back to accounts
        </Link>
      }
    >
      <div className="grid gap-6">
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
                {readiness === "active"
                  ? "Ready"
                  : readiness === "no_rules"
                    ? "Partial"
                    : "Incomplete"}
              </span>
            </div>
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
          </div>
        )}

        <SectionCard
          title="Account setup"
          description="Changes take effect immediately. Guardian rules apply to the next event processed."
        >
          <AccountForm mode="edit" accountId={account.id} initialData={initialData} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
