import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { GuardianControls } from "@/app/guardian/_components/guardian-controls";
import { RecentSessionEvents } from "@/app/guardian/_components/recent-session-events";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGuardianSnapshot, getTodayGuardianSessionStart, deriveTodaySessionState } from "@/lib/guardian";
import {
  buildBrokerIntegrationSnapshot,
  derivePlatformConnectionProgression,
} from "@/lib/platform-integration";
import { humanizePlannedCapabilities } from "@/lib/platform-integration-plans";
import { deriveManualEventSignals } from "@/lib/manual-trade-events";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { RuleNoticeList } from "@/components/ui/rule-notice-card";
import { getTodaySessionEvents } from "@/lib/session-log";
import {
  getSelectedEconomicCalendarSnapshot,
  getNextHighImpactEconomicEvent,
  getCurrentPreNewsPolicy,
  buildEconomicCalendarVisibility,
  getEconomicCalendarSelection,
} from "@/lib/economic-calendar";
import {
  buildTodayActivityTimeline,
  getRecentTodayActivityItems,
} from "@/lib/today-activity";
import {
  DISPLAY_TIME_ZONE_COOKIE,
  resolveDisplayTimeZone,
} from "@/lib/timezone";

export const metadata: Metadata = {
  title: "Trading Guardian",
};

function formatGuardianDate(value: Date | null, timeZone: string) {
  if (!value) {
    return "Not scheduled";
  }

  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value)} ${timeZone}`;
}

export default async function GuardianPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  const [
    guardian,
    user,
    todayGuardianSessionStart,
    todaySessionEvents,
  ] = await Promise.all([
    getGuardianSnapshot(currentUser.id),
    prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        traderProfile: { select: { id: true, timezone: true } },
        coachingPreferences: true,
      },
    }),
    getTodayGuardianSessionStart(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
  ]);
  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user?.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
  const economicCalendarSelection = getEconomicCalendarSelection(
    user?.coachingPreferences,
  );
  const economicCalendarSnapshot = await getSelectedEconomicCalendarSnapshot(
    user?.coachingPreferences,
  );
  const onboardingComplete = Boolean(user?.traderProfile);
  const nextHighImpactEconomicEvent = getNextHighImpactEconomicEvent(
    economicCalendarSnapshot,
  );
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const economicCalendarVisibility = buildEconomicCalendarVisibility({
    snapshot: economicCalendarSnapshot,
    policyStatus: economicCalendarPolicy,
    nextHighImpactEvent: nextHighImpactEconomicEvent,
    timeZone: displayTimeZone,
    scenario: economicCalendarSelection.stubScenario,
  });
  const additionalTriggeredRuleLabels = guardian.evaluation.triggeredRuleLabels.slice(1);
  const recentSessionEvents = getRecentTodayActivityItems(
    buildTodayActivityTimeline({
      sessionStart: todayGuardianSessionStart,
      guardian,
      sessionEvents: todaySessionEvents,
    }),
    5,
  );
  const brokerIntegration = buildBrokerIntegrationSnapshot({
    guardian,
    recentSessionEvents: todaySessionEvents.map((event) => ({
      message: event.message,
      detectedIntent: event.detectedIntent,
      traderState: event.traderState,
      createdAt: event.createdAt,
    })),
  });
  const connectionProgression = derivePlatformConnectionProgression({
    guardian,
    brokerIntegration,
  });
  const plannedCapabilities = brokerIntegration.integrationPlan
    ? humanizePlannedCapabilities(brokerIntegration.integrationPlan.plannedCapabilities)
    : [];

  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: todayGuardianSessionStart,
    preNewsPolicyStatus: economicCalendarPolicy,
  });
  const manualEventSignals = deriveManualEventSignals(todaySessionEvents);
  const violationFeed = buildViolationFeed(
    buildRuleEngineInputFromGuardianSnapshot(guardian, {
      sessionStarted: Boolean(todayGuardianSessionStart),
      sessionEnded: Boolean(todayGuardianSessionStart?.endedAt),
      todaySessionStateKind: todaySessionState.kind,
      preNewsPolicy: economicCalendarPolicy.isActive
        ? {
            isActive: economicCalendarPolicy.isActive,
            mode: economicCalendarPolicy.policy.mode,
            message: economicCalendarPolicy.message,
          }
        : null,
      manualSignals: manualEventSignals,
    }),
  );
  const guardianNotices = [
    ...violationFeed.warningViolations.filter(
      (v) =>
        v.ruleId !== "guardian_disabled" &&
        v.ruleId !== "no_trade_before_major_news" &&
        v.ruleId !== "session_not_started",
    ),
    ...violationFeed.triggeredViolations.filter(
      (v) => v.ruleId === "manual_rule_breach",
    ),
  ];

  return (
    <AppShell
      eyebrow="Trading Guardian"
      title="Know if today is open, why it closed, and what happens next."
      description="Guardian keeps the day clear: open, closed, or waiting for the next reset window."
    >
      <div className="grid gap-6">
        <section
          className={`rounded-[1.9rem] border px-6 py-6 shadow-[0_24px_80px_-50px_rgba(28,25,23,0.45)] ${
            !guardian.evaluation.guardianActive
              ? "border-amber-200 bg-amber-50"
              : guardian.evaluation.lockoutActive
                ? "border-red-300 bg-red-100"
                : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <p
            className={`text-xs font-semibold uppercase tracking-[0.22em] ${
              !guardian.evaluation.guardianActive
                ? "text-amber-700"
                : guardian.evaluation.lockoutActive
                  ? "text-red-700"
                  : "text-emerald-700"
            }`}
          >
            Current state
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            {!guardian.evaluation.guardianActive
              ? "Guardian is off — rules are not enforcing."
              : guardian.evaluation.lockoutActive
                ? "Trading is closed for today."
                : onboardingComplete
                  ? "Trading is open right now."
                  : "Complete onboarding to enable today's session."}
          </p>
          <p className="mt-3 text-sm text-stone-800">
            {!guardian.evaluation.guardianActive
              ? "Turn Guardian back on before relying on session boundaries."
              : guardian.evaluation.lockoutActive
                ? guardian.evaluation.primaryReasonLabel
                : onboardingComplete
                  ? "Guardian is active. No rule limits have been hit."
                  : "Finish onboarding to set your trading profile and rules."}
          </p>
          <div className="mt-4 grid gap-2 rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-sm text-stone-700">
            <p className="font-medium text-stone-950">
              {economicCalendarVisibility.providerLabel}
            </p>
            <p>{economicCalendarVisibility.sourceLabel}</p>
            {economicCalendarVisibility.scenarioLabel ? (
              <p>
                {economicCalendarVisibility.scenarioLabel}.{" "}
                {economicCalendarVisibility.scenarioDescription}
              </p>
            ) : null}
            <p>
              {economicCalendarVisibility.stateLabel}.{" "}
              {economicCalendarVisibility.detail}
            </p>
          </div>
        </section>

        <RuleNoticeList notices={guardianNotices} />

        <SectionCard
          title="Today snapshot"
          description="Session state, connection, today’s activity, and the next reset window."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Today session
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {todayGuardianSessionStart?.endedAt
                  ? "Ended"
                  : todayGuardianSessionStart
                    ? "Active"
                    : "Not started"}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {todayGuardianSessionStart?.endedAt
                  ? `Ended ${formatGuardianDate(todayGuardianSessionStart.endedAt, displayTimeZone)}`
                  : todayGuardianSessionStart
                    ? `Started ${formatGuardianDate(todayGuardianSessionStart.startedAt, displayTimeZone)}`
                    : "No session opened for today yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Connection
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {connectionProgression.label}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {brokerIntegration.account.adapterDisplay.label} · {brokerIntegration.account.platformName}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {connectionProgression.description}
              </p>
              <p className="mt-3 text-sm text-stone-700">
                {connectionProgression.nextStep}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {brokerIntegration.account.connectionState === "CONNECTED"
                  ? brokerIntegration.account.externalAccountId
                    ? `${brokerIntegration.account.connectionLabel} · ${brokerIntegration.account.externalAccountId}`
                    : brokerIntegration.account.connectionLabel
                  : brokerIntegration.account.adapterDisplay.connectionMode === "EXTERNAL_STUB"
                    ? "No live broker connection yet."
                    : "No connection active."}
              </p>
              {plannedCapabilities.length ? (
                <p className="mt-2 text-sm text-stone-600">
                  Planned capabilities: {plannedCapabilities.join(", ")}
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Today activity
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {guardian.evaluation.todayTradesCount} trades
              </p>
              <p className="mt-2 text-sm text-stone-600">
                P&amp;L {guardian.evaluation.todayPnL} · Consecutive losses{" "}
                {guardian.evaluation.consecutiveLosses}
              </p>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Check again
              </p>
              <p className="mt-2 text-lg font-semibold text-stone-950">
                {guardian.profile.resetMode === "DAILY"
                  ? formatGuardianDate(
                      guardian.evaluation.nextAllowedResetAt,
                      displayTimeZone,
                    )
                  : "Manual reset required"}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {guardian.evaluation.resetModeLabel}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Last reset:{" "}
                {formatGuardianDate(
                  guardian.evaluation.lastResetAt,
                  displayTimeZone,
                )}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={guardian.evaluation.lockoutActive ? "Why trading is closed" : "Why the day is still open"}
          description={
            guardian.evaluation.lockoutActive
              ? "The rule that closed the day, anything else that also hit, and the next move from here."
              : "The key boundary that is keeping the session open right now."
          }
        >
          <div
            className={`rounded-[1.5rem] border px-5 py-5 ${
              guardian.evaluation.lockoutActive
                ? "border-red-200 bg-red-50 text-red-900"
                : "border-stone-200 bg-stone-50 text-stone-800"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
              {guardian.evaluation.lockoutActive ? "Why it happened" : "Current read"}
            </p>
            <p className="mt-2 text-lg font-semibold">
              {guardian.evaluation.primaryReasonLabel}
            </p>

            {additionalTriggeredRuleLabels.length ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  Also hit
                </p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {additionalTriggeredRuleLabels.map((ruleLabel) => (
                    <li key={ruleLabel}>• {ruleLabel}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                What to do now
              </p>
              <ul className="mt-2 grid gap-1 text-sm">
                {(guardian.evaluation.actionGuidance.length > 0
                  ? guardian.evaluation.actionGuidance
                  : ["No immediate lockout action is required."]).map((actionText) => (
                  <li key={actionText}>• {actionText}</li>
                ))}
              </ul>
            </div>

            {guardian.profile.resetMode === "MANUAL" ? (
              <div className="mt-4 grid gap-1 text-sm">
                <p>Manual reset is required before the day can reopen.</p>
                <p>
                  {guardian.evaluation.resetAllowedNow
                    ? "Reset is available now."
                    : "Reset is not available yet."}
                </p>
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Rules and settings"
          description="The limits behind the day, plus the reset schedule."
        >
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <GuardianControls
              initialProfile={{
                guardianEnabled: guardian.profile.guardianEnabled,
                adapterKey:
                  guardian.profile.adapterKey === "tradovate_stub"
                    ? "tradovate_stub"
                    : "mock",
                platformName: guardian.profile.platformName ?? "Mock Platform",
                connectionStatus: guardian.profile.connectionStatus,
                maxTradesPerDay: guardian.profile.maxTradesPerDay,
                maxDailyLoss: guardian.profile.maxDailyLoss
                  ? Number(guardian.profile.maxDailyLoss.toString())
                  : null,
                stopAfterConsecutiveLosses:
                  guardian.profile.stopAfterConsecutiveLosses,
                dailyProfitTarget: guardian.profile.dailyProfitTarget
                  ? Number(guardian.profile.dailyProfitTarget.toString())
                  : null,
                copyTradeMode: guardian.profile.copyTradeMode,
                resetMode: guardian.profile.resetMode,
                dailyResetHour: guardian.profile.dailyResetHour,
                dailyResetTimezone: guardian.profile.dailyResetTimezone,
              }}
              initialStatus={{
                todayTradesCount: guardian.status.todayTradesCount,
                todayPnL: Number(guardian.status.todayPnL.toString()),
                consecutiveLosses: guardian.status.consecutiveLosses,
                currentLockoutActive: guardian.status.currentLockoutActive,
                nextAllowedResetAt: guardian.evaluation.nextAllowedResetAt
                  ? formatGuardianDate(
                      guardian.evaluation.nextAllowedResetAt,
                      displayTimeZone,
                    )
                  : null,
                lastResetAt: guardian.evaluation.lastResetAt
                  ? formatGuardianDate(
                      guardian.evaluation.lastResetAt,
                      displayTimeZone,
                    )
                  : null,
              }}
            />

            <div className="grid gap-4">
              <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Active limits
                </p>
                {guardian.evaluation.activeRules.length > 0 ? (
                  <ul className="mt-3 grid gap-2 text-sm text-stone-700">
                    {guardian.evaluation.activeRules.map((rule) => (
                      <li key={rule} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400" />
                        {rule}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-stone-500">No enforcement limits configured. Go to onboarding or edit rules above to add limits.</p>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-stone-200 bg-stone-50 px-5 py-5 text-sm text-stone-700">
                <p className="font-medium text-stone-950">Reset timing</p>
                <p className="mt-2">
                  Reset checks use{" "}
                  <span className="font-medium">{guardian.evaluation.resetTimezone}</span>.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <RecentSessionEvents items={recentSessionEvents} timeZone={displayTimeZone} />
      </div>
    </AppShell>
  );
}
