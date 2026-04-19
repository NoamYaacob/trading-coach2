import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AccountForm } from "../../_components/account-form";
import type { AccountFormInitialData } from "../../_components/account-form";

export const metadata: Metadata = {
  title: "Edit Account",
};

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { id } = await params;

  const account = await prisma.connectedAccount.findFirst({
    where: { id, userId: currentUser.id },
    include: { riskRules: true },
  });

  if (!account) {
    notFound();
  }

  const initialData: AccountFormInitialData = {
    label: account.label,
    platform: account.platform,
    propFirm: account.propFirm,
    accountType: account.accountType,
    externalAccountId: account.externalAccountId,
    currency: account.currency,
    isActive: account.isActive,
    riskRules: account.riskRules
      ? {
          maxDailyLoss: account.riskRules.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss) : null,
          riskPerTrade: account.riskRules.riskPerTrade != null ? Number(account.riskRules.riskPerTrade) : null,
          maxTradesPerDay: account.riskRules.maxTradesPerDay,
          stopAfterLosses: account.riskRules.stopAfterLosses,
          allowedStartHour: account.riskRules.allowedStartHour,
          allowedEndHour: account.riskRules.allowedEndHour,
        }
      : null,
  };

  return (
    <AppShell
      eyebrow="Accounts"
      title={account.label}
      description="Update this account's details and guardian rules."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back to accounts
        </Link>
      }
    >
      <SectionCard
        title="Account setup"
        description="Changes take effect immediately. Guardian rules apply to the next event processed."
      >
        <AccountForm mode="edit" accountId={account.id} initialData={initialData} />
      </SectionCard>
    </AppShell>
  );
}
