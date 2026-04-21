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
import { deriveShortLivedCoachingFlags } from "@/lib/trader-state";
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

function formatDate(value: Date | null, timeZone: string) {
  if (!value) {
    return "Not set";
  }

  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value)} ${timeZone}`;
}


function humanizeTraderState(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

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
      traderState: {
        select: {
          currentState: true,
          stateNotes: true,
          recentLossStreak: true,
          needsCooldown: true,
          cooldownUntil: true,
          lastStateAt: true,
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
  const liveStateFlags = deriveShortLivedCoachingFlags(user.traderState);
  const [todaySessionSummary, todaySessionEvents, guardian, todayGuardianSessionStart] =
    await Promise.all([
      getTodaySessionSummary(currentUser.id),
      getTodaySessionEvents(currentUser.id, undefined, "asc"),
      getGuardianSnapshot(currentUser.id),
      getTodayGuardianSessionStart(currentUser.id),
    ]);
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
  });

  const telegramBotUsername =
    process.env.TELEGRAM_BOT_USERNAME ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null;
  const telegramBotLink = telegramBotUsername
    ? `https://t.me/${telegramBotUsername}`
    : null;
  const manualEventSignals = deriveManualEventSignals(todaySessionEvents);
  const manualTradeCount =
    manualEventSignals.winCount + manualEventSignals.lossCount + manualEventSignals.tradeCount;
  const todaySessionStateForPanel: TodaySessionState = {
    ...todaySessionState,
    todayTradesCount: Math.max(todaySessionState.todayTradesCount, manualTradeCount),
    todayPnL:
      manualEventSignals.netPnL !== null
        ? Math.min(todaySessionState.todayPnL, manualEventSignals.netPnL)
        : todaySessionState.todayPnL,
    consecutiveLosses: Math.max(
      todaySessionState.consecutiveLosses,
      manualEventSignals.consecutiveLosses,
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
      eyebrow="Control Center"
      title="Today’s trading session."
      description="Monitor your session in real time, log activity, and let Guardrail enforce your rules automatically."
      actions={
        <DashboardActions
          telegramConnected={telegramConnected}
          onboardingComplete={onboardingComplete}
        />
      }
    >
      <div className="grid gap-10">
        {/* Session status */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Session status
          </p>
          {showPremarketReadiness ? (
            <PremarketReadinessPanel readiness={premarketReadinessWithEvent!} />
          ) : null}
          <TodaySessionPanel
            sessionState={todaySessionStateForPanel}
            additionalTriggeredRulesCount={guardianAdditionalRulesCount}
            telegramAccess={telegramAccess}
            telegramBotLink={telegramBotLink}
            displayTimeZone={displayTimeZone}
          />
          <RuleNoticeList notices={dashboardNotices} />
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

        {/* Tools & context */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Tools &amp; context
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Log a trade — most actionable, always first */}
            <SectionCard
              title="Log a trade"
              description="Record a trade or session event — feeds Today activity and the post-session review."
            >
              <ManualEventForm />
            </SectionCard>

            {/* Trader context — mental state signals used by the coaching flow */}
            <SectionCard
              title="Trader context"
              description="Short-term mental state signals used by the coaching flow."
            >
              <div className="text-sm text-stone-700">
                {user.traderState?.currentState && user.traderState.currentState !== "NONE" ? (
                  <p className="font-medium text-stone-950">
                    {humanizeTraderState(user.traderState.currentState)}
                  </p>
                ) : null}
                <p className={user.traderState?.currentState && user.traderState.currentState !== "NONE" ? "mt-1 text-stone-500" : "text-stone-500"}>
                  {user.traderState?.stateNotes ?? "No active mental state flagged right now."}
                </p>
                {liveStateFlags.cooldownActive ? (
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      Cooldown active
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      Until {formatDate(user.traderState?.cooldownUntil ?? null, displayTimeZone)}
                    </p>
                  </div>
                ) : null}
              </div>
            </SectionCard>

            {/* Setup status — only when something still needs doing */}
            {(!onboardingComplete || !telegramConnected) ? (
              <SectionCard
                title="Setup status"
                description="Complete setup to unlock the full coaching session flow."
              >
                <dl className="divide-y divide-stone-100 text-sm">
                  {!onboardingComplete ? (
                    <div className="py-3">
                      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Onboarding</dt>
                      <dd className="mt-1.5 font-medium text-stone-950">Not complete yet.</dd>
                      <p className="mt-1 text-stone-500">Finish onboarding to unlock the session flow.</p>
                    </div>
                  ) : null}
                  {!telegramConnected ? (
                    <div className="py-3">
                      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Telegram coach</dt>
                      <dd className="mt-1.5 font-medium text-stone-950">Not connected.</dd>
                      <p className="mt-1 text-stone-500">Connect Telegram to continue the session in the coach bot.</p>
                    </div>
                  ) : null}
                </dl>
              </SectionCard>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
