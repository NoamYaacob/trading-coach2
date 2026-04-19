import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "../../_components/account-form";

export const metadata: Metadata = {
  title: "Manual Account Setup",
};

export default async function ConnectManualPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Manual account"
      description="Set up an account for manual tracking or a platform without live event integration."
      actions={
        <Link
          href="/accounts/new"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back
        </Link>
      }
    >
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-700">
        Manual accounts do not receive live broker events. Guardian rules will not be enforced automatically.
        For live protection, use{" "}
        <Link href="/accounts/connect/tradovate" className="font-medium underline-offset-2 hover:underline">
          Connect Tradovate
        </Link>{" "}
        instead.
      </div>
      <div className="mt-6">
        <SectionCard
          title="Account details"
          description="Guardian rules can be configured but will only apply when events are logged manually."
        >
          <AccountForm mode="create" />
        </SectionCard>
      </div>
    </AppShell>
  );
}
