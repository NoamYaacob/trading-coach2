import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "../_components/account-form";

export const metadata: Metadata = {
  title: "New Account",
};

export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <AppShell
      eyebrow="Accounts"
      title="New account"
      description="Connect a trading account and configure its guardian rules."
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
        description="Set the account details and the guardian rules that will protect this account."
      >
        <AccountForm mode="create" />
      </SectionCard>
    </AppShell>
  );
}
