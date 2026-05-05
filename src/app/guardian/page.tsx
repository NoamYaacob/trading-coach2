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
import { getTradingDayWindow } from "@/lib/trading-day";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { getTodaySessionEvents } from "@/lib/session-log";
import {
  getSelectedEconomicCalendarSnapshot,
  getCurrentPreNewsPolicy,
} from "@/lib/economic-calendar";
import {
  buildTodayActivityTimeline,
  getRecentTodayActivityItems,
} from "@/lib/today-activity";
import {
  DISPLAY_TIME_ZONE_COOKIE,
  resolveDisplayTimeZone,
  isValidTimeZone,
} from "@/lib/timezone";

export const metadata: Metadata = {
  title: "Status details — Guardrail",
};

type Permission = "SAFE" | "WARNING" | "LOCKED" | "GUARDIAN_OFF" | "READ_ONLY";

// Maps common IANA zones to trader-friendly location names.
const TZ_CITY: Record<string, string> = {
  "America/New_York":    "New York",
  "America/Chicago":     "Chicago",
  "America/Denver":      "Denver",
  "America/Los_Angeles": "Los Angeles",
  "America/Toronto":     "Toronto",
  "America/Sao_Paulo":   "São Paulo",
  "Europe/London":       "London",
  "Europe/Berlin":       "Frankfurt",
  "Europe/Paris":        "Paris",
  "Europe/Amsterdam":    "Amsterdam",
  "Europe/Madrid":       "Madrid",
  "Europe/Rome":         "Rome",
  "Europe/Zurich":       "Zurich",
  "Asia/Jerusalem":      "Israel",
  "Asia/Dubai":          "Dubai",
  "Asia/Kolkata":        "India",
  "Asia/Bangkok":        "Bangkok",
  "Asia/Shanghai":       "China",
  "Asia/Hong_Kong":      "Hong Kong",
  "Asia/Singapore":      "Singapore",
  "Asia/Seoul":          "Seoul",
  "Asia/Tokyo":          "Tokyo",
  "Australia/Sydney":    "Sydney",
};

function tzLabel(tz: string, hasSavedTz: boolean): string {
  if (!hasSavedTz) return "session";
  return TZ_CITY[tz] ?? new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value ?? tz;
}

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
    case "READ_ONLY":
      return {
        shell: "border-stone-200 bg-stone-50/80",
        chip: "bg-stone-500 text-white",
        accent: "text-stone-600",
        label: "Read-only",
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
  // before fetching today's session data.
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
  // True only when the user explicitly saved a timezone in their profile.
  // Used to decide between "Israel time" and "session time" in UI labels.
  const hasSavedTimezone = isValidTimeZone(user?.traderProfile?.timezone ?? null);

  const tradingDay = getTradingDayWindow({
    timezone: displayTimeZone,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });

  const fmtHHMM = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: displayTimeZone,
    }).format(d);
  const tz = tzLabel(displayTimeZone, hasSavedTimezone);
  // Value shown next to the "Protected session" pill key — no prefix repetition.
  const sessionWindowLabel = tradingDay.hasSessionHours
    ? `${fmtHHMM(tradingDay.start)}–${fmtHHMM(tradingDay.end)} ${tz} time`
    : "Not configured";
  // Compact version for mobile status strip
  const shortTradingDay = tradingDay.hasSessionHours
    ? `${fmtHHMM(tradingDay.start)}–${fmtHHMM(tradingDay.end)} ${tz} time`
    : "No session hours";

  const [
    guardian,
    todayGuardianSessionStart,
    todaySessionEvents,
    liveEnforcement,
    connectedAccounts,
  ] = await Promise.all([
    getGuardianSnapshot(currentUser.id),
    getTodayGuardianSessionStart(currentUser.id),
    getTodaySessionEvents(currentUser.id, undefined, "asc"),
    getLiveEnforcementState(currentUser.id),
    prisma.connectedAccount.findMany({
      where: { userId: currentUser.id, isActive: true },
      select: { connectionStatus: true },
    }),
  ]);

  const economicCalendarSnapshot = await getSelectedEconomicCalendarSnapshot(
    user?.coachingPreferences,
  );
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const onboardingComplete = Boolean(user?.traderProfile);

  const sessionStarted = Boolean(todayGuardianSessionStart);
  const sessionEnded = Boolean(todayGuardianSessionStart?.endedAt);

  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete,
    sessionStart: todayGuardianSessionStart,
    preNewsPolicyStatus: economicCalendarPolicy,
  });
  const violationFeed = buildViolationFeed(
    buildRuleEngineInputFromGuardianSnapshot(guardian, {
      sessionStarted,
      sessionEnded,
      todaySessionStateKind: todaySessionState.kind,
      preNewsPolicy: economicCalendarPolicy.isActive
        ? {
            isActive: economicCalendarPolicy.isActive,
            mode: economicCalendarPolicy.policy.mode,
            message: economicCalendarPolicy.message,
          }
        : null,
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

  const hasBroker = connectedAccounts.length > 0;
  // "connected_live" accounts receive webhook events and can trigger broker autoLiq rules.
  // All other statuses are read-only monitoring only.
  const hasLiveConnection = connectedAccounts.some(
    (a) => a.connectionStatus === "connected_live",
  );
  const brokerSourceLabel = !hasBroker
    ? "No broker connected"
    : hasLiveConnection
      ? "Partial broker enforcement available"
      : "Read-only monitoring";
  const guardianOff = !guardian.evaluation.guardianActive;
  const isLocked =
    guardian.evaluation.lockoutActive ||
    liveEnforcement?.riskState === "STOPPED";

  // session_not_started is a session lifecycle notice, not a rule threshold warning.
  // Filter it out before computing hasWarnings so it doesn't show "Trading is open — limits
  // are close" when the only "warning" is that the session hasn't started yet.
  const ruleWarnings = violationFeed.warningViolations.filter(
    (v) => v.ruleType !== "session_not_started",
  );
  const hasWarnings =
    ruleWarnings.length > 0 ||
    (liveEnforcement != null &&
      ["soft_warning", "hard_warning", "cooldown"].includes(liveEnforcement.tier));

  // READ_ONLY: broker connected but no live enforcement — monitoring only, nothing broken.
  const isReadOnly = hasBroker && !hasLiveConnection;
  const permission: Permission = guardianOff
    ? "GUARDIAN_OFF"
    : isLocked
      ? "LOCKED"
      : hasWarnings
        ? "WARNING"
        : isReadOnly
          ? "READ_ONLY"
          : "SAFE";

  const styles = permissionStyles(permission);

  // Do not say "Trading is open" when the protected session hasn't started.
  const headline = guardianOff
    ? "Guardian is paused."
    : isLocked
      ? "Trading is locked for today."
      : !sessionStarted && !sessionEnded
        ? "Protected session has not started yet."
        : hasWarnings
          ? "Trading is open — limits are close."
          : permission === "READ_ONLY"
            ? "Trading is open. Read-only monitoring active."
            : "Trading is open. All limits clear.";

  const detail = guardianOff
    ? "Your rules are saved, but Guardian is not actively monitoring the session."
    : isLocked
      ? guardian.evaluation.primaryReasonLabel ?? "A daily limit was reached."
      : !sessionStarted && !sessionEnded
        ? "Rule progress and warnings will appear once broker events begin syncing."
        : hasWarnings
          ? "One or more rules are approaching their thresholds. Review the warnings below before continuing."
          : permission === "READ_ONLY"
            ? "Guardian is monitoring via a read-only broker connection. No rule thresholds have been reached. Broker-level enforcement is not active for this connection type."
            : "No rule limits have been hit. Guardian is monitoring every trade event.";

  const triggeredLabels = guardian.evaluation.triggeredRuleLabels;

  const maxDailyLoss = riskRules?.maxDailyLoss ?? guardian.profile.maxDailyLoss;
  const maxTradesPerDay = riskRules?.maxTradesPerDay ?? guardian.profile.maxTradesPerDay;
  const stopAfterLosses =
    riskRules?.stopAfterLosses ?? guardian.profile.stopAfterConsecutiveLosses;

  // On-breach actions configured by the user.
  const breachActions: Array<{ label: string; note?: string; available: boolean; on: boolean }> = [
    { label: "Send warning", available: true, on: riskRules?.onBreachWarn ?? true },
    {
      label: "Mark account locked in Guardrail",
      // Show read-only scope note only when the connection is read-only.
      note: isReadOnly
        ? "Guardian status only — does not block orders placed directly in Tradovate."
        : undefined,
      available: true,
      on: riskRules?.onBreachAppLock ?? true,
    },
    { label: "Cancel broker orders", available: false, on: riskRules?.onBreachCancelOrders ?? false },
    { label: "Flatten broker positions", available: false, on: riskRules?.onBreachFlatten ?? false },
  ];

  return (
    <AppShell
      eyebrow="Status details · Secondary view"
      title="Why am I allowed, warned, or locked?"
      description="Guardrail monitors your connected broker accounts for rule violations. Enforcement scope depends on your account connection type — read-only connections are monitored and alerted but cannot trigger broker-level blocking."
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
        {/* Mobile: 2-row compact */}
        <div className="rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)] md:hidden">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${guardianOff ? "bg-stone-400" : "bg-emerald-500"}`}
                aria-hidden="true"
              />
              <span className="font-medium text-stone-600">Guardian</span>
              <span className={guardianOff ? "text-stone-400" : "text-emerald-700 font-semibold"}>
                {guardianOff ? "Paused" : "On"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-medium text-stone-600">Permission</span>
              <span className={`font-semibold ${styles.accent}`}>{styles.label}</span>
            </span>
          </div>
          <p className="mt-1.5 text-xs text-stone-500">{shortTradingDay}</p>
        </div>
        {/* Desktop: full pill strip */}
        <div className="hidden md:flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-stone-200 bg-white/90 px-5 py-3 text-xs shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)]">
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
            <span className="font-medium text-stone-600">Enforcement</span>
            <span className="text-stone-700">{brokerSourceLabel}</span>
          </span>
          <span className="h-3 w-px bg-stone-200" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-600">Permission</span>
            <span className={`font-semibold ${styles.accent}`}>{styles.label}</span>
          </span>
          <span className="h-3 w-px bg-stone-200" aria-hidden="true" />
          <span className="flex items-center gap-2">
            <span className="font-medium text-stone-600">Protected session</span>
            <span className="text-stone-700">{sessionWindowLabel}</span>
          </span>
        </div>

        {/* ── Permission hero ─────────────────────────────────────────────── */}
        <section className={`rounded-[2rem] border px-6 py-6 shadow-[0_24px_70px_-50px_rgba(28,25,23,0.4)] ${styles.shell}`}>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${styles.chip}`}>
              {styles.label}
            </span>
            <span className="text-xs text-stone-500">
              {hasBroker ? "Broker connected" : "No broker connected"}
            </span>
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-stone-950">{headline}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700">{detail}</p>

          {!hasBroker && (
            <div className="mt-5">
              <Link
                href="/accounts/connect/tradovate"
                className="inline-flex rounded-full border border-stone-400 bg-white px-5 py-2.5 text-sm font-medium text-stone-950 transition hover:bg-stone-50"
              >
                Connect Tradovate →
              </Link>
            </div>
          )}

          {guardianOff && (
            <div className="mt-5">
              <Link
                href="/rules#guardian-toggle"
                className="inline-flex rounded-full border border-stone-400 bg-white px-5 py-2.5 text-sm font-medium text-stone-950 transition hover:bg-stone-50"
              >
                Enable protection →
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

        {/* ── No-broker notice ────────────────────────────────────────────── */}
        {!hasBroker && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold">Guardrail monitoring is not active.</p>
            <p className="mt-1 text-amber-800">
              No broker account is connected. Connect Tradovate to activate live rule
              monitoring and enforcement.
            </p>
            <Link
              href="/accounts/connect/tradovate"
              className="mt-3 inline-flex rounded-full bg-amber-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-800"
            >
              Connect Tradovate →
            </Link>
          </div>
        )}

        {/* ── Session status ──────────────────────────────────────────────── */}
        {/* Shown when the session hasn't started — separate from rule warnings. */}
        {!sessionStarted && !sessionEnded && hasBroker && (
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Session status
            </p>
            <p className="mt-2 text-sm font-medium text-stone-800">
              Protected session has not started.
            </p>
            <p className="mt-1 text-sm text-stone-500">
              No broker trade events have been received for today's session. Rule progress
              and warnings will appear once syncing begins.
            </p>
          </div>
        )}

        {/* ── Rule progress today ─────────────────────────────────────────── */}
        {sessionStarted ? (
          <SectionCard
            title="Rule progress today"
            description={hasBroker ? "Live numbers from broker events vs. configured limits." : "No broker data — connect an account to see live rule progress."}
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
        ) : (
          <SectionCard
            title="Rule progress today"
            description="No broker data received for this session yet."
          >
            <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-5 text-sm text-stone-500">
              <p className="font-medium text-stone-700">No rule progress yet.</p>
              <p className="mt-1">
                Progress appears once the protected session starts and broker events are received.
              </p>
            </div>
          </SectionCard>
        )}

        {/* ── Active warnings (rule thresholds only) ──────────────────────── */}
        {/* session_not_started is shown in "Session status" above, not here. */}
        {ruleWarnings.length > 0 && (
          <SectionCard
            title="Active warnings"
            description="Rules approaching their thresholds."
          >
            <ul className="grid gap-2">
              {ruleWarnings.map((v) => (
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

        {/* ── Recent breaches / session events ────────────────────────────── */}
        {/* TODO: Future intervention feed should display account-level context per event:
            account name/number, prop firm, broker connection ID / user ID, trigger rule,
            attempted action (warn / app-lock / cancel-orders / flatten), result
            (broker_locked | monitoring_only | broker_lock_failed), and timestamp.
            Pull from LiveSessionState + ConnectedAccount joined on brokerConnectionId. */}
        <RecentSessionEvents items={recentSessionEvents} timeZone={displayTimeZone} />

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
            {breachActions.map(({ label, note, available, on }) => (
              <div
                key={label}
                className={`rounded-xl border px-4 py-3 ${
                  available ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
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
                    {!available ? "Not active · requires write permissions" : on ? "On" : "Off"}
                  </span>
                </div>
                {note && (
                  <p className="mt-1.5 text-xs text-stone-500">{note}</p>
                )}
              </div>
            ))}
            <p className="mt-1 text-xs text-stone-500">
              Broker order cancel/flatten requires a verified broker connection with order-write
              permissions. Read-only connections support account-level monitoring and alerts only.
            </p>
          </div>
        </details>

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
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-3 sm:px-4 sm:py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <p className="mt-1.5 text-lg font-semibold text-stone-950 tabular-nums sm:mt-2">{value}</p>
      <p className="mt-0.5 text-sm text-stone-500 sm:mt-1">{limit}</p>
    </div>
  );
}
