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
  formatEconomicEventTimeNoTz,
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

  const riskRules = await prisma.riskRules.findUnique({
    where: { userId: currentUser.id },
  });

  const tradingDay = getTradingDayWindow({
    timezone: displayTimeZone,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });

  const now = new Date();
  const effectiveManualEnd = tradingDay.end < now ? tradingDay.end : now;

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
        tradedAt: { gte: tradingDay.start, lt: effectiveManualEnd },
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
  const nextHighImpactEvent = getNextHighImpactEconomicEvent(economicCalendarSnapshot);
  const economicCalendarVisibility = buildEconomicCalendarVisibility({
    snapshot: economicCalendarSnapshot,
    policyStatus: economicCalendarPolicy,
    nextHighImpactEvent,
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
        upcomingEvent:
          nextHighImpactEvent && economicCalendarVisibility.tone !== "clear"
            ? {
                eyebrow: economicCalendarVisibility.providerLabel,
                stateLabel: economicCalendarVisibility.stateLabel,
                title: nextHighImpactEvent.title,
                time: formatEconomicEventTimeNoTz(nextHighImpactEvent.startTime, displayTimeZone),
              }
            : undefined,
        upcomingEventNote:
          !nextHighImpactEvent && economicCalendarVisibility.tone === "clear"
            ? `${economicCalendarVisibility.providerLabel}: ${economicCalendarVisibility.stateLabel}.`
            : undefined,
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

  const setupNeeded =
    !onboardingComplete || (onboardingComplete && !riskRules);

  return (
    <AppShell
      eyebrow="TODAY'S TRADING STATE"
      title="Your trading dashboard"
      description="See your current permission, trading plan, account mode, and next action before you trade."
      actions={
        <DashboardActions
          telegramConnected={telegramConnected}
          onboardingComplete={onboardingComplete}
        />
      }
    >
      <div className="grid gap-8">
        <TradingStateCard
          setupNeeded={setupNeeded}
          onboardingComplete={onboardingComplete}
          hasBroker={hasBroker}
          guardianKind={todaySessionState.kind}
          lockoutActive={guardian.evaluation.lockoutActive}
          liveRiskState={liveEnforcement?.riskState ?? null}
          connectionStatus={liveEnforcement?.connectionStatus ?? null}
          sessionStarted={todaySessionState.sessionStarted}
          sessionEnded={todaySessionState.sessionEnded}
        />

        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Trading permission
          </p>
          {showPremarketReadiness ? (
            <PremarketReadinessPanel readiness={premarketReadinessWithEvent!} />
          ) : null}
          {liveEnforcement ? (
            <LiveEnforcementPanel state={liveEnforcement} timeZone={displayTimeZone} />
          ) : todaySessionState.kind === "GUARDIAN_DISABLED" ? (
            <GuardianPausedPanel />
          ) : (
            <>
              <div className="hidden md:block">
                <ManualRiskPanel
                  state={manualRisk}
                  hasRules={Boolean(riskRules)}
                  tradingDayLabel={tradingDay.label}
                />
              </div>
              <TodaySessionPanel
                sessionState={todaySessionStateForPanel}
                additionalTriggeredRulesCount={guardianAdditionalRulesCount}
                telegramAccess={telegramAccess}
                telegramBotLink={telegramBotLink}
                displayTimeZone={displayTimeZone}
                mobileStats={{
                  todayPnL: manualRisk.todayPnL,
                  todayTradesCount: manualRisk.todayTradesCount,
                  remainingDailyLossBudget: manualRisk.remainingDailyLossBudget,
                  consecutiveLosses: manualRisk.consecutiveLosses,
                }}
              />
              <RuleNoticeList notices={dashboardNotices} />
            </>
          )}
        </div>

        <div className="grid gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
            Quick actions
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <QuickAction
              href="/rules"
              title="Trading Plan"
              description="Edit limits and breach actions."
            />
            {todaySessionState.kind === "GUARDIAN_DISABLED" ? (
              <QuickAction
                href="/guardian"
                title="Status details"
                description="See why protection is paused."
              />
            ) : (
              <QuickAction
                href="/guardian"
                title="Status details"
                description="Why you're Allowed, Warning, or Locked."
              />
            )}
            <QuickAction
              href="/accounts"
              title={hasBroker ? "Broker Connections" : "Connect broker"}
              description={hasBroker ? "Manage broker connections." : "Prepare your Tradovate connection."}
            />
          </div>
        </div>

        {mergedActivityTimeline.length > 0 || isSessionActive || isSessionEnded ? (
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

        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Session details
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="mt-5 grid gap-6">
            <EconomicEventsPanel
              events={economicCalendarSnapshot.events}
              providerLabel={economicCalendarVisibility.providerLabel}
              sourceLabel={economicCalendarVisibility.sourceLabel}
              scenarioLabel={economicCalendarVisibility.scenarioLabel}
              timeZone={displayTimeZone}
            />
            <SectionCard
              compact
              title="Log a trade or event"
              description="Quick manual entry — feeds today's activity."
            >
              <ManualEventForm compact />
            </SectionCard>
            {!telegramConnected && (
              <p className="text-xs text-stone-500">
                <a
                  href="/alerts"
                  className="font-medium text-stone-700 underline-offset-2 hover:underline"
                >
                  Connect Telegram
                </a>{" "}
                to receive lockout and warning alerts on your phone.
              </p>
            )}
          </div>
        </details>
      </div>
    </AppShell>
  );
}

function TradingStateCard({
  setupNeeded,
  onboardingComplete,
  hasBroker,
  guardianKind,
  lockoutActive,
  liveRiskState,
  connectionStatus,
  sessionStarted,
  sessionEnded,
}: {
  setupNeeded: boolean;
  onboardingComplete: boolean;
  hasBroker: boolean;
  guardianKind: string;
  lockoutActive: boolean;
  liveRiskState: "NORMAL" | "WARNING" | "STOPPED" | null;
  connectionStatus: string | null;
  sessionStarted: boolean;
  sessionEnded: boolean;
}) {
  let permissionLabel: string;
  let permissionTone: string;
  if (setupNeeded) {
    permissionLabel = "Setup needed";
    permissionTone = "text-stone-500";
  } else if (guardianKind === "GUARDIAN_DISABLED") {
    permissionLabel = "Paused";
    permissionTone = "text-stone-500";
  } else if (lockoutActive || liveRiskState === "STOPPED") {
    permissionLabel = "Locked";
    permissionTone = "text-red-600";
  } else if (liveRiskState === "WARNING") {
    permissionLabel = "Warning";
    permissionTone = "text-amber-600";
  } else {
    permissionLabel = "Allowed";
    permissionTone = "text-emerald-600";
  }

  const modeLabel = hasBroker ? "Broker-connected read-only" : "Manual Mode";
  const modeDetail = hasBroker
    ? "Guardrail can evaluate Tradovate data. Broker-side order blocking is not enabled yet."
    : "Tracks trades you enter yourself. Cannot block broker orders.";

  let brokerLabel: string;
  let brokerTone: string;
  if (!hasBroker) {
    brokerLabel = "Not connected";
    brokerTone = "text-stone-500";
  } else if (connectionStatus === "connected_live") {
    brokerLabel = "Live";
    brokerTone = "text-emerald-600";
  } else if (connectionStatus === "connected_readonly") {
    brokerLabel = "Connected · Read-only";
    brokerTone = "text-sky-600";
  } else if (connectionStatus === "expired") {
    brokerLabel = "Stale — re-authorize";
    brokerTone = "text-orange-600";
  } else {
    brokerLabel = "Connected";
    brokerTone = "text-stone-700";
  }

  let nextHref: string;
  let nextText: string;
  if (!onboardingComplete) {
    nextHref = "/onboarding";
    nextText = "Finish onboarding to enable protection →";
  } else if (setupNeeded) {
    nextHref = "/rules";
    nextText = "Set rules on the Rules page to activate protection →";
  } else if (guardianKind === "GUARDIAN_DISABLED") {
    nextHref = "/rules#guardian-toggle";
    nextText = "Enable protection before trading →";
  } else if (permissionLabel === "Locked") {
    nextHref = "/guardian";
    nextText = "Trading paused — reset on the Guardian page →";
  } else if (permissionLabel === "Warning") {
    nextHref = "/guardian";
    nextText = "A rule was triggered — review before your next trade →";
  } else if (!hasBroker) {
    nextHref = "/accounts/connect/tradovate";
    nextText = "Connect Tradovate for broker-based enforcement →";
  } else if (sessionEnded) {
    nextHref = "/guardian";
    nextText = "Session ended — review today's activity →";
  } else if (sessionStarted) {
    nextHref = "/guardian";
    nextText = "Session active — rules are monitoring your trades →";
  } else {
    nextHref = "/guardian";
    nextText = "Start a session when ready to trade →";
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white/90 px-5 py-5 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)]">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-stone-400">
        Current trading state
      </p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-medium text-stone-400">Permission</p>
          <p className={`mt-1 text-sm font-semibold ${permissionTone}`}>{permissionLabel}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-400">Mode</p>
          <p className="mt-1 text-sm font-medium text-stone-800">{modeLabel}</p>
          <p className="mt-0.5 text-xs leading-5 text-stone-500">{modeDetail}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-stone-400">Broker</p>
          <p className={`mt-1 text-sm font-medium ${brokerTone}`}>{brokerLabel}</p>
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-stone-400">Next</p>
          <a
            href={nextHref}
            className="mt-1 block text-sm text-stone-700 underline-offset-2 hover:text-stone-950 hover:underline"
          >
            {nextText}
          </a>
        </div>
      </div>
    </div>
  );
}

function GuardianPausedPanel() {
  return (
    <section className="rounded-[2rem] border border-stone-200 bg-stone-50 px-6 py-4 shadow-[0_24px_70px_-50px_rgba(28,25,23,0.2)]">
      <span className="inline-flex rounded-full bg-stone-400 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white">
        Paused
      </span>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
        Protection is paused.
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
        Your rules are saved. Enable protection before the session starts.
      </p>
      <div className="mt-4">
        <a
          href="/rules#guardian-toggle"
          className="inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Enable protection
        </a>
      </div>
    </section>
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
      className="group flex flex-col rounded-2xl border border-stone-200 bg-white/90 px-3 py-2.5 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.08)] transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_10px_28px_-8px_rgba(28,25,23,0.16)] sm:p-5"
    >
      <p className="text-sm font-semibold text-stone-950">{title}</p>
      <p className="mt-1 flex-1 text-xs leading-5 text-stone-500">{description}</p>
      <p className="mt-3 text-xs font-semibold text-stone-400 transition-colors group-hover:text-stone-700 sm:mt-4">
        →
      </p>
    </a>
  );
}

