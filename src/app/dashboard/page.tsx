import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { CommandCenter } from "@/app/dashboard/_components/command-center/command-center";
import { loadCommandCenterData } from "@/app/dashboard/_components/command-center/data";
import { SummaryStrip } from "@/app/dashboard/_components/command-center/summary-strip";
import { AutoSync } from "@/app/dashboard/_components/auto-sync";
import { DashboardActions } from "@/app/dashboard/_components/dashboard-actions";
import { ManualEventForm } from "@/app/dashboard/_components/manual-event-form";
import { PostSessionReviewPanel } from "@/app/dashboard/_components/post-session-review-panel";
import { PremarketReadinessPanel } from "@/app/dashboard/_components/premarket-readiness-panel";
import { RuleProgressPanel } from "@/app/dashboard/_components/rule-progress-panel";
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
import { needsSync } from "@/lib/sync-freshness";

export const metadata: Metadata = {
  title: "Dashboard — Guardrail",
};

export default async function DashboardPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      subscriptionStatus: true,
      trialEndsAt: true,
      traderProfile: { select: { id: true, timezone: true } },
      telegramConnection: { select: { id: true, telegramUsername: true, connectedAt: true } },
      coachingPreferences: true,
    },
  });
  if (!user) redirect("/login");

  const onboardingComplete = Boolean(user.traderProfile);
  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
  const telegramConnected = Boolean(user.telegramConnection);
  const economicCalendarSelection = getEconomicCalendarSelection(user.coachingPreferences);

  const riskRules = await prisma.riskRules.findUnique({ where: { userId: currentUser.id } });
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
    todayManualTrades,
    commandCenter,
    economicCalendarSnapshot,
  ] = await Promise.all([
    getTodaySessionSummary(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
    getGuardianSnapshot(currentUser.id),
    getTodayGuardianSessionStart(currentUser.id),
    prisma.manualTradeEntry.findMany({
      where: {
        userId: currentUser.id,
        tradedAt: { gte: tradingDay.start, lt: effectiveManualEnd },
      },
      orderBy: { tradedAt: "asc" },
    }),
    loadCommandCenterData(currentUser.id),
    getSelectedEconomicCalendarSnapshot(user.coachingPreferences),
  ]);

  // ── Determine which branch to render ───────────────────────────────────────
  const noAccounts = commandCenter.accounts.length === 0;
  const hasBrokerAccount = commandCenter.accounts.some((a) => a.platform !== "manual");
  const manualOnly = !noAccounts && !hasBrokerAccount;

  // ── Manual-mode computations (only rendered in manualOnly branch) ──────────
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const nextHighImpactEvent = getNextHighImpactEconomicEvent(economicCalendarSnapshot);
  const economicCalendarVisibility = buildEconomicCalendarVisibility({
    snapshot: economicCalendarSnapshot,
    policyStatus: economicCalendarPolicy,
    nextHighImpactEvent,
    timeZone: displayTimeZone,
    scenario: economicCalendarSelection.stubScenario,
  });

  const manualRisk = computeManualRiskState({ rules: riskRules, todayTrades: todayManualTrades });
  const guardianAdditionalRulesCount = Math.max(
    guardian.evaluation.triggeredRuleLabels.length - 1,
    0,
  );

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
  const telegramBotLink = telegramBotUsername ? `https://t.me/${telegramBotUsername}` : null;

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
        !(v.ruleId === "no_trade_before_major_news" && !todaySessionState.sessionStarted),
    ),
    ...violationFeed.triggeredViolations.filter((v) => v.ruleId === "manual_rule_breach"),
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

  return (
    <AppShell
      eyebrow="RISK COMMAND CENTER"
      title="All accounts at a glance."
      description="Status, stop budget, trades used, and connection mode for every account — grouped by prop firm."
      compactHero={noAccounts}
      actions={
        <DashboardActions
          telegramConnected={telegramConnected}
          onboardingComplete={onboardingComplete}
        />
      }
    >
      <div className="grid min-w-0 gap-8">

        {/* ── Auto-sync stale Tradovate accounts in background ─────────────── */}
        {(() => {
          const staleIds = commandCenter.accounts
            .filter((a) => a.platform === "tradovate" && needsSync(a.lastSyncAt))
            .map((a) => a.id);
          return staleIds.length > 0 ? <AutoSync staleAccountIds={staleIds} /> : null;
        })()}

        {/* ── Command center — always shown ─────────────────────────────────── */}
        <div className="grid gap-3">
          <SummaryStrip summary={commandCenter.summary} />
          <CommandCenter data={commandCenter} />
        </div>

        {/* ── State A: No accounts — setup prompt ───────────────────────────── */}
        {noAccounts && (
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              Getting started
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Connect your first trading account.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              Guardrail starts working once it can read account activity. Connect Tradovate to
              monitor daily loss, trades used, account status, and rule breaches.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href="/accounts/connect/tradovate"
                className="rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Connect Tradovate
              </Link>
              <Link
                href="/accounts/new"
                className="rounded-full border border-stone-200 px-5 py-2.5 text-sm font-medium text-stone-500 transition hover:border-stone-400 hover:text-stone-700"
              >
                Create manual demo account
              </Link>
            </div>
            <p className="mt-4 text-xs text-stone-400">
              Manual demo is only for testing rules before connecting a broker.
            </p>
          </section>
        )}

        {/* ── State B: Broker-connected — configuration nav only ────────────── */}
        {hasBrokerAccount && (
          <div className="grid gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
              Configuration
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <NavCard
                href="/rules"
                title="Trading Plan"
                description="Edit daily loss limits, trade caps, and breach actions."
              />
              <NavCard
                href="/accounts"
                title="Broker Connections"
                description="Manage connected accounts, review sync status, and reconnect."
              />
              <NavCard
                href="/alerts"
                title="Alerts"
                description="Configure Telegram notifications for lockouts and warnings."
              />
            </div>
          </div>
        )}

        {/* ── State C: Manual-only — demo mode section ──────────────────────── */}
        {manualOnly && (
          <div className="grid gap-6">
            <div className="rounded-2xl border border-amber-200/60 bg-amber-50/30 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                Manual demo mode
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                You are using manual trade logging without a live broker connection. This mode is
                for testing your rules before connecting Tradovate for broker-connected
                monitoring.{" "}
                <Link
                  href="/accounts/connect/tradovate"
                  className="font-medium text-stone-800 underline-offset-2 hover:underline"
                >
                  Connect Tradovate →
                </Link>
              </p>
            </div>

            <RuleProgressPanel
              todayPnL={todaySessionStateForPanel.todayPnL}
              todayTradesCount={todaySessionStateForPanel.todayTradesCount}
              consecutiveLosses={todaySessionStateForPanel.consecutiveLosses}
              maxDailyLoss={riskRules?.maxDailyLoss ? Number(riskRules.maxDailyLoss) : null}
              maxTradesPerDay={riskRules?.maxTradesPerDay ?? null}
              stopAfterLosses={riskRules?.stopAfterLosses ?? null}
              dailyProfitTarget={
                riskRules?.dailyProfitTarget ? Number(riskRules.dailyProfitTarget) : null
              }
              dataSource="manual"
            />

            <div className="grid gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-400">
                Session state
              </p>
              {showPremarketReadiness ? (
                <PremarketReadinessPanel readiness={premarketReadinessWithEvent!} />
              ) : null}
              {todaySessionState.kind === "GUARDIAN_DISABLED" ? (
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

            <SectionCard
              compact
              title="Log a trade or event"
              description="Manual entry — feeds today's app-level session state."
            >
              <ManualEventForm compact />
            </SectionCard>

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

            <div className="grid gap-3 sm:grid-cols-3">
              <NavCard
                href="/rules"
                title="Trading Plan"
                description="Edit daily limits and breach actions."
              />
              <NavCard
                href="/accounts/connect/tradovate"
                title="Connect Tradovate"
                description="Switch from demo to broker-connected monitoring."
              />
              <NavCard
                href="/alerts"
                title="Alerts"
                description="Configure Telegram notifications."
              />
            </div>
          </div>
        )}

      </div>
    </AppShell>
  );
}

// ── Helper components ──────────────────────────────────────────────────────────

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

function NavCard({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-stone-200 bg-white/90 px-3 py-2 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.08)] transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_10px_28px_-8px_rgba(28,25,23,0.16)] sm:p-5"
    >
      <p className="text-sm font-semibold text-stone-950">{title}</p>
      <p className="mt-1 flex-1 text-xs leading-5 text-stone-500">{description}</p>
      <p className="mt-2 text-xs font-semibold text-stone-400 transition-colors group-hover:text-stone-700 sm:mt-4">
        →
      </p>
    </Link>
  );
}
