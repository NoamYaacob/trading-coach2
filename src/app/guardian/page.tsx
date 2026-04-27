import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { RecentSessionEvents } from "@/app/guardian/_components/recent-session-events";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getGuardianSnapshot,
  getTodayGuardianSessionStart,
  deriveTodaySessionState,
} from "@/lib/guardian";
import { getLiveEnforcementState } from "@/lib/live-enforcement-state";
import { ManualRiskPanel } from "@/components/ui/manual-risk-panel";
import { computeManualRiskState } from "@/lib/manual-risk-state";
import { getTradingDayWindow } from "@/lib/trading-day";
import { deriveManualEventSignals } from "@/lib/manual-trade-events";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { getTodaySessionEvents } from "@/lib/session-log";
import {
  getSelectedEconomicCalendarSnapshot,
  getCurrentPreNewsPolicy,
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
  title: "Guardian — Guardrail",
};

type Permission = "SAFE" | "WARNING" | "LOCKED" | "GUARDIAN_OFF";

function permissionStyles(p: Permission) {
  switch (p) {
    case "LOCKED":
      return {
        shell: "border-red-300 bg-red-50",
        chip: "bg-red-600 text-white",
        accent: "text-red-700",
        label: "Locked",
      };
    case "WARNING":
      return {
        shell: "border-amber-300 bg-amber-50",
        chip: "bg-amber-500 text-white",
        accent: "text-amber-700",
        label: "Warning",
      };
    case "GUARDIAN_OFF":
      return {
        shell: "border-stone-300 bg-stone-50",
        chip: "bg-stone-600 text-white",
        accent: "text-stone-700",
        label: "Paused",
      };
    default:
      return {
        shell: "border-emerald-200 bg-emerald-50",
        chip: "bg-emerald-600 text-white",
        accent: "text-emerald-700",
        label: "Safe",
      };
  }
}

export default async function GuardianPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  // Resolve user + risk rules first so we can compute the trading-day window
  // before fetching today's manual trades.
  const [user, riskRules] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        traderProfile: { select: { id: true, timezone: true } },
        coachingPreferences: true,
      },
    }),
    prisma.riskRules.findUnique({ where: { userId: currentUser.id } }),
  ]);
  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user?.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
  const tradingDay = getTradingDayWindow({
    timezone: displayTimeZone,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });

  const [
    guardian,
    todayGuardianSessionStart,
    todaySessionEvents,
    liveEnforcement,
    brokerCount,
    todayManualTrades,
  ] = await Promise.all([
    getGuardianSnapshot(currentUser.id),
    getTodayGuardianSessionStart(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
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
  const manualRisk = computeManualRiskState({ rules: riskRules, todayTrades: todayManualTrades });

  const economicCalendarSelection = getEconomicCalendarSelection(user?.coachingPreferences);
  const economicCalendarSnapshot = await getSelectedEconomicCalendarSnapshot(
    user?.coachingPreferences,
  );
  void economicCalendarSelection;
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const onboardingComplete = Boolean(user?.traderProfile);
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

  const recentSessionEvents = getRecentTodayActivityItems(
    buildTodayActivityTimeline({
      sessionStart: todayGuardianSessionStart,
      guardian,
      sessionEvents: todaySessionEvents,
    }),
    5,
  );

  const hasBroker = brokerCount > 0;
  const guardianOff = !guardian.evaluation.guardianActive;
  // Manual-mode breach state contributes to the Guardian permission verdict.
  const manualLocked = manualRisk.permission === "LOCKED";
  const manualWarning = manualRisk.permission === "WARNING";
  const isLocked =
    guardian.evaluation.lockoutActive ||
    liveEnforcement?.riskState === "STOPPED" ||
    (!hasBroker && manualLocked);
  const hasWarnings =
    violationFeed.warningViolations.length > 0 ||
    (liveEnforcement &&
      ["soft_warning", "hard_warning", "cooldown"].includes(liveEnforcement.tier)) ||
    (!hasBroker && manualWarning);

  const permission: Permission = guardianOff
    ? "GUARDIAN_OFF"
    : isLocked
      ? "LOCKED"
      : hasWarnings
        ? "WARNING"
        : "SAFE";

  const styles = permissionStyles(permission);

  const headline = guardianOff
    ? "Guardian is paused."
    : isLocked
      ? "Trading is locked for today."
      : hasWarnings
        ? "Trading is open — limits are close."
        : "Trading is open. All limits clear.";

  const detail = guardianOff
    ? "Your rules are saved, but Guardian is not actively monitoring the session."
    : isLocked
      ? !hasBroker && manualLocked
        ? manualRisk.lastBreach?.detail ?? "A daily limit was reached based on your journal entries."
        : guardian.evaluation.primaryReasonLabel
      : hasWarnings
        ? "One or more rules are approaching their thresholds. Review the warnings below before continuing."
        : "No rule limits have been hit. Guardian is monitoring every trade event.";

  const triggeredLabels = guardian.evaluation.triggeredRuleLabels;

  // Active rules summary derived from RiskRules (preferred) with GuardianProfile fallback.
  const activeRules: Array<{ label: string; value: string }> = [];
  const maxDailyLoss = riskRules?.maxDailyLoss ?? guardian.profile.maxDailyLoss;
  const maxTradesPerDay = riskRules?.maxTradesPerDay ?? guardian.profile.maxTradesPerDay;
  const stopAfterLosses =
    riskRules?.stopAfterLosses ?? guardian.profile.stopAfterConsecutiveLosses;
  const dailyProfitTarget =
    riskRules?.dailyProfitTarget ?? guardian.profile.dailyProfitTarget;

  if (maxDailyLoss != null) activeRules.push({ label: "Daily loss limit", value: `$${maxDailyLoss}` });
  if (dailyProfitTarget != null) activeRules.push({ label: "Daily profit target", value: `$${dailyProfitTarget}` });
  if (riskRules?.maxRiskPerTrade != null) activeRules.push({ label: "Max risk per trade", value: `$${riskRules.maxRiskPerTrade}` });
  if (maxTradesPerDay != null) activeRules.push({ label: "Max trades per day", value: String(maxTradesPerDay) });
  if (stopAfterLosses != null) activeRules.push({ label: "Stop after losses", value: String(stopAfterLosses) });
  if (riskRules?.maxContracts != null) activeRules.push({ label: "Max contracts", value: String(riskRules.maxContracts) });
  if (riskRules?.allowedSymbols) activeRules.push({ label: "Allowed symbols", value: riskRules.allowedSymbols });
  if (riskRules?.sessionStartHour != null && riskRules?.sessionEndHour != null) {
    activeRules.push({
      label: "Session hours",
      value: `${riskRules.sessionStartHour}:00 – ${riskRules.sessionEndHour}:00 ${displayTimeZone}`,
    });
  }
  if (riskRules?.tradingDays) activeRules.push({ label: "Trading days", value: riskRules.tradingDays });
  if (riskRules?.newsLockoutEnabled) activeRules.push({ label: "News lockout", value: "Enabled" });

  // On-breach actions configured by the user
  const breachActions: Array<{ label: string; available: boolean; on: boolean }> = [
    { label: "Warn (in-app + Telegram)", available: true, on: riskRules?.onBreachWarn ?? true },
    { label: "Lock trading for the day (app-level)", available: true, on: riskRules?.onBreachAppLock ?? true },
    { label: "Cancel broker orders", available: false, on: riskRules?.onBreachCancelOrders ?? false },
    { label: "Flatten broker positions", available: false, on: riskRules?.onBreachFlatten ?? false },
  ];

  return (
    <AppShell
      eyebrow="Guardian · Enforcement"
      title="Why am I allowed, warned, or locked?"
      description="Your current trading permission and the rule that caused it."
      actions={
        <Link
          href="/rules"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Edit rules
        </Link>
      }
    >
      <div className="grid gap-6">

        {/* ── Compact status summary strip ────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-stone-200 bg-white/90 px-5 py-3 text-xs shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)]">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${guardianOff ? "bg-stone-400" : "bg-emerald-500"}`}
              aria-hidden="true"
            />
            <span className="font-medium text-stone-600">Guardian</span>
            <span className={guardianOff ? "text-stone-400" : "text-emerald-700 font-semibold"}>
              {guardianOff ? "Paused" : "On"}
            </span>
          </span>
          <span className="h-3 w-px bg-stone-200" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-600">Source</span>
            <span className="text-stone-700">{hasBroker ? "Broker connection" : "Manual fallback"}</span>
          </span>
          <span className="h-3 w-px bg-stone-200" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-600">Permission</span>
            <span className={`font-semibold ${styles.accent}`}>{styles.label}</span>
          </span>
          <span className="hidden h-3 w-px bg-stone-200 sm:block" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-600">Trading day</span>
            <span className="text-stone-700">{tradingDay.label}</span>
          </span>
        </div>

        {/* ── Permission hero ─────────────────────────────────────────────── */}
        {!hasBroker && !guardianOff ? (
          <ManualRiskPanel
            state={manualRisk}
            hasRules={Boolean(riskRules)}
            hideEditRulesCta
            tradingDayLabel={tradingDay.label}
          />
        ) : (
          <section className={`rounded-[2rem] border px-6 py-6 shadow-[0_24px_70px_-50px_rgba(28,25,23,0.4)] ${styles.shell}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${styles.chip}`}>
                {styles.label}
              </span>
              <span className="text-xs text-stone-500">
                {hasBroker ? "Broker connected" : "Manual fallback"}
              </span>
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-stone-950">{headline}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">{detail}</p>

            {guardianOff && (
              <div className="mt-5">
                <Link
                  href="/rules#guardian-toggle"
                  className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Enable Guardian
                </Link>
              </div>
            )}

            {triggeredLabels.length > 0 && (
              <div className="mt-5 grid gap-1 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm">
                <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${styles.accent}`}>
                  Triggered
                </p>
                <ul className="grid gap-0.5 text-stone-800">
                  {triggeredLabels.map((label) => (
                    <li key={label}>• {label}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ── Rule progress today ─────────────────────────────────────────── */}
        <SectionCard
          title="Rule progress today"
          description={hasBroker ? "Live numbers vs. configured limits." : "Calculated from journal entries dated today."}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <ProgressTile
              label="P&L today"
              value={hasBroker ? `$${guardian.evaluation.todayPnL}` : `${manualRisk.todayPnL >= 0 ? "+" : "−"}$${Math.abs(manualRisk.todayPnL).toFixed(2)}`}
              limit={maxDailyLoss != null ? `Limit: −$${maxDailyLoss}` : "No limit set"}
            />
            <ProgressTile
              label="Trades"
              value={String(hasBroker ? guardian.evaluation.todayTradesCount : manualRisk.todayTradesCount)}
              limit={maxTradesPerDay != null ? `${maxTradesPerDay} max` : "No limit set"}
            />
            <ProgressTile
              label="Loss streak"
              value={String(hasBroker ? guardian.evaluation.consecutiveLosses : manualRisk.consecutiveLosses)}
              limit={stopAfterLosses != null ? `Stop after ${stopAfterLosses}` : "No limit set"}
            />
          </div>
        </SectionCard>

        {/* ── Warnings (if any) ───────────────────────────────────────────── */}
        {violationFeed.warningViolations.length > 0 && (
          <SectionCard
            title="Active warnings"
            description="Rules approaching their thresholds."
          >
            <ul className="grid gap-2">
              {violationFeed.warningViolations.map((v) => (
                <li
                  key={v.ruleId + v.message}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800"
                >
                  <p className="font-medium text-amber-900">
                    {v.ruleId.replaceAll("_", " ")}
                  </p>
                  <p className="mt-0.5 text-stone-700">{v.message}</p>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* ── Recent manual breaches ──────────────────────────────────────── */}
        {todayManualTrades.some((t) => t.ruleBreached) && (
          <SectionCard
            title="Recent manual breaches"
            description="Trades you marked as rule breaches in today's journal."
          >
            <ul className="grid gap-2">
              {todayManualTrades
                .filter((t) => t.ruleBreached)
                .slice(-5)
                .reverse()
                .map((t) => (
                  <li
                    key={t.id}
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-stone-800"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-red-900">
                        {t.symbol} · {t.direction}
                      </p>
                      <p className="font-mono text-xs text-stone-500">
                        {new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(t.tradedAt)}
                      </p>
                    </div>
                    {t.breachReason && (
                      <p className="mt-1 text-stone-700">{t.breachReason}</p>
                    )}
                  </li>
                ))}
            </ul>
          </SectionCard>
        )}

        {/* ── Active rules ────────────────────────────────────────────────── */}
        <SectionCard
          title="Active rules"
          description="The limits Guardrail is currently enforcing. Edit in the Rules page."
        >
          {activeRules.length > 0 ? (
            <div className="divide-y divide-stone-100">
              {activeRules.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-stone-600">{label}</span>
                  <span className="font-medium text-stone-950">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              No rules configured yet.{" "}
              <Link href="/rules" className="font-medium text-stone-950 underline-offset-2 hover:underline">
                Set your protection rules →
              </Link>
            </p>
          )}
        </SectionCard>

        {/* ── How enforcement works (collapsible details) ─────────────────── */}
        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            How enforcement works
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-5 grid gap-3">
            <p className="text-sm text-stone-600">
              When a rule is crossed, Guardrail does the following:
            </p>
            {breachActions.map(({ label, available, on }) => (
              <div
                key={label}
                className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${
                  available ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-70"
                }`}
              >
                <p className="text-sm font-medium text-stone-950">{label}</p>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    !available
                      ? "bg-stone-200 text-stone-600"
                      : on
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {!available ? "Pending broker" : on ? "On" : "Off"}
                </span>
              </div>
            ))}
            <p className="mt-1 text-xs text-stone-500">
              Broker order cancel/flatten requires a verified broker connection.
            </p>
          </div>
        </details>

        {/* ── Recent breaches / session events ────────────────────────────── */}
        <RecentSessionEvents items={recentSessionEvents} timeZone={displayTimeZone} />

      </div>
    </AppShell>
  );
}

function ProgressTile({
  label,
  value,
  limit,
}: {
  label: string;
  value: string;
  limit: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-stone-950 tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-stone-500">{limit}</p>
    </div>
  );
}
