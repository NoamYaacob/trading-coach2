import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Assign Rules — Guardrail",
};

export default async function RulesAssignmentPage({
  searchParams,
}: {
  searchParams: Promise<{ accountIds?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const { accountIds: accountIdsParam } = await searchParams;
  const accountIds = accountIdsParam
    ? accountIdsParam.split(",").filter(Boolean).slice(0, 20)
    : [];

  if (accountIds.length === 0) redirect("/accounts");

  const [accounts, defaultRules] = await Promise.all([
    prisma.connectedAccount.findMany({
      where: { id: { in: accountIds }, userId: currentUser.id, isActive: true },
      select: { id: true, label: true, accountType: true, propFirm: true, riskRules: true },
      orderBy: { label: "asc" },
    }),
    prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { maxDailyLoss: true, maxTradesPerDay: true, stopAfterLosses: true },
    }),
  ]);

  if (accounts.length === 0) redirect("/accounts");

  const hasDefaultRules = Boolean(
    defaultRules &&
      (defaultRules.maxDailyLoss != null ||
        defaultRules.maxTradesPerDay != null ||
        defaultRules.stopAfterLosses != null),
  );

  const firstAccountId = accounts[0]!.id;

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
          Skip for now
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            Broker Connections · Step 3 of 3
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-stone-950 sm:text-3xl">
            Assign a trading plan
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Choose how Guardrail evaluates rules for the{" "}
            {accounts.length === 1 ? "imported account" : `${accounts.length} imported accounts`}.
            You can change this at any time.
          </p>
        </div>

        {/* Imported accounts summary */}
        <div className="grid gap-1.5">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3"
            >
              <span className="text-sm font-medium text-stone-950">{a.label}</span>
              <span className="text-xs text-stone-500">
                {a.propFirm ?? a.accountType}
              </span>
            </div>
          ))}
        </div>

        {/* Rule options */}
        <div className="grid gap-4">

          {/* Option 1: Default trading plan */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-stone-950">Default trading plan</p>
                  {hasDefaultRules && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      Configured
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {hasDefaultRules
                    ? "Your default plan applies automatically to all accounts without account-specific rules."
                    : "Set a single rule profile that applies to all accounts. Best for consistent limits across your accounts."}
                </p>
                {hasDefaultRules && defaultRules && (
                  <p className="mt-2 text-xs text-stone-500">
                    {[
                      defaultRules.maxDailyLoss != null && `Max loss: $${Number(defaultRules.maxDailyLoss)}`,
                      defaultRules.maxTradesPerDay != null && `Max trades/day: ${defaultRules.maxTradesPerDay}`,
                      defaultRules.stopAfterLosses != null && `Stop after ${defaultRules.stopAfterLosses} losses`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {hasDefaultRules ? (
                <Link
                  href="/accounts"
                  className="inline-flex items-center rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Use default plan →
                </Link>
              ) : (
                <Link
                  href="/rules"
                  className="inline-flex items-center rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Configure default plan →
                </Link>
              )}
              {hasDefaultRules && (
                <Link
                  href="/rules"
                  className="inline-flex items-center rounded-full border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                >
                  Edit default plan
                </Link>
              )}
            </div>
          </div>

          {/* Option 2: Account-specific trading plan */}
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-stone-950">Account-specific trading plan</p>
            <p className="mt-1 text-sm text-stone-600">
              Set custom rules per account. Useful when accounts have different drawdown limits,
              position sizes, or evaluation requirements.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {accounts.length === 1 ? (
                <Link
                  href={`/accounts/${firstAccountId}/edit`}
                  className="inline-flex items-center rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                >
                  Set rules for this account →
                </Link>
              ) : (
                <Link
                  href="/accounts"
                  className="inline-flex items-center rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                >
                  Set rules per account →
                </Link>
              )}
            </div>
          </div>

          {/* Option 3: Monitor only */}
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-700">Monitor only</p>
            <p className="mt-1 text-sm text-stone-500">
              No rule evaluation — Guardrail records your trades and syncs account data without
              checking limits. You can add rules later.
            </p>
            <div className="mt-4">
              <Link
                href="/accounts"
                className="inline-flex items-center rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
              >
                Continue without rules
              </Link>
            </div>
          </div>

        </div>

        <p className="text-xs leading-5 text-stone-500">
          Guardrail evaluates rules locally — alerts fire when a limit is hit. Broker-side enforcement
          (cancel, flatten, lockout) is not active and requires separate opt-in.
        </p>
      </main>
    </div>
  );
}
