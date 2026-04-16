import Link from "next/link";
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
import { isTrialActive } from "@/lib/trial";
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
  title: "Dashboard",
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
      email: true,
      role: true,
      subscriptionStatus: true,
      trialStartedAt: true,
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
  const trialActive = isTrialActive(user.trialEndsAt);
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
  const showPremarketReadiness = Boolean(premarketReadiness);
  const activityTitle = isSessionEnded ? "Today activity recap" : "Today activity";
  const activityDescription = isSessionEnded
    ? "The sequence that led into the close."
    : isSessionActive
      ? "The live sequence of what has happened so far."
      : "What has happened so far today.";

  return (
    <AppShell
      eyebrow="Dashboard"
      title="Your trading coach account."
      description="Move through the day in one place: get ready, manage the live session, and close it cleanly."
      actions={
        <DashboardActions
          telegramConnected={telegramConnected}
          onboardingComplete={onboardingComplete}
        />
      }
    >
      <div className="grid gap-6">
        <div className="grid gap-4">
          {showPremarketReadiness ? (
            <PremarketReadinessPanel readiness={premarketReadinessWithEvent!} />
          ) : null}
          <TodaySessionPanel
            sessionState={todaySessionState}
            additionalTriggeredRulesCount={guardianAdditionalRulesCount}
            telegramAccess={telegramAccess}
            telegramBotLink={telegramBotLink}
            displayTimeZone={displayTimeZone}
          />
          <RuleNoticeList notices={dashboardNotices} />
        </div>

        <EconomicEventsPanel
          events={economicCalendarSnapshot.events}
          providerLabel={economicCalendarVisibility.providerLabel}
          sourceLabel={economicCalendarVisibility.sourceLabel}
          scenarioLabel={economicCalendarVisibility.scenarioLabel}
          timeZone={displayTimeZone}
        />

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
            items={todayActivityTimeline}
            title={activityTitle}
            description={activityDescription}
            timeZone={displayTimeZone}
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Account" description="Authenticated website account details.">
            <dl className="grid gap-4 text-sm text-stone-700">
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Email
                </dt>
                <dd className="mt-1 text-base font-medium text-stone-950">{user.email}</dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Role
                </dt>
                <dd className="mt-1 text-base font-medium text-stone-950">{user.role}</dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title="Access status"
            description="Your trial and subscription state determines dashboard and bot availability."
          >
            <dl className="grid gap-4 text-sm text-stone-700">
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Subscription status
                </dt>
                <dd className="mt-1 text-base font-medium text-stone-950">
                  {user.subscriptionStatus}
                </dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Trial started
                </dt>
                <dd className="mt-1 text-base font-medium text-stone-950">
                  {formatDate(user.trialStartedAt, displayTimeZone)}
                </dd>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                  Trial ends
                </dt>
                <dd className="mt-1 text-base font-medium text-stone-950">
                  {formatDate(user.trialEndsAt, displayTimeZone)}
                </dd>
              </div>
              <div
                className={`rounded-2xl px-4 py-3 ${
                  trialActive
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-900"
                }`}
              >
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
                  Trial active
                </dt>
                <dd className="mt-1 text-base font-medium">
                  {trialActive ? "Yes, trial access is active." : "No, trial access has ended."}
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title="Onboarding status"
            description="Core profile status for the coaching account."
          >
            <div className="rounded-2xl bg-stone-50 px-4 py-4 text-sm text-stone-700">
              <p className="font-medium text-stone-950">
                {onboardingComplete
                  ? "Onboarding profile is in place."
                  : "Onboarding is not complete yet."}
              </p>
              {!onboardingComplete ? (
                <p className="mt-3 text-sm text-stone-600">
                  Finish onboarding here to unlock the day’s session flow.
                </p>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Telegram status"
            description="Connection status for the mental coach bot."
          >
            <div className="rounded-2xl bg-stone-50 px-4 py-4 text-sm text-stone-700">
              <p className="font-medium text-stone-950">
                {telegramAccess.dashboardState === "not_connected"
                  ? "Telegram is not connected yet."
                  : telegramAccess.dashboardState === "connected"
                    ? "Telegram is connected and bot access is active."
                    : telegramAccess.dashboardState === "connected_onboarding_incomplete"
                      ? "Telegram is connected, but onboarding is still needed."
                      : "Telegram is connected, but account access is inactive."}
              </p>
              {telegramAccess.dashboardState === "connected" ? (
                <p className="mt-2 text-stone-600">
                  {user.telegramConnection?.telegramUsername
                    ? `Connected as @${user.telegramConnection.telegramUsername}`
                    : `Connected on ${formatDate(user.telegramConnection?.connectedAt ?? null, displayTimeZone)}`}
                </p>
              ) : telegramAccess.dashboardState === "connected_onboarding_incomplete" ? (
                <p className="mt-2 text-stone-600">
                  Finish onboarding for the bot to start coaching you.
                </p>
              ) : (
                <p className="mt-2 text-stone-600">
                  Connect Telegram to continue the session flow in the coach bot.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Trading Guardian"
            description="Supporting Guardian context for the session flow."
          >
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-stone-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Guardian
                  </p>
                  <p className="mt-2 text-lg font-semibold text-stone-950">
                    {guardian.evaluation.guardianActive ? "Active" : "Inactive"}
                  </p>
                  <p className="mt-2 text-sm text-stone-600">
                    Connection: {guardian.evaluation.connectionLabel}
                  </p>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Guardian read
                  </p>
                  <p className="mt-2 font-medium text-stone-950">
                    {todaySessionState.kind === "ONBOARDING_REQUIRED"
                      ? "Guardian is set up and waiting for onboarding to complete."
                      : todaySessionState.sessionEnded
                        ? "This Guardian day has been ended from the dashboard."
                        : todaySessionState.sessionStarted
                          ? "The session is active and Guardian is tracking it."
                          : todaySessionState.kind === "READY_TO_TRADE"
                            ? "Guardian is ready and limits are enforcing the session."
                            : todaySessionState.kind === "GUARDIAN_DISABLED"
                            ? "Guardian is off, so session limits are not enforcing the day."
                            : "Guardian has closed the session for today."}
                  </p>
                </div>
              </div>

              <Link
                href="/guardian"
                className="inline-flex w-fit rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-900"
              >
                Open Guardian
              </Link>
            </div>
          </SectionCard>

          <SectionCard
            title="Session event log"
            description="Manual entry — no live broker connected. Log a trade or session event to capture it in Today Activity and the post-session review."
          >
            <ManualEventForm />
          </SectionCard>

          <SectionCard
            title="Trader context"
            description="Short-term session signals that support the main Guardian flow."
          >
            <div className="rounded-2xl bg-stone-50 px-4 py-4 text-sm text-stone-700">
              {guardian.evaluation.lockoutActive ? (
                <div className="mb-4 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-700">
                  <p className="font-medium text-stone-950">
                    Trading permission is already set by Today Session.
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    These metrics are supporting session context, not the primary flow.
                  </p>
                </div>
              ) : null}
              <p className="font-medium text-stone-950">
                Current state: {humanizeTraderState(user.traderState?.currentState ?? "NONE")}
              </p>
              <p className="mt-2 text-stone-600">
                {user.traderState?.stateNotes
                  ? user.traderState.stateNotes
                  : "No live state is active right now."}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Cooldown
                  </p>
                  <p className="mt-1 font-medium text-stone-950">
                    {liveStateFlags.cooldownActive ? "Active" : "Not active"}
                  </p>
                  <p className="mt-1 text-stone-600">
                    Until {formatDate(user.traderState?.cooldownUntil ?? null, displayTimeZone)}
                  </p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Recent loss streak
                  </p>
                  <p className="mt-1 font-medium text-stone-950">
                    {user.traderState?.recentLossStreak ?? 0}
                  </p>
                  <p className="mt-1 text-stone-600">
                    Updated {formatDate(user.traderState?.lastStateAt ?? null, displayTimeZone)}
                  </p>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                    Events today
                  </p>
                  <p className="mt-1 font-medium text-stone-950">
                    {todaySessionSummary.eventCount}
                  </p>
                  <p className="mt-1 text-stone-600">
                    Distress moments: {todaySessionSummary.distressCount}
                  </p>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
