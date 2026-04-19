import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Connect a Broker",
};

export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connect a broker"
      description="Choose the platform you trade on. Guardrail will watch your live account and enforce your rules."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back
        </Link>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Tradovate — primary, live */}
        <Link
          href="/accounts/connect/tradovate"
          className="group flex flex-col gap-4 rounded-[1.75rem] border border-stone-200 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.2)] transition hover:border-stone-400 hover:shadow-[0_20px_60px_-30px_rgba(28,25,23,0.3)]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-xl bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">
              Tradovate
            </div>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
              Live
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-stone-950">Tradovate</h2>
            <p className="mt-1 text-sm text-stone-600">
              Futures and options. Guardrail receives live trade events via webhook and enforces your rules in real time.
            </p>
          </div>
          <span className="text-sm font-medium text-stone-950 transition group-hover:translate-x-0.5">
            Connect →
          </span>
        </Link>

        {/* TradingView — coming soon */}
        <div className="flex flex-col gap-4 rounded-[1.75rem] border border-stone-100 bg-stone-50 p-6 opacity-60">
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-xl bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              TradingView
            </div>
            <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-500">
              Coming soon
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-stone-700">TradingView</h2>
            <p className="mt-1 text-sm text-stone-500">Stocks, crypto, forex via broker integrations.</p>
          </div>
        </div>

        {/* Manual — fallback */}
        <Link
          href="/accounts/connect/manual"
          className="group flex flex-col gap-4 rounded-[1.75rem] border border-stone-200 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.1)] transition hover:border-stone-400"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="rounded-xl bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-stone-600">
              Manual
            </div>
            <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-500">
              Fallback
            </span>
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-stone-950">Other / Manual</h2>
            <p className="mt-1 text-sm text-stone-600">
              Set up a custom account with manual tracking. No live event feed.
            </p>
          </div>
          <span className="text-sm font-medium text-stone-950 transition group-hover:translate-x-0.5">
            Set up →
          </span>
        </Link>
      </div>
    </AppShell>
  );
}
