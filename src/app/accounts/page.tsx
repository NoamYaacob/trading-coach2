import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { AccountCard } from "./_components/account-card";
import { SyncButton } from "./_components/sync-button";

export const metadata: Metadata = {
  title: "Broker Connections — Guardrail",
};

const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo / Sim",
};

const CONN_STATUS_LABEL: Record<string, string> = {
  connected_readonly: "Read-only connected",
  expired: "Expired — re-authorize",
  connection_error: "Connection error",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const [accounts, brokerConnections, telegramConnection, defaultRules] = await Promise.all([
    prisma.connectedAccount.findMany({
      where: { userId: currentUser.id, isActive: true },
      include: {
        riskRules: true,
        sessionState: true,
        interventions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.brokerConnection.findMany({
      where: { userId: currentUser.id },
      select: {
        id: true,
        platform: true,
        env: true,
        connectionStatus: true,
        createdAt: true,
        accounts: {
          where: { isActive: true },
          select: { id: true, label: true },
          orderBy: { label: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.telegramConnection.findUnique({
      where: { userId: currentUser.id },
      select: { telegramChatId: true },
    }),
    prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { maxDailyLoss: true, maxTradesPerDay: true, stopAfterLosses: true, riskPerTrade: true },
    }),
  ]);

  const hasDefaultRules = Boolean(
    defaultRules &&
      (defaultRules.maxDailyLoss != null ||
        defaultRules.maxTradesPerDay != null ||
        defaultRules.stopAfterLosses != null ||
        defaultRules.riskPerTrade != null),
  );

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  const recentEventsRaw =
    accounts.length > 0
      ? await prisma.normalizedTradeEvent.findMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
          orderBy: { occurredAt: "desc" },
          take: Math.max(accounts.length * 10, 50),
          select: { accountId: true, eventType: true, occurredAt: true, pnl: true, side: true },
        })
      : [];

  const eventsByAccount: Record<string, typeof recentEventsRaw> = {};
  for (const ev of recentEventsRaw) {
    const bucket = (eventsByAccount[ev.accountId] ??= []);
    if (bucket.length < 10) bucket.push(ev);
  }

  const hasBrokerAccounts = accounts.some((a) => a.platform !== "manual");
  const tradovateConfigured = getTradovateConfig().state === "ready";

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

        {/* BrokerConnection groups */}
        {brokerConnections.length > 0 && (
          <div className="grid gap-4">
            {brokerConnections.map((bc) => {
              const statusLabel = CONN_STATUS_LABEL[bc.connectionStatus] ?? bc.connectionStatus.replace(/_/g, " ");
              const isExpired = bc.connectionStatus === "expired" || bc.connectionStatus === "connection_error";
              return (
                <SectionCard
                  key={bc.id}
                  title={`Tradovate ${ENV_LABEL[bc.env] ?? bc.env} connection`}
                  description="OAuth-authorized read-only connection. Imported accounts below."
                >
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                            isExpired
                              ? "bg-red-100 text-red-700"
                              : "bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {statusLabel}
                        </span>
                        <span className="text-xs text-stone-500">
                          {bc.accounts.length} account{bc.accounts.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!isExpired && (
                          <>
                            <SyncButton connectionId={bc.id} lastSyncAt={null} />
                            <Link
                              href={`/accounts/connect/tradovate?env=${bc.env}&reconnect=${bc.id}`}
                              className="inline-flex items-center rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-medium text-stone-900 transition hover:border-stone-950"
                            >
                              Import more accounts
                            </Link>
                          </>
                        )}
                        <Link
                          href={`/accounts/connect/tradovate?env=${bc.env}`}
                          className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                            isExpired
                              ? "border-red-300 text-red-700 hover:border-red-500"
                              : "border-stone-300 text-stone-900 hover:border-stone-950"
                          }`}
                        >
                          {isExpired ? "Reconnect" : "New connection"}
                        </Link>
                      </div>
                    </div>

                    {bc.accounts.length > 0 && (
                      <div className="grid gap-1.5">
                        {bc.accounts.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3.5 py-2.5"
                          >
                            <span className="text-sm font-medium text-stone-900">{a.label}</span>
                            <Link
                              href={`/accounts/${a.id}/edit`}
                              className="text-xs text-stone-500 transition hover:text-stone-950"
                            >
                              Edit
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </SectionCard>
              );
            })}
          </div>
        )}

        {/* Individual account cards (all active accounts) */}
        {accounts.length > 0 ? (
          <>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                recentEvents={eventsByAccount[account.id] ?? []}
                telegramReady={telegramReady}
                hasDefaultRules={hasDefaultRules}
              />
            ))}
          </>
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

        {!hasBrokerAccounts && accounts.length > 0 && (
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
            <p className="text-sm text-stone-600">
              Add Tradovate for live broker-based risk checks.{" "}
              <Link
                href="/accounts/connect/tradovate"
                className="font-medium text-stone-950 underline-offset-2 hover:underline"
              >
                Connect Tradovate
              </Link>
            </p>
          </div>
        )}

        {/* Connection status — collapsible. When a broker account exists, Tradovate read-only
            is the primary connected state and Manual mode drops to secondary. */}
        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Connection status
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-4">
            <p className="text-sm text-stone-500">
              {hasBrokerAccounts
                ? "Tradovate is connected read-only. Manual journaling remains available alongside the broker connection."
                : "Manual mode is available now. Broker-connected protection becomes available after Tradovate setup is complete."}
            </p>
            <div className="mt-4 grid gap-3">
              {hasBrokerAccounts ? (
                <>
                  <ConnectionStatusRow
                    label="Tradovate — read-only connected"
                    status="Connected"
                    statusTone="ok"
                    description="Read-only account data is connected. Live rule checks activate after account sync and rule setup."
                  />
                  <ConnectionStatusRow
                    label="Manual mode"
                    status="Available"
                    statusTone="neutral"
                    description="Track trades manually and evaluate your rules from journal entries."
                    secondary
                  />
                </>
              ) : (
                <>
                  <ConnectionStatusRow
                    label="Manual mode"
                    status="Available"
                    statusTone="ok"
                    description="Track trades manually and evaluate your rules from journal entries."
                  />
                  <ConnectionStatusRow
                    label="Tradovate — read-only connected"
                    status="Setup needed"
                    statusTone="pending"
                    description="Read-only account data is available after OAuth is completed and accounts are imported."
                  />
                </>
              )}
              <ConnectionStatusRow
                label="Broker-side enforcement"
                status="Disabled"
                statusTone="neutral"
                description="Cancel, flatten, and lockout actions require separate verification and explicit opt-in. Not active."
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
  const labelCls = secondary
    ? "text-sm font-medium text-stone-700"
    : "text-sm font-medium text-stone-950";
  const descCls = secondary
    ? "mt-1.5 text-xs leading-5 text-stone-500"
    : "mt-1.5 text-xs leading-5 text-stone-600";
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
