import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountCard } from "./_components/account-card";

export const metadata: Metadata = {
  title: "Accounts",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id },
    include: {
      riskRules: true,
      sessionState: true,
      interventions: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Most recent normalized trade event per account — used to show last-event type.
  const recentEvents =
    accounts.length > 0
      ? await prisma.normalizedTradeEvent.findMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
          orderBy: { occurredAt: "desc" },
          distinct: ["accountId"],
          select: { accountId: true, eventType: true, occurredAt: true },
        })
      : [];

  const lastEventByAccount = Object.fromEntries(recentEvents.map((e) => [e.accountId, e]));

  return (
    <AppShell
      eyebrow="Connected Accounts"
      title="Account & Guardian Status"
      description="Live guardian state, session stats, and recent interventions per connected trading account."
      actions={
        <Link
          href="/accounts/new"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          New account
        </Link>
      }
    >
      <div className="grid gap-6">
        {accounts.length === 0 ? (
          <SectionCard title="No accounts connected">
            <p className="text-sm text-stone-600">
              No connected trading accounts yet. Use the New account button above to get started.
            </p>
          </SectionCard>
        ) : (
          accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              lastEvent={lastEventByAccount[account.id] ?? null}
            />
          ))
        )}
      </div>
    </AppShell>
  );
}
