import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SetupOptions } from "./_components/setup-options";
import { derivePropFirmNotice } from "./prop-firm-notice";
import type { PropFirmNoticeData } from "./prop-firm-notice";

export const metadata: Metadata = {
  title: "Set Up Account — Guardrail",
};

const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
};

// ── PropFirmNotice ────────────────────────────────────────────────────────────

function PropFirmNotice({ notice }: { notice: PropFirmNoticeData }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
      <p className="text-sm font-semibold text-amber-900">
        Confirm this account&apos;s rules before monitoring
      </p>
      <p className="mt-1.5 text-sm leading-6 text-amber-800">
        This looks like a new {notice.contextLabel} account. Prop firm limits can change between
        Evaluation, Funded, Sim, and Live accounts. Choose the rule set that matches this account
        before Guardrail starts monitoring it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800">
          Detected phase: {notice.phaseLabel}
        </span>
        {notice.propFirmName && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-800">
            Prop firm: {notice.propFirmName}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

export default async function AccountSetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const { id } = await params;

  const [account, defaultRules] = await Promise.all([
    prisma.connectedAccount.findFirst({
      where: { id, userId: currentUser.id, isActive: true },
      select: {
        id: true,
        label: true,
        platform: true,
        accountType: true,
        propFirm: true,
        externalAccountId: true,
        protectionStatus: true,
      },
    }),
    prisma.riskRules.findUnique({
      where: { userId: currentUser.id },
      select: { maxDailyLoss: true, maxTradesPerDay: true, stopAfterLosses: true },
    }),
  ]);

  if (!account) notFound();

  // Only pending_decision accounts need this setup page.
  // Already-configured accounts go to the edit page.
  if (account.protectionStatus !== "pending_decision") {
    redirect(`/accounts/${id}/edit`);
  }

  const platformLabel = PLATFORM_LABEL[account.platform] ?? account.platform;
  const accountTypeLabel = ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType;

  const hasDefaultRules = Boolean(
    defaultRules &&
      (defaultRules.maxDailyLoss != null ||
        defaultRules.maxTradesPerDay != null ||
        defaultRules.stopAfterLosses != null),
  );

  const propFirmNotice = derivePropFirmNotice({
    propFirm: account.propFirm,
    accountType: account.accountType,
    label: account.label,
  });

  const defaultRulesSummary = hasDefaultRules && defaultRules
    ? [
        defaultRules.maxDailyLoss != null && `Max loss: $${Number(defaultRules.maxDailyLoss)}`,
        defaultRules.maxTradesPerDay != null && `Max trades/day: ${defaultRules.maxTradesPerDay}`,
        defaultRules.stopAfterLosses != null && `Stop after ${defaultRules.stopAfterLosses} losses`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 lg:px-10">
        <Link
          href="/"
          className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80"
        >
          Guardrail
        </Link>
        <Link href="/dashboard" className="text-sm text-stone-600 transition hover:text-stone-950">
          Back to dashboard
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-20 pt-6 sm:px-6 lg:px-10">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
            New account detected
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-stone-950 sm:text-3xl">
            Choose rules for this account
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Guardrail found a new {platformLabel} account. Choose how rules should apply before
            monitoring starts.
          </p>
        </div>

        {/* Account summary */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-stone-950">{account.label}</p>
            <p className="mt-0.5 text-xs text-stone-500">
              {platformLabel}
              <span aria-hidden> · </span>
              {accountTypeLabel}
              {account.propFirm ? ` · ${account.propFirm}` : ""}
              {account.externalAccountId ? ` · ID ${account.externalAccountId}` : ""}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800">
            Setup needed
          </span>
        </div>

        {propFirmNotice && <PropFirmNotice notice={propFirmNotice} />}

        <SetupOptions
          accountId={account.id}
          hasDefaultRules={hasDefaultRules}
          defaultRulesSummary={defaultRulesSummary ?? null}
        />

        <p className="text-xs leading-5 text-stone-500">
          Guardrail evaluates rules in-app from connected broker data. Alerts fire when a limit is
          hit. Broker-side actions require separate opt-in.
        </p>
      </main>
    </div>
  );
}
