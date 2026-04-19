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
              No connected trading accounts found. POST to{" "}
              <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs">/api/accounts</code>{" "}
              to add one.
            </p>
          </SectionCard>
        ) : (
          accounts.map((account) => <AccountCard key={account.id} account={account} />)
        )}
      </div>
    </AppShell>
  );
}
