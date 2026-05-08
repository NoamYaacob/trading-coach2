import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGuardianSnapshot } from "@/lib/guardian";
import { getProtectionLockState } from "@/lib/account-protection";
import {
  deriveRuleEditEligibility,
  buildRuleEditLockMessage,
} from "@/lib/rule-edit-eligibility";
import { isCmeMaintenanceWindow, isCmeWeekendClose } from "@/lib/time/cme-session";
import { hasValidConsent, decideConsentGate } from "@/lib/brokers/automated-actions-consent";
import { formatPendingRuleActivation } from "@/lib/pending-rule-activation";
import { RulesForm, type RulesFormValues } from "./_components/rules-form";
import { GuardianToggle } from "./_components/guardian-toggle";
import { ScopeSelector } from "./_components/scope-selector";
import { AccountRulesForm, type AccountRulesValues, type DefaultRuleValues } from "./_components/account-rules-form";
import { buildRuleScopes } from "./_components/rule-scope-utils";
import { computeEnforcementMode } from "./_components/enforcement-mode";
import { deriveAccountSubtitleSuffix } from "./_components/scope-selector-helpers";

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string }>;
}) {
  const { scope = "default", id } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, accounts, guardian, traderProfile, guardianStatus] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount.findMany({
      where: {
        userId: user.id,
        isActive: true,
        protectionStatus: { not: "archived" },
        // Accounts missing from the broker's /account/list are stale/deleted at
        // the broker level. They are preserved in DB for history but should not
        // appear as configurable rule targets in the Trading Plan.
        missingFromBrokerSince: null,
      },
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
            permissionLevel: true,
          },
        },
        riskRules: {
          select: {
            maxDailyLoss: true, riskPerTrade: true,
            maxTradesPerDay: true, stopAfterLosses: true,
            allowedEndHour: true,
            sessionEndBehavior: true,
            sessionPresetsJson: true,
            sessionPreset: true,
            sessionStartTime: true,
            sessionEndTime: true,
            sessionTimezone: true,
            ruleEditLockBufferMinutes: true,
            pendingPayloadJson: true,
            pendingEffectiveDate: true,
            maxContracts: true,
            automatedActionsConsentAt: true,
            automatedActionsConsentVersion: true,
          },
        },
      },
      orderBy: { label: "asc" },
    }),
    getGuardianSnapshot(user.id),
    prisma.traderProfile.findFirst({ where: { userId: user.id }, select: { timezone: true } }),
    prisma.guardianStatus.findUnique({
      where: { userId: user.id },
      select: { currentLockoutActive: true },
    }),
  ]);

  const protectionLock = getProtectionLockState({
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
    cutoffMinutes: riskRules?.protectionLockCutoffMinutes ?? null,
  });

  const savedSessionPresets = riskRules?.sessionPresetsJson
    ? (JSON.parse(riskRules.sessionPresetsJson) as string[])
    : null;
  const hasProtectionLockToday = guardianStatus?.currentLockoutActive === true;
  const ruleEditEligibility = deriveRuleEditEligibility({
    selectedSessionPresets: savedSessionPresets,
    hasProtectionLockToday,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
    sessionStartTime: riskRules?.sessionStartTime ?? null,
    sessionEndTime: riskRules?.sessionEndTime ?? null,
    sessionTimezone: riskRules?.sessionTimezone ?? null,
    lockBufferMinutes: riskRules?.ruleEditLockBufferMinutes ?? null,
    isCmeMaintenance: isCmeMaintenanceWindow(),
    isCmeWeekendClose: isCmeWeekendClose(),
  });
  const accountRuleLockMessage = ruleEditEligibility.canEditNow
    ? null
    : buildRuleEditLockMessage(
        ruleEditEligibility,
        riskRules?.sessionTimezone ?? null,
        traderProfile?.timezone ?? null,
      );

  const hasDefaultRules = Boolean(
    riskRules &&
      (riskRules.maxDailyLoss != null ||
        riskRules.maxTradesPerDay != null ||
        riskRules.stopAfterLosses != null ||
        riskRules.riskPerTrade != null),
  );

  // Build scope selector data — compute protection badge fields per account.
  const scopeAccounts = accounts.map((a) => {
    const consentGate = decideConsentGate({
      accountRiskRules: a.riskRules
        ? { consentAt: a.riskRules.automatedActionsConsentAt, consentVersion: a.riskRules.automatedActionsConsentVersion }
        : null,
      defaultRiskRules: riskRules
        ? { consentAt: riskRules.automatedActionsConsentAt, consentVersion: riskRules.automatedActionsConsentVersion }
        : null,
    });
    const requiresAutomatedActionsConsent =
      a.brokerConnection?.permissionLevel === "full_access" && !consentGate.allowed;
    return {
      ...a,
      hasAccountRules: a.riskRules !== null,
      requiresAutomatedActionsConsent,
      brokerConnection: a.brokerConnection
        ? {
            ...a.brokerConnection,
            permissionLevel: a.brokerConnection.permissionLevel ?? null,
          }
        : null,
    };
  });
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
    sessionEndHour: intStr(riskRules?.sessionEndHour),
    sessionEndBehavior: riskRules?.sessionEndBehavior ?? "wait_for_exit_then_lock",
    onBreachWarn: riskRules?.onBreachWarn ?? true,
    sessionPresets: savedSessionPresets ?? [],
    sessionIsCustom: !savedSessionPresets && riskRules?.sessionPreset === "custom",
    sessionStartTime: riskRules?.sessionStartTime ?? "",
    sessionEndTime: riskRules?.sessionEndTime ?? "",
    sessionTimezone: riskRules?.sessionTimezone ?? "",
    ruleEditLockBufferMinutes: intStr(riskRules?.ruleEditLockBufferMinutes),
  };

  const hasPendingPayload = Boolean(riskRules?.pendingPayloadJson && riskRules?.pendingEffectiveDate);

  // Build account-specific initial values (only used when scope=account)
  const accountSessionPresets = selectedAccount?.riskRules?.sessionPresetsJson
    ? (JSON.parse(selectedAccount.riskRules.sessionPresetsJson) as string[])
    : null;

  const accountInitial: AccountRulesValues = {
    maxDailyLoss: decStr(selectedAccount?.riskRules?.maxDailyLoss),
    riskPerTrade: decStr(selectedAccount?.riskRules?.riskPerTrade),
    maxTradesPerDay: intStr(selectedAccount?.riskRules?.maxTradesPerDay),
    stopAfterLosses: intStr(selectedAccount?.riskRules?.stopAfterLosses),
    allowedEndHour: intStr(selectedAccount?.riskRules?.allowedEndHour),
    sessionEndBehavior: selectedAccount?.riskRules?.sessionEndBehavior ?? "wait_for_exit_then_lock",
    sessionPresets: accountSessionPresets ?? [],
    sessionIsCustom: !accountSessionPresets && selectedAccount?.riskRules?.sessionPreset === "custom",
    sessionStartTime: selectedAccount?.riskRules?.sessionStartTime ?? "",
    sessionEndTime: selectedAccount?.riskRules?.sessionEndTime ?? "",
    sessionTimezone: selectedAccount?.riskRules?.sessionTimezone ?? "",
    ruleEditLockBufferMinutes: intStr(selectedAccount?.riskRules?.ruleEditLockBufferMinutes),
    maxContracts: intStr(selectedAccount?.riskRules?.maxContracts),
    // TODO: Move propFirm fields to Account setup / details page — not Trading Plan rules.
  };

  const accountDefaultValues: DefaultRuleValues = {
    maxDailyLoss: decStr(riskRules?.maxDailyLoss),
    riskPerTrade: decStr(riskRules?.riskPerTrade),
    maxTradesPerDay: intStr(riskRules?.maxTradesPerDay),
    stopAfterLosses: intStr(riskRules?.stopAfterLosses),
    allowedEndHour: intStr(riskRules?.sessionEndHour),
    maxContracts: intStr(riskRules?.maxContracts),
  };

  // True when at least one of the user's connected accounts has Tradovate full_access.
  // Drives the Default-template enforcement copy and the Guardian active-card copy.
  const hasFullAccessAccount = accounts.some(
    (a) => a.brokerConnection?.permissionLevel === "full_access",
  );

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
                permissionLevel: selectedAccount.brokerConnection.permissionLevel,
              }
            : null,
        }
      : null,
    scope !== "account",
    { hasFullAccessAccount },
  );

  return (
    <AppShell
      eyebrow="Trading Plan"
      title="Set your trading plan."
      description="Set session limits once in the default template, then override for individual accounts when needed."
      compactHero
    >
      {/* Two-column layout: selector sidebar + editor */}
      <div className="grid gap-5 lg:grid-cols-[260px_1fr] lg:items-start lg:gap-8">

        {/* ── Scope selector ──────────────────────────────────────────────── */}

        {/* Mobile: collapsible — collapses after scope selection so editor is visible */}
        <details className="overflow-hidden rounded-2xl border border-stone-200 bg-white/90 lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
              Rule Target
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
        <div className="hidden min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white/90 p-3 lg:block lg:sticky lg:top-6">
          <div className="mb-3 px-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
              Rule Target
            </p>
            <p className="mt-1 text-xs leading-snug text-stone-500">
              Choose where these rules apply.
            </p>
          </div>
          <ScopeSelector
            groups={groups}
            currentScope={scope}
            currentAccountId={id ?? null}
          />
        </div>

        {/* ── Rule editor ─────────────────────────────────────────────────── */}
        <div className="grid min-w-0 gap-5">

          {/* Scope context header */}
          <ScopeContextHeader
            scope={scope}
            account={selectedAccount}
            hasAccountRules={selectedAccount?.riskRules !== null}
          />

          {/* Enforcement mode banner */}
          <div className={`rounded-xl border px-4 py-3 text-xs ${enforcementInfo.cls}`}>
            <span className="font-semibold">{enforcementInfo.label}. </span>
            {enforcementInfo.detail}
          </div>

          {/* How enforcement works — compact collapsible */}
          <details className="group rounded-xl border border-stone-200 bg-stone-50/70 px-4 py-3 text-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-stone-700">
              How enforcement works
              <span className="font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <ul className="mt-3 grid gap-1.5 text-pretty text-stone-600">
              <li>• Guardrail sends warnings when rules are crossed.</li>
              <li>• In app-level monitoring, Guardrail marks the account locked inside the app only.</li>
              <li>• Broker-side cancel, flatten, and blocking require write permissions and enabled order actions.</li>
              <li>• Read-only connections support monitoring and alerts only.</li>
            </ul>
          </details>

          {/* Changes pending panel — merges lock banner + pending banner into one */}
          {scope !== "account" && (!ruleEditEligibility.canEditNow || (hasPendingPayload && riskRules?.pendingEffectiveDate)) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">Changes pending</p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  These rules are saved, but will only apply at the next edit window.
                  {!ruleEditEligibility.canEditNow && accountRuleLockMessage
                    ? ` ${accountRuleLockMessage}`
                    : ""}
                </p>
                {hasPendingPayload && riskRules?.pendingEffectiveDate && (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Applies at:{" "}
                    <span className="font-semibold">
                      {formatPendingRuleActivation({
                        nextTradingDayKey: !ruleEditEligibility.canEditNow && protectionLock.isLocked
                          ? protectionLock.nextTradingDayKey
                          : riskRules!.pendingEffectiveDate!,
                        sessionStartHour: riskRules?.sessionStartHour ?? null,
                        userTimezone: traderProfile?.timezone ?? null,
                      })}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Editor body */}
          {scope === "account" ? (
            selectedAccount ? (
              <SectionCard
                key={selectedAccount.id}
              >
                <AccountRulesForm
                  accountId={selectedAccount.id}
                  accountLabel={selectedAccount.label}
                  hasExistingRules={selectedAccount.riskRules !== null}
                  hasValidConsent={hasValidConsent({
                    consentAt: selectedAccount.riskRules?.automatedActionsConsentAt ?? null,
                    consentVersion:
                      selectedAccount.riskRules?.automatedActionsConsentVersion ?? null,
                  })}
                  initial={accountInitial}
                  isLocked={!ruleEditEligibility.canEditNow}
                  lockMessage={accountRuleLockMessage}
                  pendingPayload={(selectedAccount?.riskRules?.pendingPayloadJson ?? null) as Record<string, unknown> | null}
                  pendingEffectiveDate={selectedAccount?.riskRules?.pendingEffectiveDate ?? null}
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
            <SectionCard>
              <div id="guardian-toggle" className="mb-5 scroll-mt-20">
                <GuardianToggle initialEnabled={guardian.profile.guardianEnabled} hasFullAccessAccount={hasFullAccessAccount} />
              </div>
              <RulesForm
                initial={defaultInitial}
                timezone={traderProfile?.timezone}
                hasValidConsent={hasValidConsent({
                  consentAt: riskRules?.automatedActionsConsentAt ?? null,
                  consentVersion: riskRules?.automatedActionsConsentVersion ?? null,
                })}
              />
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
    permissionLevel: string | null;
  } | null;
} | null;

function ScopeContextHeader({
  scope,
  account,
  hasAccountRules,
}: {
  scope: string;
  account: SelectedAccount;
  hasAccountRules?: boolean;
}) {
  if (scope !== "account") {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Trading Plan
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-stone-950">
            Default template
          </h2>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Default
          </span>
        </div>
        <p className="mt-0.5 text-sm text-stone-500">
          Applies to all accounts that don't have their own override. Select an account in the sidebar to configure it individually.
        </p>
      </div>
    );
  }

  if (!account) return null;

  const conn = account.brokerConnection;
  const envLabel = conn?.env === "live" ? "Live account" : conn?.env === "demo" ? "Demo / Sim" : (conn?.env ?? "");
  const permSuffix = deriveAccountSubtitleSuffix(conn?.permissionLevel ?? null);
  const firmLine = account.propFirm
    ? account.propFirm
    : conn
    ? `${conn.platform === "tradovate" ? "Tradovate" : conn.platform} · ${envLabel}${permSuffix ? ` · ${permSuffix}` : ""}`
    : null;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
        Trading Plan · Account
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-stone-950">
          {account.label}
        </h2>
        {hasAccountRules ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-800">
            Account override
          </span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Inherited default
          </span>
        )}
      </div>
      {firmLine && <p className="mt-0.5 text-sm text-stone-500">{firmLine}</p>}
    </div>
  );
}
