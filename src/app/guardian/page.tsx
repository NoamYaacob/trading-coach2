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
        label: "Guardian off",
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

  const [
    guardian,
    user,
    todayGuardianSessionStart,
    todaySessionEvents,
    liveEnforcement,
    riskRules,
    brokerCount,
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
    getLiveEnforcementState(currentUser.id),
    prisma.riskRules.findUnique({ where: { userId: currentUser.id } }),
    prisma.connectedAccount.count({ where: { userId: currentUser.id, isActive: true } }),
  ]);

  const cookieStore = await cookies();
  const displayTimeZone = resolveDisplayTimeZone({
    onboardingTimeZone: user?.traderProfile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });
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
  const isLocked =
    guardian.evaluation.lockoutActive ||
    liveEnforcement?.riskState === "STOPPED";
  const hasWarnings =
    violationFeed.warningViolations.length > 0 ||
    (liveEnforcement &&
      ["soft_warning", "hard_warning", "cooldown"].includes(liveEnforcement.tier));

  const permission: Permission = guardianOff
    ? "GUARDIAN_OFF"
    : isLocked
      ? "LOCKED"
      : hasWarnings
        ? "WARNING"
        : "SAFE";

  const styles = permissionStyles(permission);

  const headline = guardianOff
    ? "Guardian is off — no rules are enforcing."
    : isLocked
      ? "Trading is locked for today."
      : hasWarnings
        ? "Trading is open — limits are close."
        : "Trading is open. All limits clear.";

  const detail = guardianOff
    ? "Turn Guardian back on to resume rule enforcement."
    : isLocked
      ? guardian.evaluation.primaryReasonLabel
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
      label: "Session hours (UTC)",
      value: `${riskRules.sessionStartHour}:00 – ${riskRules.sessionEndHour}:00`,
    });
  }
  if (riskRules?.tradingDays) activeRules.push({ label: "Trading days", value: riskRules.tradingDays });
  if (riskRules?.newsLockoutEnabled) activeRules.push({ label: "News lockout", value: "Enabled" });

  // On-breach actions configured by the user
  const breachActions: Array<{ label: string; available: boolean; on: boolean }> = [
    { label: "Warn (in-app + Telegram)", available: true, on: riskRules?.onBreachWarn ?? true },
    { label: "Lock trading for the day (app-level)", available: true, on: riskRules?.onBreachAppLock ?? true },
    { label: "Cancel open orders (broker)", available: false, on: riskRules?.onBreachCancelOrders ?? false },
    { label: "Flatten positions (kill switch)", available: false, on: riskRules?.onBreachFlatten ?? false },
  ];

  return (
    <AppShell
      eyebrow="Guardian · Enforcement"
      title="Trading permission."
      description="The current permission state, active rules, and what happens on breach. Edit limits in Rules."
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

        {/* ── Permission hero — answers Safe / Warning / Locked ─────────── */}
        <section className={`rounded-[2rem] border px-6 py-6 shadow-[0_24px_70px_-50px_rgba(28,25,23,0.4)] ${styles.shell}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${styles.chip}`}>
              {styles.label}
            </span>
            <span className="text-xs text-stone-500">
              {hasBroker ? "Broker connected · App-level enforcement" : "Manual mode · App-level enforcement"}
            </span>
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-stone-950">{headline}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">{detail}</p>

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

        {/* ── Rule progress today ─────────────────────────────────────────── */}
        <SectionCard
          title="Rule progress today"
          description="Live numbers vs. configured limits."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <ProgressTile
              label="P&L today"
              value={`$${guardian.evaluation.todayPnL}`}
              limit={maxDailyLoss != null ? `Limit: −$${maxDailyLoss}` : "No limit set"}
            />
            <ProgressTile
              label="Trades"
              value={String(guardian.evaluation.todayTradesCount)}
              limit={maxTradesPerDay != null ? `${maxTradesPerDay} max` : "No limit set"}
            />
            <ProgressTile
              label="Loss streak"
              value={String(guardian.evaluation.consecutiveLosses)}
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

        {/* ── On-breach behaviour ─────────────────────────────────────────── */}
        <SectionCard
          title="On breach"
          description="What Guardrail does when a rule is crossed."
        >
          <div className="grid gap-2">
            {breachActions.map(({ label, available, on }) => (
              <div
                key={label}
                className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 ${
                  available ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-70"
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-stone-950">{label}</p>
                  {!available && (
                    <p className="mt-0.5 text-xs text-stone-500">
                      Requires broker integration. Not yet implemented.
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    !available
                      ? "bg-stone-200 text-stone-600"
                      : on
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {!available ? "Coming soon" : on ? "On" : "Off"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-stone-400">
            Manual mode helps you follow your rules inside this app — Guardrail tracks, warns, and locks the session. Broker-level enforcement (cancel orders, flatten positions) requires a future broker integration phase.
          </p>
        </SectionCard>

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
