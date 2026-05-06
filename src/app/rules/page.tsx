import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGuardianSnapshot } from "@/lib/guardian";
import { getProtectionLockState } from "@/lib/account-protection";
import { RulesForm, type RulesFormValues } from "./_components/rules-form";
import { GuardianToggle } from "./_components/guardian-toggle";
import { ScopeSelector } from "./_components/scope-selector";
import { AccountRulesForm, type AccountRulesValues, type DefaultRuleValues } from "./_components/account-rules-form";
import { buildRuleScopes } from "./_components/rule-scope-utils";
import { computeEnforcementMode } from "./_components/enforcement-mode";

export const metadata: Metadata = {
  title: "Trading Plan — Guardrail",
};

// ── Value converters (Decimal → string, int → string) ─────────────────────────

function decStr(v: { toString(): string } | null | undefined): string {
  return v != null ? Number(v).toString() : "";
}

function intStr(v: number | null | undefined): string {
  return v != null ? String(v) : "";
}

function parseTradingDays(v: string | null | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string }>;
}) {
  const { scope = "default", id } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, accounts, guardian, traderProfile] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount.findMany({
      where: { userId: user.id, isActive: true, protectionStatus: { not: "archived" } },
      select: {
        id: true,
        label: true,
        platform: true,
        propFirm: true,
        connectionStatus: true,
        brokerConnectionId: true,
        missingFromBrokerSince: true,
        brokerConnection: {
          select: {
            id: true,
            platform: true,
            env: true,
            brokerUserId: true,
            connectionStatus: true,
          },
        },
        riskRules: {
          select: {
            maxDailyLoss: true, riskPerTrade: true,
            maxTradesPerDay: true, stopAfterLosses: true,
            allowedStartHour: true, allowedEndHour: true,
            propFirmAccountSize: true, propFirmPhase: true,
            propFirmDailyLossLimit: true, propFirmMaxDrawdown: true,
            propFirmEODDrawdown: true, propFirmTrailingDrawdown: true,
            propFirmDrawdownRemaining: true, propFirmProfitTarget: true,
            propFirmMinTradingDays: true,
          },
        },
      },
      orderBy: { label: "asc" },
    }),
    getGuardianSnapshot(user.id),
    prisma.traderProfile.findFirst({ where: { userId: user.id }, select: { timezone: true } }),
  ]);

  const protectionLock = getProtectionLockState({
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
    cutoffMinutes: riskRules?.protectionLockCutoffMinutes ?? null,
  });

  const hasDefaultRules = Boolean(
    riskRules &&
      (riskRules.maxDailyLoss != null ||
        riskRules.maxTradesPerDay != null ||
        riskRules.stopAfterLosses != null ||
        riskRules.riskPerTrade != null),
  );

  // Build scope selector data
  const scopeAccounts = accounts.map((a) => ({
    ...a,
    hasAccountRules: a.riskRules !== null,
  }));
  const { groups } = buildRuleScopes(scopeAccounts);

  // Resolve selected account when scope=account
  const selectedAccount =
    scope === "account" && id ? accounts.find((a) => a.id === id) ?? null : null;

  // Build default template initial values
  const defaultInitial: RulesFormValues = {
    accountSize: decStr(riskRules?.accountSize),
    maxDailyLoss: decStr(riskRules?.maxDailyLoss),
    dailyProfitTarget: decStr(riskRules?.dailyProfitTarget),
    maxRiskPerTrade: decStr(riskRules?.maxRiskPerTrade ?? riskRules?.riskPerTrade),
    maxTradesPerDay: intStr(riskRules?.maxTradesPerDay),
    stopAfterLosses: intStr(riskRules?.stopAfterLosses),
    maxContracts: intStr(riskRules?.maxContracts),
    allowedSymbols: riskRules?.allowedSymbols ?? "",
    sessionStartHour: intStr(riskRules?.sessionStartHour),
    sessionEndHour: intStr(riskRules?.sessionEndHour),
    tradingDays: parseTradingDays(riskRules?.tradingDays),
    newsLockoutEnabled: riskRules?.newsLockoutEnabled ?? false,
    onBreachWarn: riskRules?.onBreachWarn ?? true,
    onBreachAppLock: riskRules?.onBreachAppLock ?? true,
    onBreachCancelOrders: riskRules?.onBreachCancelOrders ?? false,
    onBreachFlatten: riskRules?.onBreachFlatten ?? false,
  };

  const hasPendingPayload = Boolean(riskRules?.pendingPayloadJson && riskRules?.pendingEffectiveDate);

  // Build account-specific initial values (only used when scope=account)
  const accountInitial: AccountRulesValues = {
    maxDailyLoss: decStr(selectedAccount?.riskRules?.maxDailyLoss),
    riskPerTrade: decStr(selectedAccount?.riskRules?.riskPerTrade),
    maxTradesPerDay: intStr(selectedAccount?.riskRules?.maxTradesPerDay),
    stopAfterLosses: intStr(selectedAccount?.riskRules?.stopAfterLosses),
    allowedStartHour: intStr(selectedAccount?.riskRules?.allowedStartHour),
    allowedEndHour: intStr(selectedAccount?.riskRules?.allowedEndHour),
    propFirmAccountSize: decStr(selectedAccount?.riskRules?.propFirmAccountSize),
    propFirmPhase: selectedAccount?.riskRules?.propFirmPhase ?? "",
    propFirmDailyLossLimit: decStr(selectedAccount?.riskRules?.propFirmDailyLossLimit),
    propFirmMaxDrawdown: decStr(selectedAccount?.riskRules?.propFirmMaxDrawdown),
    propFirmEODDrawdown: decStr(selectedAccount?.riskRules?.propFirmEODDrawdown),
    propFirmTrailingDrawdown: selectedAccount?.riskRules?.propFirmTrailingDrawdown ?? false,
    propFirmDrawdownRemaining: decStr(selectedAccount?.riskRules?.propFirmDrawdownRemaining),
    propFirmProfitTarget: decStr(selectedAccount?.riskRules?.propFirmProfitTarget),
    propFirmMinTradingDays: intStr(selectedAccount?.riskRules?.propFirmMinTradingDays),
  };

  const hasBroker = accounts.some((a) => a.platform !== "manual" && a.brokerConnectionId != null);

  const accountDefaultValues: DefaultRuleValues = {
    maxDailyLoss: decStr(riskRules?.maxDailyLoss),
    riskPerTrade: decStr(riskRules?.riskPerTrade),
    maxTradesPerDay: intStr(riskRules?.maxTradesPerDay),
    stopAfterLosses: intStr(riskRules?.stopAfterLosses),
    allowedStartHour: intStr(riskRules?.sessionStartHour),
    allowedEndHour: intStr(riskRules?.sessionEndHour),
  };

  // Enforcement mode for the current scope (scoped to brokerConnectionId + accountId)
  const enforcementInfo = computeEnforcementMode(
    scope === "account" && selectedAccount
      ? {
          platform: selectedAccount.platform,
          brokerConnectionId: selectedAccount.brokerConnectionId,
          brokerConnection: selectedAccount.brokerConnection
            ? {
                platform: selectedAccount.brokerConnection.platform,
                connectionStatus: selectedAccount.brokerConnection.connectionStatus,
              }
            : null,
        }
      : null,
    scope !== "account",
  );

  return (
    <AppShell
      eyebrow="Trading Plan"
      title="Set your trading plan."
      description="Choose the limits Guardrail monitors during each session."
      compactHero
      actions={
        <Link
          href="/guardian"
          className="inline-flex items-center justify-center rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          View status
        </Link>
      }
    >
      {/* Two-column layout: selector sidebar + editor */}
      <div className="grid gap-5 lg:grid-cols-[260px_1fr] lg:items-start lg:gap-8">

        {/* ── Scope selector ──────────────────────────────────────────────── */}

        {/* Mobile: collapsible — collapses after scope selection so editor is visible */}
        <details className="rounded-2xl border border-stone-200 bg-white/90 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
              Configure rules for…
            </span>
            <span className="text-stone-400 select-none">▾</span>
          </summary>
          <div className="border-t border-stone-100 px-3 pb-3 pt-2">
            <ScopeSelector
              groups={groups}
              currentScope={scope}
              currentAccountId={id ?? null}
            />
          </div>
        </details>

        {/* Desktop: always-visible sticky sidebar */}
        <div className="hidden rounded-2xl border border-stone-200 bg-white/90 p-3 lg:block lg:sticky lg:top-6">
          <p className="mb-2 px-3.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
            Configure rules for
          </p>
          <ScopeSelector
            groups={groups}
            currentScope={scope}
            currentAccountId={id ?? null}
          />
        </div>

        {/* ── Rule editor ─────────────────────────────────────────────────── */}
        <div className="grid gap-5">

          {/* Scope context header */}
          <ScopeContextHeader scope={scope} account={selectedAccount} />

          {/* Enforcement mode banner */}
          <div className={`rounded-xl border px-4 py-3 text-xs ${enforcementInfo.cls}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-semibold">{enforcementInfo.label}. </span>
                {enforcementInfo.detail}
              </div>
              <code className="shrink-0 self-start rounded bg-current/10 px-1.5 py-0.5 font-mono text-[9px] opacity-40">
                {enforcementInfo.mode}
              </code>
            </div>
          </div>

          {/* Lock / pending banners — default scope only */}
          {scope !== "account" && protectionLock.isLocked && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-800">
              <p className="font-medium">Today&apos;s rules are locked.</p>
              <p className="mt-1 text-[13px] text-amber-700">
                Saved changes will apply on the next trading day ({protectionLock.nextTradingDayKey}).
              </p>
            </div>
          )}
          {scope !== "account" && hasPendingPayload && riskRules?.pendingEffectiveDate && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm text-sky-800">
              <p>
                You have rule changes pending — they apply on{" "}
                <span className="font-semibold">{riskRules.pendingEffectiveDate}</span>.
              </p>
            </div>
          )}

          {/* Editor body */}
          {scope === "account" ? (
            selectedAccount ? (
              <SectionCard
                title={selectedAccount.label}
                description={buildAccountSubtitle(selectedAccount)}
              >
                <AccountRulesForm
                  accountId={selectedAccount.id}
                  accountLabel={selectedAccount.label}
                  hasExistingRules={selectedAccount.riskRules !== null}
                  initial={accountInitial}
                  isLocked={protectionLock.isLocked}
                  hasPropFirm={Boolean(selectedAccount.propFirm)}
                  hasDefaultRules={hasDefaultRules}
                  timezone={traderProfile?.timezone}
                  defaultValues={accountDefaultValues}
                />
              </SectionCard>
            ) : (
              <SectionCard title="Account not found">
                <p className="text-sm text-stone-600">
                  The selected account was not found.{" "}
                  <Link href="/rules" className="font-medium underline-offset-2 hover:underline">
                    Back to default template
                  </Link>
                </p>
              </SectionCard>
            )
          ) : (
            /* Default template editor */
            <SectionCard
              title="Default template"
              description="These limits apply to any account that doesn't have account-specific rules."
            >
              <div id="guardian-toggle" className="mb-5 scroll-mt-20">
                <GuardianToggle initialEnabled={guardian.profile.guardianEnabled} />
              </div>
              <RulesForm initial={defaultInitial} hasBroker={hasBroker} timezone={traderProfile?.timezone} />
            </SectionCard>
          )}

          {/* No broker accounts — push toward connection */}
          {scope !== "account" && groups.length === 0 && (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
              <p className="font-medium text-stone-950">No broker accounts connected.</p>
              <p className="mt-1">
                Connect your broker to enable live account monitoring. The rules above apply as session defaults across connected accounts.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/accounts/connect/tradovate"
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Connect Tradovate
                </Link>
              </div>
            </div>
          )}

        </div>
      </div>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

type SelectedAccount = {
  label: string;
  platform: string;
  propFirm: string | null;
  connectionStatus: string;
  brokerConnectionId: string | null;
  brokerConnection: {
    platform: string;
    env: string;
    brokerUserId: string | null;
    connectionStatus: string;
  } | null;
} | null;

function buildAccountSubtitle(account: NonNullable<SelectedAccount>): string {
  const parts: string[] = [];
  if (account.propFirm) parts.push(account.propFirm);
  const conn = account.brokerConnection;
  if (conn) {
    const pLabel = conn.platform === "tradovate" ? "Tradovate"
      : conn.platform === "tradingview" ? "TradingView"
      : conn.platform;
    const eLabel = conn.env === "live" ? "Live account" : conn.env === "demo" ? "Demo / Sim" : conn.env;
    parts.push(`${pLabel} · ${eLabel}`);
    if (conn.connectionStatus === "connected_readonly") {
      parts.push("Read-only connection");
    }
    if (conn.brokerUserId) {
      const uid = conn.brokerUserId.length > 14
        ? `${conn.brokerUserId.slice(0, 12)}…`
        : conn.brokerUserId;
      parts.push(`User ID ${uid}`);
    }
  }
  return parts.join(" · ");
}

function ScopeContextHeader({
  scope,
  account,
}: {
  scope: string;
  account: SelectedAccount;
}) {
  if (scope !== "account") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Trading Plan
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-stone-950">
          Default template
        </h2>
        <p className="mt-0.5 text-sm text-stone-500">
          Applies to all accounts without account-specific rules. Select an account on the left to
          configure it individually.
        </p>
      </div>
    );
  }

  if (!account) return null;

  const conn = account.brokerConnection;
  const envLabel = conn?.env === "live" ? "Live account" : conn?.env === "demo" ? "Demo / Sim" : (conn?.env ?? "");
  const readOnlySuffix = conn?.connectionStatus === "connected_readonly" ? " · Read-only connection" : "";
  const firmLine = account.propFirm
    ? account.propFirm
    : conn
    ? `${conn.platform === "tradovate" ? "Tradovate" : conn.platform} · ${envLabel}${readOnlySuffix}`
    : null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
        Trading Plan · Account rules
      </p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-stone-950">
        {account.label}
      </h2>
      <p className="mt-0.5 text-sm text-stone-500">{firmLine}</p>
    </div>
  );
}
