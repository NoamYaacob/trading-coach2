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
      eyebrow="Accounts"
      title="Broker connections."
      description="Read-only Tradovate OAuth is being prepared. Once a broker connection is verified, risk state switches from Manual Mode to broker-driven evaluation. Broker-side enforcement actions ship per-broker only after verified support."
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

        {/* Readiness strip */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Available</p>
            <p className="mt-1 text-sm font-medium text-stone-950">Manual fallback</p>
            <p className="mt-0.5 text-xs text-stone-600">Journal-driven risk state, app-level lock.</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Pending API access</p>
            <p className="mt-1 text-sm font-medium text-stone-950">Tradovate OAuth</p>
            <p className="mt-0.5 text-xs text-stone-600">Read-only, built and waiting on endpoint verification.</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Disabled until verified</p>
            <p className="mt-1 text-sm font-medium text-stone-950">Broker enforcement</p>
            <p className="mt-0.5 text-xs text-stone-600">Cancel, flatten, lockout — ships after live verification.</p>
          </div>
        </div>

        {accounts.length === 0 ? (
          <SectionCard title="No brokers connected">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="grid gap-3">
                <p className="text-sm text-stone-600">
                  Connect your Tradovate account read-only. Once the connection is verified, risk state evaluates against broker reads instead of manual journal entries. The session locks at the app level when a rule is breached.
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
                  Manual Mode is the source of truth. Guardrail evaluates rules from journal entries and locks the session at the app level — no broker-side cancellation or flattening.
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
          description="What each broker can do today."
        >
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium text-stone-500 hover:text-stone-950">
              <span className="group-open:hidden">Show capability matrix ↓</span>
              <span className="hidden group-open:inline">Hide capability matrix ↑</span>
            </summary>
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
          </details>
          <p className="mt-4 text-xs text-stone-400">
            Cancelling, flattening, or blocking orders at the broker requires verified API support and explicit user opt-in — not enabled today.
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
