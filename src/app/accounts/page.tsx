import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { ProductStatusPanel } from "@/components/ui/product-status-panel";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getVisibleAdapters } from "@/lib/brokers/registry";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import type {
  BrokerCapabilityKey,
  BrokerCapabilityStatus,
} from "@/lib/brokers/types";
import { AccountCard } from "./_components/account-card";

function statusLabel(status: BrokerCapabilityStatus): string {
  switch (status) {
    case "available":      return "Available";
    case "requires_oauth": return "Setup needed";
    case "coming_soon":    return "Coming soon";
    case "unknown":        return "To be verified";
    case "not_supported":  return "Not available";
  }
}

function statusClass(status: BrokerCapabilityStatus): string {
  switch (status) {
    case "available":      return "text-emerald-700";
    case "requires_oauth": return "text-amber-700";
    case "coming_soon":    return "text-stone-500";
    case "unknown":        return "text-stone-500";
    case "not_supported":  return "text-stone-400";
  }
}

export const metadata: Metadata = {
  title: "Accounts — Guardrail",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const [accounts, telegramConnection] = await Promise.all([
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
    prisma.telegramConnection.findUnique({
      where: { userId: currentUser.id },
      select: { telegramChatId: true },
    }),
  ]);

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  // Fetch last 10 events per account for the live event feed.
  // We over-fetch and group in JS to avoid per-group LIMIT queries.
  const recentEventsRaw =
    accounts.length > 0
      ? await prisma.normalizedTradeEvent.findMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
          orderBy: { occurredAt: "desc" },
          take: Math.max(accounts.length * 10, 50),
          select: { accountId: true, eventType: true, occurredAt: true, pnl: true, side: true },
        })
      : [];

  // Group events by account, keeping up to 10 per account.
  const eventsByAccount: Record<string, typeof recentEventsRaw> = {};
  for (const ev of recentEventsRaw) {
    const bucket = (eventsByAccount[ev.accountId] ??= []);
    if (bucket.length < 10) bucket.push(ev);
  }

  const hasTradovate = accounts.some((a) => a.platform === "tradovate");
  const tradovateConfigured = getTradovateConfig().state === "ready";

  const adapters = getVisibleAdapters();
  const capabilityKeys: BrokerCapabilityKey[] = [
    "readAccount",
    "readBalance",
    "readPositions",
    "readOrders",
    "readPnL",
    "readExecutions",
    "cancelOrders",
    "flattenPositions",
    "brokerLevelLockout",
    "placeOrderBlock",
  ];

  const ctaHref = hasTradovate
    ? "/accounts/tradovate/verify"
    : "/accounts/connect/tradovate";
  const ctaLabel = hasTradovate
    ? "Verify connection"
    : tradovateConfigured
      ? "Connect Tradovate"
      : "Prepare Tradovate connection";

  return (
    <AppShell
      eyebrow="Accounts"
      title="Connect your broker."
      description="Link Tradovate so Guardrail can verify your account and prepare live risk checks."
      actions={
        <Link
          href={ctaHref}
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          {ctaLabel}
        </Link>
      }
    >
      <div className="grid gap-6">

        {/* Compact status row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusTile
            tone="neutral"
            label="Setup mode"
            value="Before broker connection"
          />
          <StatusTile
            tone="pending"
            label="Tradovate"
            value="Setup needed"
          />
          <StatusTile
            tone="neutral"
            label="Broker risk checks"
            value="Connection not verified yet"
          />
        </div>

        {accounts.length === 0 ? (
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
        ) : (
          <>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                recentEvents={eventsByAccount[account.id] ?? []}
                telegramReady={telegramReady}
              />
            ))}
            {!hasTradovate && (
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
          </>
        )}

        {/* Advanced — capabilities + product status, hidden by default */}
        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Technical details
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-5 grid gap-6">
            <div>
              <p className="text-sm font-medium text-stone-950">Broker capabilities</p>
              <p className="mt-1 text-xs text-stone-500">What each broker can do today.</p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                      <th className="pb-3 pr-6">Capability</th>
                      {adapters.map((a) => (
                        <th key={a.provider} className="pb-3 pr-6">
                          {a.displayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {capabilityKeys.map((key) => {
                      const label = adapters[0].getCapabilities()[key].label;
                      return (
                        <tr key={key}>
                          <td className="py-3 pr-6 font-medium text-stone-800">{label}</td>
                          {adapters.map((a) => {
                            const cap = a.getCapabilities()[key];
                            return (
                              <td key={a.provider} className="py-3 pr-6">
                                <span
                                  className={`text-xs font-semibold ${statusClass(cap.status)}`}
                                  title={cap.note ?? undefined}
                                >
                                  {statusLabel(cap.status)}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-stone-950">Product status</p>
              <div className="mt-3">
                <ProductStatusPanel variant="compact" />
              </div>
            </div>
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function StatusTile({
  tone,
  label,
  value,
}: {
  tone: "ok" | "pending" | "neutral";
  label: string;
  value: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "pending"
        ? "border-amber-200 bg-amber-50"
        : "border-stone-200 bg-stone-50";
  const valueCls =
    tone === "ok"
      ? "text-emerald-800"
      : tone === "pending"
        ? "text-amber-800"
        : "text-stone-700";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <p className="text-xs font-medium text-stone-600">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${valueCls}`}>{value}</p>
    </div>
  );
}
