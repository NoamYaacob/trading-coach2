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
            sessionState={todaySessionState}
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

        {/* Session record */}
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
              items={todayActivityTimeline}
              title={activityTitle}
              description={activityDescription}
              timeZone={displayTimeZone}
            />
          )}
        </div>

        {/* Account & tools */}
        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Account &amp; tools
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Account + Access merged */}
            <SectionCard
              title="Account & access"
              description="Your login details and current subscription access."
            >
              <dl className="divide-y divide-stone-100 text-sm">
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Email</dt>
                  <dd className="font-medium text-stone-950 text-right truncate ml-4">{user.email}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Role</dt>
                  <dd className="font-medium text-stone-950">{user.role}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Subscription</dt>
                  <dd className="font-medium text-stone-950">{user.subscriptionStatus}</dd>
                </div>
                <div className={`flex items-start justify-between py-2.5 ${trialActive ? "text-emerald-800" : "text-amber-900"}`}>
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">Trial</dt>
                  <dd className="font-medium text-right ml-4">
                    {trialActive
                      ? `Active — ends ${formatDate(user.trialEndsAt, displayTimeZone)}`
                      : `Ended ${formatDate(user.trialEndsAt, displayTimeZone)}`}
                  </dd>
                </div>
              </dl>
            </SectionCard>

            {/* Onboarding + Telegram merged */}
            <SectionCard
              title="Setup status"
              description="Onboarding profile and Telegram coach connection."
            >
              <dl className="divide-y divide-stone-100 text-sm">
                <div className="py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Onboarding</dt>
                  <dd className="mt-1.5 font-medium text-stone-950">
                    {onboardingComplete ? "Profile complete." : "Not complete yet."}
                  </dd>
                  {!onboardingComplete ? (
                    <p className="mt-1 text-stone-500">Finish onboarding to unlock the day’s session flow.</p>
                  ) : null}
                </div>
                <div className="py-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Telegram coach</dt>
                  <dd className="mt-1.5 font-medium text-stone-950">
                    {telegramAccess.dashboardState === "not_connected"
                      ? "Not connected."
                      : telegramAccess.dashboardState === "connected"
                        ? "Connected — bot access active."
                        : telegramAccess.dashboardState === "connected_onboarding_incomplete"
                          ? "Connected, but onboarding still needed."
                          : "Connected, but account access is inactive."}
                  </dd>
                  <p className="mt-1 text-stone-500">
                    {telegramAccess.dashboardState === "connected"
                      ? user.telegramConnection?.telegramUsername
                        ? `@${user.telegramConnection.telegramUsername}`
                        : `Connected ${formatDate(user.telegramConnection?.connectedAt ?? null, displayTimeZone)}`
                      : telegramAccess.dashboardState === "connected_onboarding_incomplete"
                        ? "Finish onboarding for the bot to start coaching you."
                        : "Connect Telegram to continue the session flow in the coach bot."}
                  </p>
                </div>
              </dl>
            </SectionCard>

            <SectionCard
              title="Guardian"
              description="Rule engine status and session enforcement."
            >
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-stone-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                      Status
                    </p>
                    <p className="mt-2 text-lg font-semibold text-stone-950">
                      {guardian.evaluation.guardianActive ? "Active" : "Inactive"}
                    </p>
                    <p className="mt-2 text-sm text-stone-600">
                      {guardian.evaluation.connectionLabel}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                      Today
                    </p>
                    <p className="mt-2 font-medium text-stone-950">
                      {todaySessionState.kind === "ONBOARDING_REQUIRED"
                        ? "Waiting for onboarding."
                        : todaySessionState.sessionEnded
                          ? "Day ended from dashboard."
                          : todaySessionState.sessionStarted
                            ? "Session active — tracking live."
                            : todaySessionState.kind === "READY_TO_TRADE"
                              ? "Ready — limits enforcing."
                              : todaySessionState.kind === "GUARDIAN_DISABLED"
                              ? "Guardian is off."
                              : "Session closed for today."}
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
              description="Log a trade or session event manually — captured in Today Activity and the post-session review."
            >
              <ManualEventForm />
            </SectionCard>

            <SectionCard
              title="Trader context"
              description="Short-term session signals supporting the Guardian flow."
            >
              <div className="text-sm text-stone-700">
                {guardian.evaluation.lockoutActive ? (
                  <p className="mb-3 text-xs text-stone-500">
                    Trading permission is governed by Today Session — these are supporting signals only.
                  </p>
                ) : null}
                <p className="font-medium text-stone-950">
                  {humanizeTraderState(user.traderState?.currentState ?? "NONE")}
                </p>
                <p className="mt-1 text-stone-500">
                  {user.traderState?.stateNotes ?? "No live state active right now."}
                </p>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      Cooldown
                    </p>
                    <p className="mt-1 font-medium text-stone-950">
                      {liveStateFlags.cooldownActive ? "Active" : "Not active"}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Until {formatDate(user.traderState?.cooldownUntil ?? null, displayTimeZone)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      Loss streak
                    </p>
                    <p className="mt-1 font-medium text-stone-950">
                      {user.traderState?.recentLossStreak ?? 0}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Updated {formatDate(user.traderState?.lastStateAt ?? null, displayTimeZone)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                      Events today
                    </p>
                    <p className="mt-1 font-medium text-stone-950">
                      {todaySessionSummary.eventCount}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Distress: {todaySessionSummary.distressCount}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
