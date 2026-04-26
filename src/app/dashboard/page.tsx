import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { DashboardActions } from "@/app/dashboard/_components/dashboard-actions";
import { EconomicEventsPanel } from "@/app/dashboard/_components/economic-events-panel";
import { ManualEventForm } from "@/app/dashboard/_components/manual-event-form";
import { PostSessionReviewPanel } from "@/app/dashboard/_components/post-session-review-panel";
import { PremarketReadinessPanel } from "@/app/dashboard/_components/premarket-readiness-panel";
import { TodayActivityTimeline } from "@/app/dashboard/_components/today-activity-timeline";
import { TodaySessionPanel } from "@/app/dashboard/_components/today-session-panel";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  derivePremarketReadiness,
  deriveTodaySessionState,
  getGuardianSnapshot,
  getTodayGuardianSessionStart,
  type TodaySessionState,
} from "@/lib/guardian";
import { getLiveEnforcementState } from "@/lib/live-enforcement-state";
import { LiveEnforcementPanel } from "@/components/ui/live-enforcement-panel";
import { ManualRiskPanel } from "@/components/ui/manual-risk-panel";
import { computeManualRiskState } from "@/lib/manual-risk-state";
import { getTradingDayWindow } from "@/lib/trading-day";
import { evaluateTelegramAccess } from "@/lib/telegram-access";
import { buildPostSessionReview } from "@/lib/post-session-review";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { deriveManualEventSignals } from "@/lib/manual-trade-events";
import { getTodaySessionEvents, getTodaySessionSummary } from "@/lib/session-log";
import {
  buildTodayActivityTimeline,
  buildViolationActivityItems,
} from "@/lib/today-activity";
import { RuleNoticeList } from "@/components/ui/rule-notice-card";
import {
  getSelectedEconomicCalendarSnapshot,
  getCurrentPreNewsPolicy,
  getNextHighImpactEconomicEvent,
  buildEconomicCalendarVisibility,
  getEconomicCalendarSelection,
} from "@/lib/economic-calendar";
import {
  DISPLAY_TIME_ZONE_COOKIE,
  resolveDisplayTimeZone,
} from "@/lib/timezone";

export const metadata: Metadata = {
  title: "Dashboard — Guardrail",
};



export default async function DashboardPage() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      traderProfile: {
        select: { id: true, timezone: true },
      },
      telegramConnection: {
        select: {
          id: true,
          telegramUsername: true,
          connectedAt: true,
        },
      },
      coachingPreferences: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  const onboardingComplete = Boolean(user.traderProfile);
  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
  const telegramConnected = Boolean(user.telegramConnection);

  // Fetch RiskRules first (1 round-trip) so we can compute the user's
  // trading-day window before querying today's trades. Everything else
  // is parallel.
  const riskRules = await prisma.riskRules.findUnique({
    where: { userId: currentUser.id },
  });
  const tradingDay = getTradingDayWindow({
    timezone: displayTimeZone,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });
  const [
    todaySessionSummary,
    todaySessionEvents,
    guardian,
    todayGuardianSessionStart,
    liveEnforcement,
    brokerCount,
    todayManualTrades,
  ] = await Promise.all([
    getTodaySessionSummary(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
    getGuardianSnapshot(currentUser.id),
    getTodayGuardianSessionStart(currentUser.id),
    getLiveEnforcementState(currentUser.id),
    prisma.connectedAccount.count({ where: { userId: currentUser.id, isActive: true } }),
    prisma.manualTradeEntry.findMany({
      where: {
        userId: currentUser.id,
        tradedAt: { gte: tradingDay.start, lt: tradingDay.end },
      },
      orderBy: { tradedAt: "asc" },
    }),
  ]);
  const hasBroker = brokerCount > 0;
  const manualRisk = computeManualRiskState({ rules: riskRules, todayTrades: todayManualTrades });
  const guardianAdditionalRulesCount = Math.max(
    guardian.evaluation.triggeredRuleLabels.length - 1,
    0,
  );
  const economicCalendarSelection = getEconomicCalendarSelection(user.coachingPreferences);
  const economicCalendarSnapshot = await getSelectedEconomicCalendarSnapshot(
    user.coachingPreferences,
  );
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const economicCalendarVisibility = buildEconomicCalendarVisibility({
    snapshot: economicCalendarSnapshot,
    policyStatus: economicCalendarPolicy,
    nextHighImpactEvent: getNextHighImpactEconomicEvent(economicCalendarSnapshot),
    timeZone: displayTimeZone,
    scenario: economicCalendarSelection.stubScenario,
  });
  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: todayGuardianSessionStart,
    preNewsPolicyStatus: economicCalendarPolicy,
  });
  const premarketReadiness = derivePremarketReadiness(todaySessionState);
  const premarketReadinessWithEvent = premarketReadiness
    ? {
        ...premarketReadiness,
        upcomingEventNote:
          economicCalendarVisibility.tone === "clear"
            ? `${economicCalendarVisibility.providerLabel}: ${economicCalendarVisibility.stateLabel}.`
            : `${economicCalendarVisibility.providerLabel}: ${economicCalendarVisibility.stateLabel}. ${economicCalendarVisibility.detail}`,
      }
    : null;
  const telegramAccess = evaluateTelegramAccess({
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    onboardingComplete,
    telegramConnected,
    email: currentUser.email,
  });

  const telegramBotUsername =
    process.env.TELEGRAM_BOT_USERNAME ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null;
  const telegramBotLink = telegramBotUsername
    ? `https://t.me/${telegramBotUsername}`
    : null;
  const manualEventSignals = deriveManualEventSignals(todaySessionEvents);
  const manualTradeCount =
    manualEventSignals.winCount + manualEventSignals.lossCount + manualEventSignals.tradeCount;
  // Canonical manual-mode numbers come from the journal. Fall back to session-event
  // signals only when journal is empty.
  const journalDrivenTradeCount = manualRisk.todayTradesCount;
  const journalDrivenPnL = manualRisk.todayPnL;
  const journalDrivenLossStreak = manualRisk.consecutiveLosses;
  const todaySessionStateForPanel: TodaySessionState = {
    ...todaySessionState,
    todayTradesCount: Math.max(
      todaySessionState.todayTradesCount,
      journalDrivenTradeCount > 0 ? journalDrivenTradeCount : manualTradeCount,
    ),
    todayPnL:
      journalDrivenTradeCount > 0
        ? journalDrivenPnL
        : manualEventSignals.netPnL !== null
          ? Math.min(todaySessionState.todayPnL, manualEventSignals.netPnL)
          : todaySessionState.todayPnL,
    consecutiveLosses: Math.max(
      todaySessionState.consecutiveLosses,
      journalDrivenLossStreak > 0 ? journalDrivenLossStreak : manualEventSignals.consecutiveLosses,
    ),
  };
  const violationFeed = buildViolationFeed(
    buildRuleEngineInputFromGuardianSnapshot(guardian, {
      sessionStarted: todaySessionState.sessionStarted,
      sessionEnded: todaySessionState.sessionEnded,
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
  const todayActivityTimeline = buildTodayActivityTimeline({
    sessionStart: todayGuardianSessionStart,
    guardian,
    sessionEvents: todaySessionEvents,
  });
  const violationActivityItems = buildViolationActivityItems(violationFeed);
  const mergedActivityTimeline = [
    ...todayActivityTimeline,
    ...violationActivityItems,
  ].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  // Notices: warnings that add context not already covered by other visible surfaces.
  // - guardian_disabled is shown prominently in the session panel (GUARDIAN_DISABLED state)
  // - session_not_started is covered by the PremarketReadinessPanel
  // - no_trade_before_major_news before start is covered by PremarketReadinessPanel
  // - manual_rule_breach (triggered) is included explicitly — not covered anywhere else
  const dashboardNotices = [
    ...violationFeed.warningViolations.filter(
      (v) =>
        v.ruleId !== "guardian_disabled" &&
        v.ruleId !== "session_not_started" &&
        !(
          v.ruleId === "no_trade_before_major_news" &&
          !todaySessionState.sessionStarted
        ),
    ),
    ...violationFeed.triggeredViolations.filter(
      (v) => v.ruleId === "manual_rule_breach",
    ),
  ];
  const postSessionReview = buildPostSessionReview({
    session: todayGuardianSessionStart,
    summary: todaySessionSummary,
    activityItems: mergedActivityTimeline,
    guardian,
    violationFeed,
  });
  const isSessionEnded = todaySessionState.sessionEnded;
  const isSessionActive =
    todaySessionState.kind === "READY_TO_TRADE" &&
    todaySessionState.sessionStarted &&
    !todaySessionState.sessionEnded;
  // Suppress the premarket banner when the session panel already explains the same state
  // prominently (GUARDIAN_DISABLED and RESET_PENDING each render their own large hero).
  const showPremarketReadiness =
    Boolean(premarketReadiness) &&
    todaySessionState.kind !== "GUARDIAN_DISABLED" &&
    todaySessionState.kind !== "RESET_PENDING";
  const activityTitle = isSessionEnded ? "Today activity recap" : "Today activity";
  const activityDescription = isSessionEnded
    ? "The sequence that led into the close."
    : isSessionActive
      ? "The live sequence of what has happened so far."
      : "What has happened so far today.";

  return (
    <AppShell
      eyebrow="Risk Command Center"
      title="Today’s session."
      description="Trading permission, risk budget, and Guardian enforcement state. Manual mode locks the session inside the app; broker-level order blocking is on the roadmap."
      actions={
        <DashboardActions
          telegramConnected={telegramConnected}
          onboardingComplete={onboardingComplete}
        />
      }
    >
      <div className="grid gap-10">
        {/* Enforcement mode banner — only shown in manual mode */}
        {!liveEnforcement && (
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
            <div>
              <p className="font-semibold text-amber-900">Manual mode · App-level enforcement only</p>
              <p className="mt-0.5 text-stone-700">
                Guardrail tracks and warns based on what you log. No broker is connected — live fills are not monitored and positions cannot be automatically flattened.
              </p>
            </div>
            <a
              href="/accounts"
              className="shrink-0 rounded-full border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
            >
              Connect broker →
            </a>
          </div>
        )}

        {/* Session status — live enforcement panel when live account connected, manual otherwise */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Trading permission
          </p>
          {showPremarketReadiness ? (
            <PremarketReadinessPanel readiness={premarketReadinessWithEvent!} />
          ) : null}
          {liveEnforcement ? (
            <LiveEnforcementPanel state={liveEnforcement} timeZone={displayTimeZone} />
          ) : (
            <>
              <ManualRiskPanel
                state={manualRisk}
                hasRules={Boolean(riskRules)}
                tradingDayLabel={tradingDay.label}
              />
              <TodaySessionPanel
                sessionState={todaySessionStateForPanel}
                additionalTriggeredRulesCount={guardianAdditionalRulesCount}
                telegramAccess={telegramAccess}
                telegramBotLink={telegramBotLink}
                displayTimeZone={displayTimeZone}
              />
              <RuleNoticeList notices={dashboardNotices} />
            </>
          )}
        </div>

        {/* Risk environment */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Risk environment
          </p>
          <EconomicEventsPanel
            events={economicCalendarSnapshot.events}
            providerLabel={economicCalendarVisibility.providerLabel}
            sourceLabel={economicCalendarVisibility.sourceLabel}
            scenarioLabel={economicCalendarVisibility.scenarioLabel}
            timeZone={displayTimeZone}
          />
        </div>

        {/* Session record — only shown once the session has started or there is activity */}
        {(mergedActivityTimeline.length > 0 || isSessionActive || isSessionEnded) ? (
          <div className="grid gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
              Session record
            </p>
            {postSessionReview ? (
              <div className="grid gap-4">
                <PostSessionReviewPanel
                  review={postSessionReview}
                  timeZone={displayTimeZone}
                />
                <TodayActivityTimeline
                  items={mergedActivityTimeline}
                  title={activityTitle}
                  description={activityDescription}
                  timeZone={displayTimeZone}
                />
              </div>
            ) : (
              <TodayActivityTimeline
                items={mergedActivityTimeline}
                title={activityTitle}
                description={activityDescription}
                timeZone={displayTimeZone}
              />
            )}
          </div>
        ) : null}

        {/* Quick actions */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Quick actions
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickAction
              href="/guardian"
              title="Open Guardian"
              description="Permission status and active rules."
            />
            <QuickAction
              href="/rules"
              title="Edit rules"
              description="Configure limits and on-breach actions."
            />
            <QuickAction
              href="/journal"
              title="Add trade"
              description="Log a trade or session event."
            />
            {hasBroker ? (
              <QuickAction
                href="/accounts"
                title="Manage accounts"
                description="Broker connections and capabilities."
              />
            ) : (
              <QuickAction
                href="/accounts"
                title="Connect broker"
                description="Read live fills from your account."
              />
            )}
          </div>

          {/* Setup nudge — only when something still needs doing */}
          {(!onboardingComplete || !telegramConnected) ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Setup</p>
              <ul className="mt-2 grid gap-1 text-sm text-stone-700">
                {!onboardingComplete && (
                  <li>
                    <a href="/onboarding" className="font-medium text-stone-950 underline-offset-2 hover:underline">
                      Complete onboarding →
                    </a>{" "}
                    Set your daily limits and enable Guardian enforcement.
                  </li>
                )}
                {!telegramConnected && (
                  <li>
                    <a href="/alerts" className="font-medium text-stone-950 underline-offset-2 hover:underline">
                      Connect Telegram →
                    </a>{" "}
                    Receive Guardian lockout alerts and enforcement notifications.
                  </li>
                )}
              </ul>
            </div>
          ) : null}

          {/* Inline manual entry — kept compact */}
          <SectionCard
            title="Log a trade or event"
            description="Quick manual entry — feeds today's activity and the post-session review."
          >
            <ManualEventForm />
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}

function QuickAction({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-2xl border border-stone-200 bg-white px-5 py-4 transition hover:border-stone-950 hover:shadow-[0_8px_24px_-12px_rgba(28,25,23,0.18)]"
    >
      <p className="text-sm font-semibold text-stone-950">{title}</p>
      <p className="mt-1 text-xs text-stone-500">{description}</p>
      <p className="mt-3 text-xs font-medium text-stone-400 group-hover:text-stone-700">→</p>
    </a>
  );
}
