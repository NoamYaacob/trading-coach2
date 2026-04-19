import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "../../_components/account-form";

export const metadata: Metadata = {
  title: "Connect Tradovate",
};

export default async function ConnectTradovatePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connect Tradovate"
      description="Enter your Tradovate account ID and configure your protection rules. Guardrail will watch your live account and intervene via Telegram when your limits are hit."
      actions={
        <Link
          href="/accounts/new"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back
        </Link>
      }
    >
      <div className="grid gap-6">
        {/* Connection flow steps */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { n: "1", label: "Account ID", detail: "Your Tradovate numeric ID" },
            { n: "2", label: "Protection rules", detail: "Daily loss, trade limits" },
            { n: "3", label: "Webhook", detail: "Route live events to Guardrail" },
          ].map((step) => (
            <div
              key={step.n}
              className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                  {step.n}
                </span>
                <span className="text-xs font-semibold text-stone-700">{step.label}</span>
              </div>
              <p className="text-xs text-stone-500">{step.detail}</p>
            </div>
          ))}
        </div>

        <SectionCard
          title="Account setup"
          description="Fill in your account details and protection rules. After saving, you will be taken to the connection readiness page."
        >
          <AccountForm mode="create" lockedPlatform="tradovate" />
        </SectionCard>
      </div>
    </AppShell>
  );
}
