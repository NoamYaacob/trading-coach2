import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { getProtectionLockState } from "@/lib/account-protection";
import { ConnectionGroupCard } from "./_components/connection-group-card";
import { AutoSync } from "@/app/dashboard/_components/auto-sync";
import { needsSync } from "@/lib/sync-freshness";

export const metadata: Metadata = {
  title: "Broker Connections — Guardrail",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const [brokerConnections, defaultRules] = await Promise.all([
    prisma.brokerConnection.findMany({
      where: { userId: currentUser.id },
      select: {
        id: true,
        platform: true,
        env: true,
        brokerUserId: true,
        connectionStatus: true,
        createdAt: true,
        accounts: {
          where: { isActive: true, protectionStatus: { not: "archived" } },
          select: {
            id: true,
            label: true,
            balance: true,
            protectionStatus: true,
            pendingProtectionStatus: true,
            pendingProtectionEffectiveDate: true,
            missingFromBrokerSince: true,
            lastSyncAt: true,
            propFirm: true,
            accountType: true,
            riskRules: {
              select: {
                maxDailyLoss: true,
                maxTradesPerDay: true,
                stopAfterLosses: true,
                propFirmDailyLossLimit: true,
              },
            },
            sessionState: {
              select: { riskState: true, sessionDate: true, dailyPnl: true },
            },
            interventions: {
              select: { brokerLockStatus: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
          orderBy: { label: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: {
        maxDailyLoss: true,
        maxTradesPerDay: true,
        stopAfterLosses: true,
        riskPerTrade: true,
        sessionStartHour: true,
        sessionEndHour: true,
        protectionLockCutoffMinutes: true,
      },
    }),
  ]);

  const protectionLock = getProtectionLockState({
    sessionStartHour: defaultRules?.sessionStartHour ?? null,
    sessionEndHour: defaultRules?.sessionEndHour ?? null,
    cutoffMinutes: defaultRules?.protectionLockCutoffMinutes ?? null,
  });

  const hasDefaultRules = Boolean(
    defaultRules &&
      (defaultRules.maxDailyLoss != null ||
        defaultRules.maxTradesPerDay != null ||
        defaultRules.stopAfterLosses != null ||
        defaultRules.riskPerTrade != null),
  );

  const defaultMaxDailyLoss =
    defaultRules?.maxDailyLoss != null ? Number(defaultRules.maxDailyLoss) : null;

  const hasBrokerConnections = brokerConnections.length > 0;
  const tradovateConfigured = getTradovateConfig().state === "ready";

  const staleConnectionIds = brokerConnections
    .filter(
      (bc) =>
        bc.connectionStatus !== "expired" &&
        bc.connectionStatus !== "connection_error" &&
        bc.accounts.some(
          (a) =>
            (a.protectionStatus === "protected" || a.protectionStatus === "monitor_only") &&
            needsSync(a.lastSyncAt),
        ),
    )
    .map((bc) => bc.id);
  const staleAccountIds: string[] = [];

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Broker connections"
      description="Manage your Tradovate connections. Guardrail reads account data to evaluate rules — it cannot place trades or modify your account."
      note="Enforcement pending verification — broker-side order blocking is not active."
      actions={
        <Link
          href="/accounts/connect/tradovate"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          {tradovateConfigured ? "Connect Tradovate" : "Prepare Tradovate connection"}
        </Link>
      }
    >
      <div className="grid gap-6 -mb-6 sm:mb-0">

        {protectionLock.isLocked && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
            <p className="font-medium">Protection is locked for today&apos;s session.</p>
            <p className="mt-1 text-[13px] text-amber-700">
              You can change account protection before the trading session starts. After the
              cutoff, reductions and rule changes apply from the next trading day
              ({protectionLock.nextTradingDayKey}).
            </p>
          </div>
        )}

        {(staleConnectionIds.length > 0 || staleAccountIds.length > 0) && (
          <AutoSync staleConnectionIds={staleConnectionIds} staleAccountIds={staleAccountIds} />
        )}

        {hasBrokerConnections ? (
          <div className="grid gap-4">
            {brokerConnections.map((bc) => (
              <ConnectionGroupCard
                key={bc.id}
                connection={bc}
                isLocked={protectionLock.isLocked}
                hasDefaultRules={hasDefaultRules}
                defaultMaxDailyLoss={defaultMaxDailyLoss}
              />
            ))}
          </div>
        ) : (
          <SectionCard title="No broker connected yet">
            <p className="text-sm text-stone-600">
              Connect Tradovate to move from setup mode into broker-connected protection.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/accounts/connect/tradovate"
                className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Connect Tradovate
              </Link>
            </div>
            <p className="mt-4 text-xs text-stone-500">
              You can set rules before connecting, but live broker-based checks require a verified connection.
            </p>
          </SectionCard>
        )}

        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Connection status
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-4">
            <p className="text-sm text-stone-500">
              {hasBrokerConnections
                ? "Tradovate is connected read-only. Guardrail evaluates rules from live account data."
                : "Connect Tradovate to enable live rule monitoring and broker-connected protection."}
            </p>
            <div className="mt-4 grid gap-3">
              <ConnectionStatusRow
                label="Tradovate — read-only"
                status={hasBrokerConnections ? "Connected" : "Setup needed"}
                statusTone={hasBrokerConnections ? "ok" : "pending"}
                description={
                  hasBrokerConnections
                    ? "Read-only account data is connected. Live rule checks are active."
                    : "Read-only account data is available after OAuth is completed and accounts are added."
                }
              />
              <ConnectionStatusRow
                label="Broker-side enforcement"
                status="Pending"
                statusTone="neutral"
                description="Broker-side order blocking requires full-access permissions and explicit opt-in. Not active."
                secondary
              />
            </div>
          </div>
        </details>

      </div>
    </AppShell>
  );
}

function ConnectionStatusRow({
  label,
  status,
  statusTone,
  description,
  secondary = false,
}: {
  label: string;
  status: string;
  statusTone: "ok" | "pending" | "neutral";
  description: string;
  secondary?: boolean;
}) {
  const pillCls =
    statusTone === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : statusTone === "pending"
        ? "bg-amber-100 text-amber-700"
        : "bg-stone-100 text-stone-500";
  const wrapperCls = secondary
    ? "rounded-xl border border-stone-100 bg-white px-4 py-3"
    : "rounded-xl border border-stone-100 bg-stone-50 px-4 py-3";
  const labelCls = secondary ? "text-sm font-medium text-stone-700" : "text-sm font-medium text-stone-950";
  const descCls = secondary ? "mt-1.5 text-xs leading-5 text-stone-500" : "mt-1.5 text-xs leading-5 text-stone-600";
  return (
    <div className={wrapperCls}>
      <div className="flex items-start justify-between gap-3">
        <p className={labelCls}>{label}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${pillCls}`}>
          {status}
        </span>
      </div>
      <p className={descCls}>{description}</p>
    </div>
  );
}
