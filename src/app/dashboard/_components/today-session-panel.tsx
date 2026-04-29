"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type LiveSummary = { todayTradesCount: number; todayPnL: number; consecutiveLosses: number };

import type { TodaySessionState } from "@/lib/guardian";
import type { TelegramDashboardState } from "@/lib/telegram-access";

type TodaySessionPanelProps = {
  sessionState: TodaySessionState;
  additionalTriggeredRulesCount: number;
  telegramAccess: {
    accessActive: boolean;
    dashboardState: TelegramDashboardState;
  };
  telegramBotLink: string | null;
  displayTimeZone: string;
  /** Mobile-only compact stats from ManualRiskPanel, shown when that panel is hidden below md. */
  mobileStats?: {
    todayPnL: number;
    todayTradesCount: number;
    remainingDailyLossBudget: number | null;
    consecutiveLosses: number;
  };
};

function fmtShortTime(value: Date | null, timeZone: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function fmtMoney(n: number): string {
  return `${n >= 0 ? "" : "−"}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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

function getPanelStyles(kind: TodaySessionState["kind"]) {
  switch (kind) {
    case "ONBOARDING_REQUIRED":
      return {
        shell: "border-blue-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-blue-600 text-white",
        accent: "text-blue-700",
      };
    case "READY_TO_TRADE":
      return {
        shell: "border-emerald-200 bg-[linear-gradient(135deg,rgba(236,253,245,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-emerald-600 text-white",
        accent: "text-emerald-700",
      };
    case "GUARDIAN_DISABLED":
      return {
        shell: "border-amber-200 bg-[linear-gradient(135deg,rgba(255,247,237,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-amber-500 text-white",
        accent: "text-amber-700",
      };
    case "RESET_PENDING":
      return {
        shell: "border-red-200 bg-[linear-gradient(135deg,rgba(254,242,242,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-red-600 text-white",
        accent: "text-red-700",
      };
    default:
      return {
        shell: "border-red-200 bg-[linear-gradient(135deg,rgba(254,242,242,0.98),rgba(255,255,255,0.95))]",
        chip: "bg-red-700 text-white",
        accent: "text-red-700",
      };
  }
}

export function TodaySessionPanel({
  sessionState,
  additionalTriggeredRulesCount,
  telegramAccess,
  telegramBotLink,
  displayTimeZone,
  mobileStats,
}: TodaySessionPanelProps) {
  const router = useRouter();
  const [liveSummary, setLiveSummary] = useState<LiveSummary | null>(null);

  useEffect(() => {
    function handleUpdate(e: Event) {
      setLiveSummary((e as CustomEvent<LiveSummary>).detail);
    }
    window.addEventListener("session-summary-update", handleUpdate);
    return () => window.removeEventListener("session-summary-update", handleUpdate);
  }, []);

  const todayTradesCount = liveSummary?.todayTradesCount ?? sessionState.todayTradesCount;
  const todayPnL = liveSummary?.todayPnL ?? sessionState.todayPnL;
  const consecutiveLosses = liveSummary?.consecutiveLosses ?? sessionState.consecutiveLosses;

  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const styles = getPanelStyles(sessionState.kind);
  const isSessionActive =
    sessionState.kind === "READY_TO_TRADE" &&
    sessionState.sessionStarted &&
    !sessionState.sessionEnded;
  const isSessionEnded =
    sessionState.kind === "READY_TO_TRADE" && sessionState.sessionEnded;
  const canOpenTelegram =
    isSessionActive &&
    telegramAccess.dashboardState === "connected" &&
    telegramBotLink;
  const canConnectTelegram =
    isSessionActive && telegramAccess.dashboardState === "not_connected";
  const preNewsPolicyStatus = sessionState.preNewsPolicyStatus;
  const isPreNewsStartBlocked =
    Boolean(preNewsPolicyStatus?.isActive) &&
    preNewsPolicyStatus?.policy.mode === "HARD_BLOCK_MAJOR";
  const isPreNewsCaution =
    Boolean(preNewsPolicyStatus?.isActive) &&
    preNewsPolicyStatus?.policy.mode === "SOFT_CAUTION";
  const cta =
    sessionState.kind === "ONBOARDING_REQUIRED"
      ? { label: "Continue setup →", href: "/onboarding" }
      : sessionState.kind === "READY_TO_TRADE" && !sessionState.sessionStarted
        ? isPreNewsStartBlocked
          ? { label: "Review status", href: "/guardian" }
          : isPreNewsCaution
            ? { label: "Start session with caution", href: "/guardian" }
            : { label: "Start session", href: "/guardian" }
        : sessionState.kind === "GUARDIAN_DISABLED"
          ? { label: "Enable protection", href: "/rules#guardian-toggle" }
          : { label: "Open Guardian", href: "/guardian" };
  const resetText =
    sessionState.resetMode === "DAILY"
      ? formatGuardianDate(sessionState.nextResetAt, displayTimeZone)
      : "Manual reset required";

  const [isConnectingTelegram, setIsConnectingTelegram] = useState(false);

  async function handleConnectTelegram() {
    setIsConnectingTelegram(true);
    setStartError(null);

    try {
      const response = await fetch("/api/telegram/link-token", {
        method: "POST",
      });

      const result = (await response.json()) as {
        error?: string;
        telegramLink?: string | null;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to connect Telegram.");
      }

      if (!result.telegramLink) {
        throw new Error(
          "Telegram bot username is not configured yet. Set TELEGRAM_BOT_USERNAME and try again.",
        );
      }

      window.open(result.telegramLink, "_blank", "noopener,noreferrer");
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Unable to connect Telegram.",
      );
    } finally {
      setIsConnectingTelegram(false);
    }
  }

  async function handleStartSession() {
    setIsStartingSession(true);
    setStartError(null);

    try {
      const response = await fetch("/api/guardian/start-session", {
        method: "POST",
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to start session.");
      }

      router.refresh();
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Unable to start session.",
      );
    } finally {
      setIsStartingSession(false);
    }
  }

  async function handleEndSession() {
    setIsEndingSession(true);
    setStartError(null);

    try {
      const response = await fetch("/api/guardian/end-session", {
        method: "POST",
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to end session.");
      }

      router.refresh();
    } catch (error) {
      setStartError(
        error instanceof Error ? error.message : "Unable to end session.",
      );
    } finally {
      setIsEndingSession(false);
    }
  }

  return (
    <section
      className={`w-full min-w-0 rounded-[2rem] border px-4 py-4 shadow-[0_25px_70px_-45px_rgba(28,25,23,0.4)] sm:px-6 sm:py-5 ${styles.shell}`}
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
        <div>
          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] ${styles.chip}`}
          >
            {sessionState.statusLabel}
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
            {sessionState.headline}
          </h2>
          {/* Desktop: full detail text */}
          <p className={`mt-3 max-w-2xl text-sm leading-6 text-stone-700${isSessionEnded && sessionState.sessionStartedAt ? " hidden md:block" : ""}`}>
            {sessionState.detail}
          </p>
          {/* Mobile: short session timestamps when session has ended */}
          {isSessionEnded && sessionState.sessionStartedAt ? (
            <p className="mt-3 text-sm leading-6 text-stone-700 md:hidden">
              Started {fmtShortTime(sessionState.sessionStartedAt, displayTimeZone)}
              {sessionState.sessionEndedAt
                ? ` · Ended ${fmtShortTime(sessionState.sessionEndedAt, displayTimeZone)}`
                : ""}
            </p>
          ) : null}
          <div className="mt-4 rounded-[1.4rem] border border-white/70 bg-white/80 px-3 py-3 sm:mt-5 sm:px-4 sm:py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              What to do next
            </p>
            <p className="mt-2 text-base font-medium text-stone-950">
              {isSessionEnded
                ? "Session is closed for this Guardian day. Review what happened and wait for the next reset window."
                : isSessionActive
                ? telegramAccess.dashboardState === "connected"
                  ? "Session active. Guardian is monitoring your limits and will alert you via Telegram if a rule is hit."
                  : telegramAccess.dashboardState === "not_connected"
                    ? "Session active. Connect Telegram to receive Guardian lockout alerts and enforcement notifications."
                    : sessionState.nextStep
                : sessionState.nextStep}
            </p>
            {sessionState.kind === "READY_TO_TRADE" && !sessionState.sessionStarted ? (
              isPreNewsStartBlocked ? (
                <Link
                  href={cta.href}
                  className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-amber-600 px-7 py-3 text-base font-medium text-white transition hover:bg-amber-700"
                >
                  {cta.label}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={isStartingSession}
                  className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-stone-950 px-7 py-3 text-base font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
                >
                  {isStartingSession ? "Starting session..." : cta.label}
                </button>
              )
            ) : isSessionActive ? (
              <button
                type="button"
                onClick={handleEndSession}
                disabled={isEndingSession}
                className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-stone-950 px-7 py-3 text-base font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              >
                {isEndingSession ? "Ending session..." : "End session"}
              </button>
            ) : canOpenTelegram ? (
              <a
                href={telegramBotLink ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-stone-950 px-7 py-3 text-base font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Open Telegram alerts
              </a>
            ) : canConnectTelegram ? (
              <button
                type="button"
                onClick={handleConnectTelegram}
                disabled={isConnectingTelegram}
                className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-stone-950 px-7 py-3 text-base font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
              >
                {isConnectingTelegram ? "Connecting..." : "Connect Telegram alerts"}
              </button>
            ) : (
              <Link
                href={cta.href}
                className="mt-4 inline-flex w-fit max-w-full items-center justify-center self-start rounded-full bg-stone-950 px-7 py-3 text-base font-medium text-stone-50 transition hover:bg-stone-800"
              >
                {isSessionEnded ? (
                  <>
                    <span className="md:hidden">Review status</span>
                    <span className="hidden md:inline">{cta.label}</span>
                  </>
                ) : cta.label}
              </Link>
            )}
            {startError ? (
              <p className="mt-3 text-sm text-red-700">{startError}</p>
            ) : null}
          </div>

          {/* Mobile compact stats — visible below md when ManualRiskPanel is hidden */}
          {mobileStats && (
            <div className="mt-4 grid grid-cols-2 gap-2 md:hidden">
              <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Today P&amp;L</p>
                <p className={`mt-1 text-base font-semibold tabular-nums ${mobileStats.todayPnL > 0 ? "text-emerald-700" : mobileStats.todayPnL < 0 ? "text-red-700" : "text-stone-950"}`}>
                  {fmtMoney(mobileStats.todayPnL)}
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Trades</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-stone-950">
                  {mobileStats.todayTradesCount}
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Budget left</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-stone-950">
                  {mobileStats.remainingDailyLossBudget !== null ? fmtMoney(mobileStats.remainingDailyLossBudget) : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Loss streak</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-stone-950">
                  {mobileStats.consecutiveLosses}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="hidden gap-3 md:grid">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                {sessionState.kind === "GUARDIAN_DISABLED" ? "Rule enforcement" : "Today status"}
              </p>
              <p className={`mt-2 text-lg font-semibold ${styles.accent}`}>
                {sessionState.kind === "ONBOARDING_REQUIRED"
                  ? "Setup required"
                  : sessionState.kind === "READY_TO_TRADE" && sessionState.sessionEnded
                    ? "Session ended"
                    : sessionState.kind === "READY_TO_TRADE"
                  ? "Trading open"
                  : sessionState.kind === "GUARDIAN_DISABLED"
                    ? "Paused"
                    : "Trading locked"}
              </p>
              {sessionState.kind === "GUARDIAN_DISABLED" ? (
                <p className="mt-2 text-sm text-stone-700">
                  Limits resume when Guardian is enabled.
                </p>
              ) : (
                <>
                  {sessionState.primaryReasonLabel ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Reason: {sessionState.primaryReasonLabel}
                    </p>
                  ) : null}
                  {sessionState.sessionStartedAt ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Started {formatGuardianDate(sessionState.sessionStartedAt, displayTimeZone)}
                    </p>
                  ) : null}
                  {sessionState.sessionEndedAt ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Ended {formatGuardianDate(sessionState.sessionEndedAt, displayTimeZone)}
                    </p>
                  ) : null}
                  {sessionState.sessionStarted && sessionState.sessionStartSource ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Started from {sessionState.sessionStartSource}.
                    </p>
                  ) : null}
                  {sessionState.sessionEnded && sessionState.sessionEndSource ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Ended from {sessionState.sessionEndSource}.
                    </p>
                  ) : null}
                  {additionalTriggeredRulesCount > 0 ? (
                    <p className="mt-1 text-xs text-stone-600">
                      +{additionalTriggeredRulesCount} additional Guardian rule
                      {additionalTriggeredRulesCount > 1 ? "s" : ""} hit
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                {sessionState.kind === "ONBOARDING_REQUIRED" ? "Next step" : "Next reset"}
              </p>
              {sessionState.kind === "ONBOARDING_REQUIRED" ? (
                <>
                  <p className="mt-2 text-base font-semibold text-stone-950">
                    Finish setup
                  </p>
                  <p className="mt-2 text-sm text-stone-600">
                    Your trading profile and risk rules need to be in place first.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-base font-semibold text-stone-950">{resetText}</p>
                  <p className="mt-2 text-sm text-stone-600">
                    Reset mode: {sessionState.resetMode === "DAILY" ? "Daily" : "Manual"}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Trades
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">
                {todayTradesCount}
              </p>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                P&amp;L
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">
                {todayPnL}
              </p>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Loss streak
              </p>
              <p className="mt-1 text-lg font-semibold text-stone-950">
                {consecutiveLosses}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/85 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Active limits
            </p>
            {sessionState.activeRules.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {sessionState.activeRules.map((rule) => (
                  <span
                    key={rule}
                    className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700"
                  >
                    {rule}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-500">No limits configured yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
