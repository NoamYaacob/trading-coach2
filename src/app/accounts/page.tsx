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

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connected brokers"
      description="Guardrail watches your live accounts and enforces your protection rules in real time."
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
                  Connect your Tradovate account to start live protection. Guardrail receives your
                  trade events and enforces your rules automatically via Telegram.
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
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                  How it works
                </p>
                <ol className="grid gap-2 text-stone-600">
                  <li>1. Authorize Tradovate — one click to connect</li>
                  <li>2. Set your protection rules — daily loss, trade limits</li>
                  <li>3. Go live — Guardrail enforces rules on every trade</li>
                </ol>
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
      </div>
    </AppShell>
  );
}
