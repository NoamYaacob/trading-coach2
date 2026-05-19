import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { LogoutButton } from "@/components/ui/logout-button";
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
import { deriveCmeTradingDayKey } from "@/lib/trading-day";
import { canActivateRulesNow, activationReasonMessage } from "@/lib/rule-activation-window";
import { hasValidConsent, decideConsentGate } from "@/lib/brokers/automated-actions-consent";
import { formatPendingRuleActivation } from "@/lib/pending-rule-activation";
import { RulesForm, type RulesFormValues } from "./_components/rules-form";
import { GuardianToggle } from "./_components/guardian-toggle";
import { ScopeSelector } from "./_components/scope-selector";
import { AccountRulesForm, type AccountRulesValues, type DefaultRuleValues } from "./_components/account-rules-form";
import { mapDefaultRulesToAccountForm } from "./_components/account-rules-form-logic";
import { buildRuleScopes } from "./_components/rule-scope-utils";
import { ApplyPendingButton } from "./_components/apply-pending-button";
import { computeEnforcementMode } from "./_components/enforcement-mode";
import { deriveAccountSubtitleSuffix } from "./_components/scope-selector-helpers";
import { AccountStatusPanel } from "./_components/account-status-panel";

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

// ── Dark app nav ──────────────────────────────────────────────────────────────

const APP_NAV: ReadonlyArray<{ href: string; label: string; active?: boolean }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/rules", label: "Trading Plan", active: true },
  { href: "/alerts", label: "Alerts" },
  { href: "/settings", label: "Settings" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; id?: string }>;
}) {
  const { scope = "default", id } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, accounts, guardian, traderProfile, guardianStatus, selectedAccountLiveState] = await Promise.all([
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
            rawBrokerHardLimitEnabled: true,
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
    // Load per-account lock state for the selected account (scope=account only).
    // Used to compute canApplyPendingNow accurately when the account is live-connected.
    scope === "account" && id
      ? prisma.liveSessionState.findUnique({
          where: { accountId: id },
          select: { riskState: true, cooldownActive: true, tradesCount: true, sessionDate: true },
        })
      : Promise.resolve(null),
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

  // Determine whether pending rules can be applied immediately
  const accountConnectionLive = selectedAccount?.connectionStatus === "connected_live";
  const accountIsLockedForPending =
    selectedAccountLiveState?.riskState === "STOPPED" ||
    selectedAccountLiveState?.cooldownActive === true;
  const hasAlreadyTradedToday =
    selectedAccountLiveState?.sessionDate === deriveCmeTradingDayKey(new Date()) &&
    (selectedAccountLiveState?.tradesCount ?? 0) > 0;
  const accountPendingDecision =
    selectedAccount?.riskRules?.pendingPayloadJson
      ? canActivateRulesNow({
          scope: "account",
          accountIsLocked: accountIsLockedForPending,
          accountConnectionLive,
        })
      : null;
  const accountCanApplyPendingNow = accountPendingDecision?.canActivate ?? false;
  const accountPendingBlockReason =
    accountPendingDecision && !accountPendingDecision.canActivate
      ? activationReasonMessage(accountPendingDecision.reason)
      : null;

  // For default scope: any account that has no override AND is live-connected
  const anyInheritingLiveActive = accounts.some(
    (a) => !a.riskRules && a.connectionStatus === "connected_live",
  );
  const defaultPendingDecision =
    riskRules?.pendingPayloadJson
      ? canActivateRulesNow({ scope: "default", anyInheritingAccountActive: anyInheritingLiveActive })
      : null;
  const defaultCanApplyPendingNow = defaultPendingDecision?.canActivate ?? false;
  const defaultPendingBlockReason =
    defaultPendingDecision && !defaultPendingDecision.canActivate
      ? activationReasonMessage(defaultPendingDecision.reason)
      : null;

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
    rawBrokerHardLimitEnabled: selectedAccount?.riskRules?.rawBrokerHardLimitEnabled ?? false,
    // TODO: Move propFirm fields to Account setup / details page — not Trading Plan rules.
  };

  // Map the default-template row into the shape the account form expects.
  const accountDefaultValues: DefaultRuleValues = mapDefaultRulesToAccountForm(riskRules);

  // True when at least one of the user's connected accounts has Tradovate full_access.
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

  const isDefaultScope = scope !== "account";

  // ── Status panel account data ──────────────────────────────────────────────
  const statusPanelAccount = selectedAccount
    ? {
        label: selectedAccount.label,
        connectionStatus: selectedAccount.connectionStatus,
        brokerConnection: selectedAccount.brokerConnection
          ? {
              env: selectedAccount.brokerConnection.env,
              connectionStatus: selectedAccount.brokerConnection.connectionStatus,
              permissionLevel: selectedAccount.brokerConnection.permissionLevel,
            }
          : null,
      }
    : null;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3]">

      {/* ── Dark navigation header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-[#21262d] bg-[#161b22]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3 xl:px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="shrink-0 text-sm font-bold uppercase tracking-[0.3em] text-[#f97316] transition-opacity hover:opacity-80"
            >
              Guardrail
            </Link>
            <nav className="hidden items-center gap-0.5 md:flex" aria-label="Primary">
              {APP_NAV.map(({ href, label, active }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-[#21262d] font-medium text-[#e6edf3]"
                      : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#adbac7]"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <LogoutButton />
        </div>
      </header>

      {/* ── Three-column trading terminal layout ───────────────────────────── */}
      <div className="xl:grid xl:h-[calc(100vh-57px)] xl:grid-cols-[220px_1fr_280px] xl:overflow-hidden">

        {/* ── LEFT SIDEBAR — Rule Target list ──────────────────────────────── */}

        {/* Mobile: collapsible */}
        <details className="border-b border-[#21262d] xl:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 bg-[#161b22]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f97316]">
              Rule Target
            </span>
            <span className="text-[#6e7781] select-none text-xs">▾</span>
          </summary>
          <div className="border-t border-[#21262d] bg-[#161b22] px-3 pb-3 pt-2">
            <ScopeSelector
              groups={groups}
              currentScope={scope}
              currentAccountId={id ?? null}
            />
          </div>
        </details>

        {/* Desktop: sticky sidebar */}
        <aside className="hidden border-r border-[#21262d] bg-[#161b22] xl:block xl:overflow-y-auto">
          <div className="p-3">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f97316]">
              Rule Target
            </p>
            <ScopeSelector
              groups={groups}
              currentScope={scope}
              currentAccountId={id ?? null}
            />
          </div>
        </aside>

        {/* ── CENTER — Rule editor ──────────────────────────────────────────── */}
        <main className="min-w-0 xl:overflow-y-auto">
          <div className="grid gap-5 px-4 py-5 xl:px-6 xl:py-6">

            {/* Scope context header */}
            <ScopeContextHeader
              scope={scope}
              account={selectedAccount}
              hasAccountRules={selectedAccount?.riskRules !== null}
            />

            {/* Enforcement mode banner */}
            <div
              className={`rounded-xl border px-4 py-3 text-xs ${
                enforcementInfo.mode === "broker_enforcement_pending"
                  ? "border-emerald-700 bg-emerald-900/30 text-emerald-300"
                  : enforcementInfo.mode === "broker_enforced_active"
                  ? "border-emerald-600 bg-emerald-900/40 text-emerald-200"
                  : enforcementInfo.mode === "broker_enforcement_failed"
                  ? "border-red-700 bg-red-900/30 text-red-300"
                  : "border-[#30363d] bg-[#161b22] text-[#8b949e]"
              }`}
            >
              <span className="font-semibold">{enforcementInfo.label}. </span>
              {enforcementInfo.detail}
            </div>

            {/* How enforcement works — compact collapsible */}
            <details className="group rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-3 text-xs">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-[#adbac7]">
                How enforcement works
                <span className="font-normal text-[#6e7781] transition-transform group-open:rotate-45">+</span>
              </summary>
              <ul className="mt-3 grid gap-1.5 text-pretty text-[#8b949e]">
                <li>• <span className="font-medium text-[#adbac7]">Monitoring:</span> Guardrail watches every fill and alerts you when rules are crossed.</li>
                <li>• <span className="font-medium text-[#adbac7]">App lock:</span> Guardrail marks the account locked inside the app. No broker actions are sent.</li>
                <li>• <span className="font-medium text-[#adbac7]">Broker risk settings:</span> when enabled, Guardrail writes your daily loss limit directly to Tradovate — the exchange enforces it independently of the app.</li>
                <li>• Read-only connections support monitoring and alerts only. Full access is required for broker actions.</li>
              </ul>
            </details>

            {/* Changes pending panel — default scope only */}
            {scope !== "account" && (!ruleEditEligibility.canEditNow || (hasPendingPayload && riskRules?.pendingEffectiveDate)) && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-700 bg-amber-900/20 px-4 py-3 text-xs text-amber-300">
                <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Changes pending</p>
                  <p className="mt-0.5 text-[11px] text-amber-400">
                    {defaultCanApplyPendingNow
                      ? "Ready to apply now — no active inheriting accounts in the way."
                      : defaultPendingBlockReason
                      ? `Cannot apply yet: ${defaultPendingBlockReason}`
                      : "Pending changes are saved and will activate automatically at the next safe window."}
                    {!ruleEditEligibility.canEditNow && accountRuleLockMessage
                      ? ` ${accountRuleLockMessage}`
                      : ""}
                  </p>
                  {hasPendingPayload && riskRules?.pendingEffectiveDate && (
                    <p className="mt-1 text-[11px] text-amber-400">
                      Activates at:{" "}
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
                  {hasPendingPayload && defaultCanApplyPendingNow && (
                    <ApplyPendingButton url="/api/rules/apply-pending" />
                  )}
                </div>
              </div>
            )}

            {/* Editor body */}
            {scope === "account" ? (
              selectedAccount ? (
                <AccountRulesForm
                  key={selectedAccount.id}
                  accountId={selectedAccount.id}
                  accountLabel={selectedAccount.label}
                  hasExistingRules={selectedAccount.riskRules !== null}
                  hasValidConsent={hasValidConsent({
                    consentAt: selectedAccount.riskRules?.automatedActionsConsentAt ?? null,
                    consentVersion:
                      selectedAccount.riskRules?.automatedActionsConsentVersion ?? null,
                  })}
                  initial={accountInitial}
                  isLocked={!ruleEditEligibility.canEditNow || accountIsLockedForPending || hasAlreadyTradedToday}
                  isHardLocked={hasAlreadyTradedToday}
                  lockMessage={
                    hasAlreadyTradedToday
                      ? "Rules are locked for this session — this account has already traded. Changes can be made after the session resets."
                      : accountIsLockedForPending
                      ? "Rules are locked — protection is active on this account. Changes are blocked until the lock clears."
                      : accountRuleLockMessage
                  }
                  pendingPayload={(selectedAccount?.riskRules?.pendingPayloadJson ?? null) as Record<string, unknown> | null}
                  pendingEffectiveDate={selectedAccount?.riskRules?.pendingEffectiveDate ?? null}
                  canApplyPendingNow={accountCanApplyPendingNow}
                  pendingBlockReason={accountPendingBlockReason}
                  hasDefaultRules={hasDefaultRules}
                  timezone={traderProfile?.timezone}
                  defaultValues={accountDefaultValues}
                  defaultPendingPayload={(riskRules?.pendingPayloadJson ?? null) as Record<string, unknown> | null}
                />
              ) : (
                <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-4 text-sm text-[#8b949e]">
                  <p className="font-medium text-[#adbac7]">Account not found</p>
                  <p className="mt-1">
                    The selected account was not found.{" "}
                    <Link href="/rules" className="text-[#f97316] underline-offset-2 hover:underline">
                      Back to default template
                    </Link>
                  </p>
                </div>
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
                  pendingPayload={(riskRules?.pendingPayloadJson ?? null) as Record<string, unknown> | null}
                />
              </SectionCard>
            )}

            {/* No broker accounts */}
            {scope !== "account" && groups.length === 0 && (
              <div className="rounded-2xl border border-[#30363d] bg-[#161b22] px-5 py-4 text-sm text-[#8b949e]">
                <p className="font-medium text-[#adbac7]">No broker accounts connected.</p>
                <p className="mt-1 text-[#6e7781]">
                  Connect your broker to enable live account monitoring. The rules above apply as session defaults across connected accounts.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href="/accounts/connect/tradovate"
                    className="inline-flex items-center justify-center rounded-full bg-[#f97316] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#ea580c]"
                  >
                    Connect Tradovate
                  </Link>
                </div>
              </div>
            )}

            {/* Footer */}
            <footer className="mt-2 border-t border-[#21262d] py-4">
              <p className="text-[11px] leading-5 text-[#6e7781]">
                Guardrail is a discipline and risk-management tool. It does not provide financial advice or guarantee trading results. Trading involves substantial risk of loss.
              </p>
              <nav className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#6e7781]">
                <Link href="/terms" className="transition hover:text-[#adbac7]">Terms</Link>
                <Link href="/privacy" className="transition hover:text-[#adbac7]">Privacy</Link>
                <Link href="/risk-disclaimer" className="transition hover:text-[#adbac7]">Risk Disclaimer</Link>
                <a href="mailto:support@guardrail.trade" className="transition hover:text-[#adbac7]">Contact Support</a>
              </nav>
            </footer>

          </div>
        </main>

        {/* ── RIGHT PANEL — Account status ─────────────────────────────────── */}
        <aside className="border-t border-[#21262d] bg-[#161b22] xl:border-l xl:border-t-0 xl:overflow-y-auto">
          <div className="p-4">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f97316]">
              Account Status
            </p>
            <AccountStatusPanel
              account={statusPanelAccount}
              liveState={selectedAccountLiveState}
              hasAlreadyTradedToday={hasAlreadyTradedToday}
              enforcementInfo={enforcementInfo}
              isDefaultScope={isDefaultScope}
            />
          </div>
        </aside>

      </div>
    </div>
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f97316]">
          Trading Plan
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight text-[#e6edf3]">
            Default template
          </h2>
          <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6e7781]">
            Default
          </span>
        </div>
        <p className="mt-0.5 text-sm text-[#8b949e]">
          Applies to all accounts that don't have their own override. Select an account in the sidebar to configure it individually.
        </p>
        <p className="mt-1 text-xs text-[#6e7781]">
          These are the rules Guardrail watches during your trading session.
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
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f97316]">
        Trading Plan · Account
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight text-[#e6edf3]">
          {account.label}
        </h2>
        {hasAccountRules ? (
          <span className="rounded-full bg-emerald-900/40 border border-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
            Account override
          </span>
        ) : (
          <span className="rounded-full bg-[#21262d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6e7781]">
            Inherited default
          </span>
        )}
      </div>
      {firmLine && <p className="mt-0.5 text-sm text-[#8b949e]">{firmLine}</p>}
      <p className="mt-1 text-xs text-[#6e7781]">
        These are the rules Guardrail watches for this account during your trading session.
      </p>
    </div>
  );
}
