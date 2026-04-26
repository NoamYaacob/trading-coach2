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

  const capabilityTable = [
    { capability: "Read balance & equity", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Read open positions", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Read open orders", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Read P&L (live fills)", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Cancel open orders", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Flatten positions (kill switch)", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
    { capability: "Broker-level lockout", tradovate: "Available", tradingview: "Coming soon", manual: "Not available" },
  ];

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connected accounts."
      description="Connect a broker to enable live enforcement. Guardrail reads fills and P&L directly from your account and enforces your rules automatically — no manual input required."
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
                  Connect your Tradovate account to enable live enforcement. Guardrail receives
                  fills and P&L updates in real time and locks the session the moment a rule is
                  crossed. No manual logging required.
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
          description="What Guardrail can do depends on which broker is connected and which API permissions are granted."
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
                      <span className={`text-xs font-semibold ${row.tradovate === "Available" ? "text-emerald-700" : "text-stone-400"}`}>
                        {row.tradovate}
                      </span>
                    </td>
                    <td className="py-3 pr-6">
                      <span className="text-xs font-semibold text-stone-400">{row.tradingview}</span>
                    </td>
                    <td className="py-3">
                      <span className="text-xs font-semibold text-stone-400">{row.manual}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
