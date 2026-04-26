import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { ProductStatusPanel } from "@/components/ui/product-status-panel";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getVisibleAdapters } from "@/lib/brokers/registry";
import type {
  BrokerCapabilityKey,
  BrokerCapabilityStatus,
} from "@/lib/brokers/types";
import { AccountCard } from "./_components/account-card";

function statusLabel(status: BrokerCapabilityStatus): string {
  switch (status) {
    case "available":      return "Available";
    case "requires_oauth": return "OAuth required";
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
  title: "Broker Connections",
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

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connected accounts."
      description="Connect a broker so Guardrail reads fills and P&L directly from your account. Rules then evaluate against live data instead of manual entries. Broker-level order blocking is on the roadmap."
      actions={
        <Link
          href="/accounts/connect/tradovate"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Connect Tradovate
        </Link>
      }
    >
      <div className="grid gap-6">
        {accounts.length === 0 ? (
          <SectionCard title="No brokers connected">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="grid gap-3">
                <p className="text-sm text-stone-600">
                  Connect your Tradovate account so Guardrail reads fills and P&L in real time. Rules then evaluate against live broker data — no manual logging needed. The session locks at the app level when a rule is crossed.
                </p>
                <div>
                  <Link
                    href="/accounts/connect/tradovate"
                    className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                  >
                    Connect Tradovate
                  </Link>
                </div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Without a broker
                </p>
                <p className="text-stone-700">
                  Manual mode tracks and warns only. Guardrail enforces rules based on what you
                  log manually — no automatic position flattening or kill switch.
                </p>
              </div>
            </div>
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
                  Add a Tradovate account for live protection.{" "}
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

        {/* Broker capability table — driven by the broker registry. */}
        <SectionCard
          title="Broker capabilities"
          description="What each broker can do today. Statuses are sourced from the broker adapter registry — they update automatically as integrations land."
        >
          <div className="overflow-x-auto">
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
                  // All adapters expose the same key set, so use the first
                  // adapter's label as the row label.
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
          <p className="mt-4 text-xs text-stone-400">
            Current enforcement is app-level only: Guardrail locks the session internally and sends Telegram alerts. Live orders at the broker are not cancelled or blocked — that requires a future integration phase.
          </p>
        </SectionCard>

        {/* Current product status — honest snapshot of what's available, prepared,
            pending API access, and disabled. Pulls real config state. */}
        <SectionCard
          title="Current product status"
          description="What's available today, what's prepared, and what's gated on real Tradovate API access. Updates automatically from server configuration."
        >
          <ProductStatusPanel />
        </SectionCard>
      </div>
    </AppShell>
  );
}
