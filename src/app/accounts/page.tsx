import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { ConnectionCard } from "./_components/connection-group-card";
import { PAGE_SUBTITLE } from "./_components/connection-card-logic";

export const metadata: Metadata = {
  title: "Broker Connections — Guardrail",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const brokerConnections = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id },
    select: {
      id: true,
      platform: true,
      env: true,
      connectionStatus: true,
      accounts: {
        where: { isActive: true, protectionStatus: { not: "archived" } },
        select: {
          id: true,
          label: true,
          lastSyncAt: true,
        },
        orderBy: { label: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const tradovateConfigured = getTradovateConfig().state === "ready";

  return (
    <AppShell
      eyebrow="Broker connections"
      title="Broker connections"
      description={PAGE_SUBTITLE}
      actions={
        <Link
          href="/accounts/connect/tradovate"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          {tradovateConfigured ? "Connect Tradovate" : "Prepare Tradovate connection"}
        </Link>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-stone-500">
          Guardrail reads account data to evaluate rules — it cannot place trades or modify your account.
        </p>

        {brokerConnections.length === 0 ? (
          <div className="rounded-xl border border-stone-200 px-4 py-3 text-sm text-stone-500">
            No connections yet.{" "}
            <Link
              href="/accounts/connect/tradovate"
              className="font-medium text-stone-950 underline-offset-2 hover:underline"
            >
              Connect Tradovate
            </Link>{" "}
            to get started.
          </div>
        ) : (
          <div className="grid gap-3">
            {brokerConnections.map((bc) => (
              <ConnectionCard key={bc.id} connection={bc} />
            ))}
          </div>
        )}

        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Advanced
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="mt-4 space-y-2 text-sm text-stone-500">
            <p>
              Tradovate OAuth provides read-only access to account data. Guardrail evaluates rules
              locally and sends alerts — it cannot place or cancel trades.
            </p>
            <p>
              Broker-side order blocking requires full-access permissions and explicit opt-in. This
              feature is not currently active.
            </p>
          </div>
        </details>
      </div>
    </AppShell>
  );
}
