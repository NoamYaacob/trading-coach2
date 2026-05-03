import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SelectAccountsForm } from "./_components/select-accounts-form";

export const metadata: Metadata = {
  title: "Select Accounts — Guardrail",
};

type DiscoveredAccount = {
  externalAccountId: string;
  name: string;
  accountType: string;
  active: boolean;
};

export default async function SelectAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ setupId?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const { setupId } = await searchParams;
  if (!setupId) redirect("/accounts/connect/tradovate");

  const setup = await prisma.pendingBrokerSetup.findFirst({
    where: {
      id: setupId,
      userId: currentUser.id,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      env: true,
      displayName: true,
      accountSource: true,
      propFirmName: true,
      brokerConnectionId: true,
      discoveredAccountsJson: true,
    },
  });

  // Expired, tampered, or not yet OAuth-completed → back to start.
  if (!setup) {
    redirect("/accounts/connect/tradovate?error=setup_not_found");
  }
  if (!setup.brokerConnectionId) {
    redirect("/accounts/connect/tradovate?error=setup_not_found");
  }

  let discoveredAccounts: DiscoveredAccount[] = [];
  if (Array.isArray(setup.discoveredAccountsJson)) {
    discoveredAccounts = (setup.discoveredAccountsJson as unknown[])
      .filter(
        (a): a is DiscoveredAccount =>
          typeof a === "object" &&
          a !== null &&
          typeof (a as Record<string, unknown>).externalAccountId === "string",
      )
      .map((a) => ({
        externalAccountId: a.externalAccountId,
        name: typeof a.name === "string" ? a.name : a.externalAccountId,
        accountType: typeof a.accountType === "string" ? a.accountType : "unknown",
        active: Boolean(a.active),
      }));
  }

  const envLabel = setup.env === "demo" ? "Demo / Sim" : "Live";
  const sourceLabel =
    setup.accountSource === "prop_firm"
      ? setup.propFirmName ?? "Prop firm"
      : setup.accountSource === "personal"
        ? "Personal account"
        : setup.accountSource === "demo"
          ? "Demo account"
          : "Other";

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 lg:px-10">
        <Link
          href="/"
          className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80"
        >
          Guardrail
        </Link>
        <Link href="/accounts" className="text-sm text-stone-600 transition hover:text-stone-950">
          Back to accounts
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-20 pt-6 sm:px-6 lg:px-10">

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            Broker Connections · Tradovate
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-stone-950 sm:text-3xl">
            Select accounts to import
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
            <span>
              <span className="font-medium text-stone-800">Environment:</span> {envLabel}
            </span>
            <span>
              <span className="font-medium text-stone-800">Account source:</span> {sourceLabel}
            </span>
            {discoveredAccounts.length > 0 && (
              <span>
                <span className="font-medium text-stone-800">Found:</span>{" "}
                {discoveredAccounts.length} account{discoveredAccounts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>

        <SelectAccountsForm
          setupId={setup.id}
          env={setup.env}
          accountSource={setup.accountSource}
          propFirmName={setup.propFirmName}
          displayName={setup.displayName}
          discoveredAccounts={discoveredAccounts}
        />

      </main>
    </div>
  );
}
