// TODO: Broker-synced Trade Review is not yet implemented.
//
// This page currently reads from ManualTradeEntry, which is the old manual-entry
// table from the removed Manual Mode workflow. ManualTradeEntry should not be
// presented as product data.
//
// Future implementation should:
//   1. Read from NormalizedTradeEvent (already populated by the Tradovate webhook)
//      or a dedicated broker-synced Trade/Execution table derived from it.
//   2. Scope entries by ConnectedAccount so trades are never mixed across accounts.
//   3. Show last-synced time from ConnectedAccount.fillsSyncedAt.
//   4. Surface sync errors from ConnectedAccount.connectionStatus / errorMessage.
//
// Until that work ships, this page shows a disabled state. The route is kept
// stable so existing links do not 404.

import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Trade Review — Guardrail",
};

export default async function JournalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <AppShell
      eyebrow="Trade Review"
      title="Coming soon."
      description="Broker-synced trade history will appear here once the trade import pipeline is connected."
    >
      <div className="mx-auto max-w-lg">
        <div className="rounded-2xl border border-stone-200 bg-white/90 px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
            <svg
              className="h-6 w-6 text-stone-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          </div>

          <h2 className="text-lg font-semibold text-stone-950">
            Broker-synced Trade Review is not active yet
          </h2>

          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            Guardrail currently uses broker events for live rule monitoring and
            interventions. A full broker-synced trade review page will be enabled
            once trade import is connected to this view.
          </p>

          <div className="mt-6 grid gap-2">
            <Link
              href="/accounts"
              className="block rounded-xl bg-stone-950 px-4 py-2.5 text-sm font-medium text-stone-50 transition-colors hover:bg-stone-800"
            >
              Connect Tradovate
            </Link>
            <Link
              href="/dashboard"
              className="block rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              View Dashboard
            </Link>
            <Link
              href="/rules"
              className="block rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50"
            >
              Manage Rules
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
