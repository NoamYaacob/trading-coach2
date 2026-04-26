import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountCard } from "./_components/account-card";

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

  const capabilityTable: {
    capability: string;
    tradovate: { label: string; available: boolean };
    tradingview: { label: string; available: boolean };
    manual: { label: string; available: boolean };
  }[] = [
    {
      capability: "Read balance & equity",
      tradovate: { label: "Available", available: true },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
    {
      capability: "Read open positions",
      tradovate: { label: "Available", available: true },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
    {
      capability: "Read P&L (live fills)",
      tradovate: { label: "Available", available: true },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
    {
      capability: "App-level session lockout",
      tradovate: { label: "Available", available: true },
      tradingview: { label: "Available", available: true },
      manual: { label: "Available", available: true },
    },
    {
      capability: "Telegram enforcement alerts",
      tradovate: { label: "Available", available: true },
      tradingview: { label: "Available", available: true },
      manual: { label: "Available", available: true },
    },
    {
      capability: "Cancel open orders at broker",
      tradovate: { label: "Coming soon", available: false },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
    {
      capability: "Auto-flatten positions (kill switch)",
      tradovate: { label: "Coming soon", available: false },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
    {
      capability: "Broker-level order blocking",
      tradovate: { label: "Coming soon", available: false },
      tradingview: { label: "Coming soon", available: false },
      manual: { label: "Not available", available: false },
    },
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

        {/* Broker capability table */}
        <SectionCard
          title="Broker capabilities"
          description="What Guardrail can currently do depends on which broker is connected. Broker-level order blocking and auto-flatten are not yet implemented."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                  <th className="pb-3 pr-6">Capability</th>
                  <th className="pb-3 pr-6">Tradovate</th>
                  <th className="pb-3 pr-6">TradingView</th>
                  <th className="pb-3">Manual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {capabilityTable.map((row) => (
                  <tr key={row.capability}>
                    <td className="py-3 pr-6 font-medium text-stone-800">{row.capability}</td>
                    <td className="py-3 pr-6">
                      <span className={`text-xs font-semibold ${row.tradovate.available ? "text-emerald-700" : "text-stone-400"}`}>
                        {row.tradovate.label}
                      </span>
                    </td>
                    <td className="py-3 pr-6">
                      <span className={`text-xs font-semibold ${row.tradingview.available ? "text-emerald-700" : "text-stone-400"}`}>
                        {row.tradingview.label}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`text-xs font-semibold ${row.manual.available ? "text-emerald-700" : "text-stone-400"}`}>
                        {row.manual.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-stone-400">
            Current enforcement is app-level only: Guardrail locks the session internally and sends Telegram alerts. Live orders at the broker are not cancelled or blocked — that requires a future integration phase.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
