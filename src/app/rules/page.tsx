import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
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
import { buildRuleScopes, buildAccountRulesUrl } from "./_components/rule-scope-utils";
import { deriveAccountDisplayLabel } from "@/lib/account-display";
import { ApplyPendingButton } from "./_components/apply-pending-button";
import { computeEnforcementMode, type EnforcementModeInfo } from "./_components/enforcement-mode";
import { deriveAccountSubtitleSuffix, deriveScopeAccountBadge } from "./_components/scope-selector-helpers";
import { parseSymbolLimits } from "@/lib/futures/symbol-limits";
import { HowEnforcementWorks } from "./_components/how-enforcement-works";

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
  searchParams: Promise<{ scope?: string; id?: string; rule?: string }>;
}) {
  const { scope: rawScope = "default", id, rule } = await searchParams;
  // "starter" is an explicit scope for the starter settings form.
  // "default" (no param) → accounts overview when accounts exist, starter settings when no accounts.
  const scope = rawScope === "starter" ? "starter" : rawScope === "account" ? "account" : "default";
  // Editor mode: a specific rule is selected via ?rule=<id>. In that mode the
  // page-level account scope sidebar is hidden so the rules rail (inside the
  // detail pane) becomes the primary left rail. Two columns total, matching
  // the Claude Design intent. Overview mode keeps the scope sidebar visible.
  const isRuleEditorMode = scope === "account" && typeof rule === "string" && rule.length > 0;
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
        displayName: true,
        externalAccountId: true,
        accountType: true,
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
            maxContractsBySymbolJson: true,
            rawBrokerHardLimitEnabled: true,
            telegramAlertsEnabled: true,
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

  // Load telegram connection status for per-account notification toggle.
  const telegramConn = await prisma.telegramConnection.findUnique({
    where: { userId: user.id },
    select: { telegramChatId: true },
  });
  const hasTelegramConnected = Boolean(telegramConn?.telegramChatId);

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
      // User-facing name (displayName > firm/type > broker label). Never the DB id.
      label: deriveAccountDisplayLabel(a),
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

  // Other accounts the user can copy a Trading Plan from into the selected account.
  const copySourceAccounts = selectedAccount
    ? accounts
        .filter((a) => a.id !== selectedAccount.id && a.riskRules !== null)
        .map((a) => ({
          id: a.id,
          label: deriveAccountDisplayLabel(a),
          env: a.brokerConnection?.env ?? null,
        }))
    : [];

  // Determine whether pending rules can be applied immediately ("Apply pending
  // now" button). Uses canActivateRulesNow with live account/scope state.
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
  // counts as a potentially active inheriting account.
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
    telegramAlertsEnabled: selectedAccount?.riskRules?.telegramAlertsEnabled ?? null,
    symbolLimits: parseSymbolLimits(selectedAccount?.riskRules?.maxContractsBySymbolJson ?? null).map(
      (l) => ({ symbol: l.symbol, maxContracts: String(l.maxContracts) }),
    ),
    // TODO: Move propFirm fields to Account setup / details page — not Trading Plan rules.
  };

  // Map the default-template row into the shape the account form expects.
  // The helper handles the riskPerTrade ← maxRiskPerTrade legacy fallback and
  // the sessionEndHour → allowedEndHour field-name remap, both of which the
  // account-form's pending diff baseline depends on for inherited fields.
  const accountDefaultValues: DefaultRuleValues = mapDefaultRulesToAccountForm(riskRules);

  // True when at least one of the user's connected accounts has Tradovate full_access.
  // Drives the Default-template enforcement copy and the Guardian active-card copy.
  const hasFullAccessAccount = accounts.some(
    (a) => a.brokerConnection?.permissionLevel === "full_access",
  );

  // Enforcement mode for the current scope (scoped to brokerConnectionId + accountId)
  const isNotAccountScope = scope !== "account";
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
    isNotAccountScope,
    { hasFullAccessAccount },
  );

  // Whether to render the starter settings form (explicit /rules?scope=starter, or no accounts yet)
  const showStarterForm = scope === "starter" || (isNotAccountScope && groups.length === 0);
  // Whether to render the accounts overview landing (default / with accounts)
  const showAccountsOverview = isNotAccountScope && scope !== "starter" && groups.length > 0;

  // Derive breadcrumb from current scope/account for GrShell header.
  const breadcrumb: string[] =
    scope === "account" && selectedAccount
      ? ["Trading Plan", deriveAccountDisplayLabel(selectedAccount)]
      : showAccountsOverview
      ? ["Trading Plan", "Accounts"]
      : ["Trading Plan", "Default rules"];

  // Derive user initials from email (first 2 chars before @, uppercase).
  const emailPart = user.email.split("@")[0] ?? "";
  const userInitials = emailPart.slice(0, 2).toUpperCase() || "??";

  // Nav items with real hrefs for the GrShell sidebar.
  const RULES_NAV: GrNavItem[] = [
    { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard" },
    { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules",    active: true },
    { id: "trades",   label: "Trades",       icon: "chart",    href: "/trades" },
    { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts" },
    { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
  ];

  return (
    <GrShell
      breadcrumb={breadcrumb}
      sidebarContent={
        !isRuleEditorMode ? (
          <ScopeSelector
            groups={groups}
            currentScope={scope}
            currentAccountId={id ?? null}
          />
        ) : null
      }
      sidebarLabel="Rule target"
      hideSidebar={isRuleEditorMode}
      navItems={RULES_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      {/* Content area wrapper — matches old workspace inner div */}
      <div className="flex min-w-0 flex-1 flex-col">

            {/* Mobile scope selector — visible below GrShell header on small screens */}
            {!isRuleEditorMode && (
              <details className="shrink-0 border-b border-stone-200/60 bg-[#f9f4ea] lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
                    Rule Target
                  </span>
                  <span className="select-none text-stone-400">▾</span>
                </summary>
                <div className="border-t border-stone-100 px-3 pb-3 pt-2">
                  <ScopeSelector
                    groups={groups}
                    currentScope={scope}
                    currentAccountId={id ?? null}
                  />
                </div>
              </details>
            )}

            {/* Account header strip — enforcement context + account metadata.
             *  Honest enforcement context text kept so source-scan tests pass. */}
            <WorkspaceHeader
              scope={scope}
              account={selectedAccount}
              hasAccountRules={selectedAccount?.riskRules !== null}
              enforcementInfo={enforcementInfo}
              showAccountsOverview={showAccountsOverview}
            />

            {/* Enforcement detail strip — collapsible, hidden in accounts overview.
             *  Phase I: tighter padding to match the app-shell density. */}
            {!showAccountsOverview && (
              <details className="group shrink-0 border-b border-[color:var(--gr-border-sub)] bg-[#f9f4ea]/40">
                <summary className="flex cursor-pointer list-none items-center gap-1 px-5 py-1.5 text-[10.5px] text-[color:var(--gr-text-mute)] hover:text-[color:var(--gr-ink)]">
                  <span className="group-open:hidden">+ How enforcement works</span>
                  <span className="hidden group-open:inline">− How enforcement works</span>
                </summary>
                <div className="px-5 pb-3 pt-1">
                  <p className="mb-2 text-[11px] leading-relaxed text-[color:var(--gr-text-mid)]">
                    {enforcementInfo.detail}
                  </p>
                  <HowEnforcementWorks />
                </div>
              </details>
            )}

            {/* Pending changes strip */}
            {showStarterForm && (!ruleEditEligibility.canEditNow || (hasPendingPayload && riskRules?.pendingEffectiveDate)) && (
              <div className="flex shrink-0 items-start gap-2.5 border-b border-amber-200 bg-amber-50/80 px-5 py-3 text-xs text-amber-900">
                <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Changes pending</p>
                  <p className="mt-0.5 text-[11px] text-amber-800">
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
                    <p className="mt-1 text-[11px] text-amber-800">
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

            {/* Content area — Phase I: tighter padding for app-density */}
            <div className="min-w-0 flex-1 overflow-auto px-4 py-3 sm:px-5 sm:py-4">

              {scope === "account" ? (
                selectedAccount ? (
                  <div key={selectedAccount.id} className="min-w-0">
                    <AccountRulesForm
                      accountId={selectedAccount.id}
                      accountLabel={selectedAccount.label}
                      hasExistingRules={selectedAccount.riskRules !== null}
                      hasValidConsent={hasValidConsent({
                        consentAt: selectedAccount.riskRules?.automatedActionsConsentAt ?? null,
                        consentVersion: selectedAccount.riskRules?.automatedActionsConsentVersion ?? null,
                      })}
                      initial={accountInitial}
                      isLocked={!ruleEditEligibility.canEditNow || accountIsLockedForPending || hasAlreadyTradedToday}
                      isHardLocked={hasAlreadyTradedToday}
                      lockMessage={
                        hasAlreadyTradedToday
                          ? "You already started trading this account today. To protect your rules, changes will be available next trading day."
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
                      copySourceAccounts={copySourceAccounts}
                      hasTelegramConnected={hasTelegramConnected}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-stone-200 bg-white/70 px-5 py-4">
                    <p className="text-sm font-medium text-stone-800">Account not found</p>
                    <p className="mt-1 text-sm text-stone-600">
                      The selected account was not found.{" "}
                      <Link href="/rules?scope=starter" className="font-medium underline-offset-2 hover:underline">
                        Back to default rules
                      </Link>
                    </p>
                  </div>
                )
              ) : showAccountsOverview ? (
                <AccountsOverviewPanel
                  accounts={scopeAccounts.filter((a) => a.missingFromBrokerSince == null)}
                  guardianEnabled={guardian.profile.guardianEnabled}
                  hasFullAccessAccount={hasFullAccessAccount}
                />
              ) : (
                <div className="grid gap-4">
                  <div id="guardian-toggle" className="scroll-mt-20 rounded-xl border border-stone-200/70 bg-white/70 px-5 py-4">
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
                </div>
              )}

              {showStarterForm && groups.length === 0 && (
                <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
                  <p className="font-medium text-stone-950">No broker accounts connected.</p>
                  <p className="mt-1">
                    Connect a trading account to create a Trading Plan. Default rules above are a starting point — each account needs its own rules for Guardrail to monitor it.
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
    </GrShell>
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

function WorkspaceHeader({
  scope,
  account,
  hasAccountRules,
  enforcementInfo,
  showAccountsOverview,
}: {
  scope: string;
  account: SelectedAccount;
  hasAccountRules?: boolean;
  enforcementInfo: EnforcementModeInfo;
  showAccountsOverview: boolean;
}) {
  /* Phase I structural: a single dense breadcrumb-style strip
   * ("Trading Plan / [Account] · [Active plan] · [Live] · [Enforcement]")
   * replaces the previous two-row card-style header. Honest enforcement
   * context text still embedded so the safety-console source-scan test
   * keeps passing. */
  const stripCls =
    "shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[color:var(--gr-border)] bg-[#f9f4ea] px-5 py-1.5";
  const crumbCls =
    "text-[10.5px] font-medium uppercase tracking-[0.14em] text-[color:var(--gr-text-mute)]";
  const sepCls = "text-[color:var(--gr-text-mute)] text-[10px]";
  const titleCls = "text-[13px] font-semibold text-[color:var(--gr-ink)] tracking-[-0.005em]";

  if (showAccountsOverview) {
    return (
      <div className={stripCls}>
        <span className={crumbCls}>Trading Plan</span>
        <span className={sepCls}>/</span>
        <span className={titleCls}>All accounts</span>
      </div>
    );
  }

  if (scope !== "account") {
    return (
      <div className={stripCls}>
        <span className={crumbCls}>Trading Plan</span>
        <span className={sepCls}>/</span>
        <span className={titleCls}>Default rules</span>
        <span className="rounded-full bg-stone-100 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-stone-600">
          Defaults
        </span>
        <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-semibold ${enforcementInfo.cls}`}>
          {enforcementInfo.label}
        </span>
        {/* Honest enforcement context: the enforcement engine reads account-specific rules, not this template directly */}
        <span className="ml-auto hidden text-[10.5px] text-[color:var(--gr-text-mute)] md:inline">
          Session defaults — the enforcement engine reads account-specific rules, not this template directly.
        </span>
      </div>
    );
  }

  if (!account) {
    return (
      <div className={stripCls}>
        <span className={crumbCls}>Trading Plan</span>
        <span className={sepCls}>/</span>
        <span className={titleCls}>Account not found</span>
      </div>
    );
  }

  const conn = account.brokerConnection;
  const envLabel =
    conn?.env === "live" ? "Live" : conn?.env === "demo" ? "Demo / Sim" : (conn?.env ?? "");

  return (
    <div className={stripCls}>
      <span className={crumbCls}>Trading Plan</span>
      <span className={sepCls}>/</span>
      <span className={`${titleCls} truncate max-w-[260px]`}>{account.label}</span>
      {hasAccountRules ? (
        <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-emerald-800">
          Active plan
        </span>
      ) : (
        <span className="rounded-full bg-stone-100 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.1em] text-stone-600">
          Needs rules
        </span>
      )}
      {envLabel && (
        <span className="text-[10.5px] text-[color:var(--gr-text-mute)]">{envLabel}</span>
      )}
      <span className={`rounded-full border px-1.5 py-px text-[9.5px] font-semibold ${enforcementInfo.cls}`}>
        {enforcementInfo.label}
      </span>
      {!hasAccountRules && (
        <span className="ml-auto hidden text-[10.5px] text-[color:var(--gr-text-mute)] md:inline">
          No account-specific rules — Guardrail is not monitoring this account.
        </span>
      )}
    </div>
  );
}

// ── AccountsOverviewPanel ──────────────────────────────────────────────────────

type OverviewAccount = {
  id: string;
  label: string;
  hasAccountRules: boolean;
  brokerConnection: { env: string } | null;
};

function AccountsOverviewPanel({
  accounts,
  guardianEnabled,
  hasFullAccessAccount,
}: {
  accounts: OverviewAccount[];
  guardianEnabled: boolean;
  hasFullAccessAccount: boolean;
}) {
  const ENV_LABEL: Record<string, string> = { live: "Live", demo: "Demo / Sim" };

  return (
    <div className="grid gap-5">
      {/* Guardian toggle — placed here so /rules#guardian-toggle anchor always works */}
      <div id="guardian-toggle" className="scroll-mt-20 rounded-xl border border-stone-200/70 bg-white/70 px-5 py-4">
        <GuardianToggle initialEnabled={guardianEnabled} hasFullAccessAccount={hasFullAccessAccount} />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          Trading Plan
        </p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-stone-950">
          Your accounts
        </h2>
        <p className="mt-0.5 text-sm text-stone-500">
          Select an account to configure its Trading Plan. Each account needs its own rules for Guardrail to monitor it.
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm text-stone-600">
          <p className="font-medium text-stone-950">No broker accounts connected.</p>
          <p className="mt-1">
            Connect a trading account to create a Trading Plan.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/accounts/connect/tradovate"
              className="inline-flex items-center justify-center rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
            >
              Connect Tradovate
            </Link>
            <Link
              href="/rules?scope=starter"
              className="inline-flex items-center justify-center rounded-full border border-stone-200 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-400"
            >
              View default rules
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {accounts.map((account) => {
            const badge = deriveScopeAccountBadge({
              isUnavailable: false,
              requiresAutomatedActionsConsent: false,
              hasAccountRules: account.hasAccountRules,
            });
            const envLabel = account.brokerConnection
              ? (ENV_LABEL[account.brokerConnection.env] ?? account.brokerConnection.env)
              : null;
            return (
              <Link
                key={account.id}
                href={buildAccountRulesUrl(account.id)}
                className="flex items-center justify-between rounded-xl border border-stone-200/80 bg-white px-4 py-3 transition hover:border-amber-200 hover:bg-amber-50/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-900">{account.label}</p>
                  {envLabel && (
                    <p className="mt-0.5 text-xs text-stone-500">{envLabel}</p>
                  )}
                </div>
                <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}>
                  {badge.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-xs text-stone-400">
        Use{" "}
        <Link href="/rules?scope=starter" className="underline-offset-2 hover:underline">
          Default rules
        </Link>{" "}
        to configure session defaults. Connected accounts still need their own Trading Plan.
      </p>
    </div>
  );
}
