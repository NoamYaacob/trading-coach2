"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type GuardianControlsProps = {
  initialProfile: {
    guardianEnabled: boolean;
    adapterKey: "mock" | "tradovate_stub";
    platformName: string;
    connectionStatus: "NOT_CONNECTED" | "MOCK_CONNECTED";
    maxTradesPerDay: number | null;
    maxDailyLoss: number | null;
    stopAfterConsecutiveLosses: number | null;
    dailyProfitTarget: number | null;
    copyTradeMode: boolean;
    resetMode: "DAILY" | "MANUAL";
    dailyResetHour: number;
    dailyResetTimezone: string;
  };
  initialStatus: {
    todayTradesCount: number;
    todayPnL: number;
    consecutiveLosses: number;
    currentLockoutActive: boolean;
    nextAllowedResetAt: string | null;
    lastResetAt: string | null;
  };
};

function parseNumberOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function GuardianControls({
  initialProfile,
  initialStatus,
}: GuardianControlsProps) {
  const router = useRouter();
  const [profile, setProfile] = useState({
    guardianEnabled: initialProfile.guardianEnabled,
    adapterKey: initialProfile.adapterKey,
    platformName: initialProfile.platformName,
    connectionStatus: initialProfile.connectionStatus,
    maxTradesPerDay: initialProfile.maxTradesPerDay?.toString() ?? "",
    maxDailyLoss: initialProfile.maxDailyLoss?.toString() ?? "",
    stopAfterConsecutiveLosses:
      initialProfile.stopAfterConsecutiveLosses?.toString() ?? "",
    dailyProfitTarget: initialProfile.dailyProfitTarget?.toString() ?? "",
    copyTradeMode: initialProfile.copyTradeMode,
    resetMode: initialProfile.resetMode,
    dailyResetHour: initialProfile.dailyResetHour.toString(),
    dailyResetTimezone: initialProfile.dailyResetTimezone,
  });
  const [status, setStatus] = useState({
    todayTradesCount: initialStatus.todayTradesCount.toString(),
    todayPnL: initialStatus.todayPnL.toString(),
    consecutiveLosses: initialStatus.consecutiveLosses.toString(),
  });
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isResettingGuardian, setIsResettingGuardian] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSaveRules(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingRules(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/guardian/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guardianEnabled: profile.guardianEnabled,
          adapterKey: profile.adapterKey,
          platformName: profile.platformName,
          connectionStatus: profile.connectionStatus,
          maxTradesPerDay: parseNumberOrNull(profile.maxTradesPerDay),
          maxDailyLoss: parseNumberOrNull(profile.maxDailyLoss),
          stopAfterConsecutiveLosses: parseNumberOrNull(
            profile.stopAfterConsecutiveLosses,
          ),
          dailyProfitTarget: parseNumberOrNull(profile.dailyProfitTarget),
          copyTradeMode: profile.copyTradeMode,
          resetMode: profile.resetMode,
          dailyResetHour: Number(profile.dailyResetHour || 9),
          dailyResetTimezone: profile.dailyResetTimezone,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save guardian rules.");
      }

      setFeedback("Guardian rules updated.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save guardian rules.",
      );
    } finally {
      setIsSavingRules(false);
    }
  }

  async function handleSaveStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingStatus(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/guardian/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          todayTradesCount: Number(status.todayTradesCount || 0),
          todayPnL: Number(status.todayPnL || 0),
          consecutiveLosses: Number(status.consecutiveLosses || 0),
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update today activity.");
      }

      setFeedback("Today activity updated.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update today activity.",
      );
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function handleManualReset() {
    setIsResettingGuardian(true);
    setError(null);
    setFeedback(null);

    try {
      const response = await fetch("/api/guardian/reset", {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reset Guardian.");
      }

      setFeedback("Guardian reset completed.");
      router.refresh();
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Unable to reset Guardian.",
      );
    } finally {
      setIsResettingGuardian(false);
    }
  }

  return (
    <div className="grid gap-6 min-w-0 lg:grid-cols-[1.15fr_0.85fr]">
      <form
        onSubmit={handleSaveRules}
        className="min-w-0 rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.35)]"
      >
        <div className="mb-5">
          <h3 className="text-xl font-semibold tracking-[-0.03em] text-stone-950">
            Protection Rules
          </h3>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Set the limits that define your trading discipline. These rules drive
            Guardian enforcement every session.
          </p>
        </div>

        <div className="grid gap-x-5 gap-y-4 min-w-0 md:grid-cols-2">
          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Guardian enabled
            </span>
            <button
              type="button"
              onClick={() =>
                setProfile((current) => ({
                  ...current,
                  guardianEnabled: !current.guardianEnabled,
                }))
              }
              className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-medium ${
                profile.guardianEnabled
                  ? "bg-emerald-600 text-white"
                  : "bg-stone-200 text-stone-700"
              }`}
            >
              {profile.guardianEnabled ? "Guardian Active" : "Guardian Inactive"}
            </button>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Adapter</span>
            <select
              value={profile.adapterKey}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  adapterKey: event.target.value as "mock" | "tradovate_stub",
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            >
              <option value="mock">Demo mode</option>
              <option value="tradovate_stub">Tradovate stub</option>
            </select>
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Platform</span>
            <input
              value={profile.platformName}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  platformName: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Connection status
            </span>
            <select
              value={profile.connectionStatus}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  connectionStatus: event.target.value as
                    | "NOT_CONNECTED"
                    | "MOCK_CONNECTED",
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            >
              <option value="MOCK_CONNECTED">Demo connected</option>
              <option value="NOT_CONNECTED">Not connected</option>
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Copy trade mode
            </span>
            <button
              type="button"
              onClick={() =>
                setProfile((current) => ({
                  ...current,
                  copyTradeMode: !current.copyTradeMode,
                }))
              }
              className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-medium ${
                profile.copyTradeMode
                  ? "bg-stone-950 text-white"
                  : "bg-stone-200 text-stone-700"
              }`}
            >
              {profile.copyTradeMode ? "On" : "Off"}
            </button>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">Reset mode</span>
            <select
              value={profile.resetMode}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  resetMode: event.target.value as "DAILY" | "MANUAL",
                }))
              }
              className="h-9 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            >
              <option value="DAILY">Daily</option>
              <option value="MANUAL">Manual</option>
            </select>
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Daily reset hour (0–23)
            </span>
            <input
              inputMode="numeric"
              value={profile.dailyResetHour}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  dailyResetHour: event.target.value,
                }))
              }
              disabled={profile.resetMode !== "DAILY"}
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="min-w-0 grid gap-1.5 md:col-span-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Reset timezone
            </span>
            <input
              value={profile.dailyResetTimezone}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  dailyResetTimezone: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Max trades per day
            </span>
            <input
              inputMode="numeric"
              value={profile.maxTradesPerDay}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  maxTradesPerDay: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Max daily loss
            </span>
            <input
              inputMode="decimal"
              value={profile.maxDailyLoss}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  maxDailyLoss: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Stop after consecutive losses
            </span>
            <input
              inputMode="numeric"
              value={profile.stopAfterConsecutiveLosses}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  stopAfterConsecutiveLosses: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <label className="min-w-0 grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
              Daily profit target
            </span>
            <input
              inputMode="decimal"
              value={profile.dailyProfitTarget}
              onChange={(event) =>
                setProfile((current) => ({
                  ...current,
                  dailyProfitTarget: event.target.value,
                }))
              }
              className="h-9 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={isSavingRules}
          className="mt-6 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
        >
          {isSavingRules ? "Saving rules..." : "Save Guardian Rules"}
        </button>
      </form>

      <div className="grid gap-6">
        <form
          onSubmit={handleSaveStatus}
          className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.35)]"
        >
          <div className="mb-5">
            <h3 className="text-xl font-semibold tracking-[-0.03em] text-stone-950">
              Today Activity
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Set today's activity manually. Guardian evaluates these values until
              live data is connected.
            </p>
          </div>

          <div className="grid gap-4">
            <label className="min-w-0 grid gap-2">
              <span className="text-sm font-medium text-stone-800">
                Today trades
              </span>
              <input
                inputMode="numeric"
                value={status.todayTradesCount}
                onChange={(event) =>
                  setStatus((current) => ({
                    ...current,
                    todayTradesCount: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
              />
            </label>

            <label className="min-w-0 grid gap-2">
              <span className="text-sm font-medium text-stone-800">Today P&amp;L</span>
              <input
                inputMode="decimal"
                value={status.todayPnL}
                onChange={(event) =>
                  setStatus((current) => ({
                    ...current,
                    todayPnL: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
              />
            </label>

            <label className="min-w-0 grid gap-2">
              <span className="text-sm font-medium text-stone-800">
                Consecutive losses
              </span>
              <input
                inputMode="numeric"
                value={status.consecutiveLosses}
                onChange={(event) =>
                  setStatus((current) => ({
                    ...current,
                    consecutiveLosses: event.target.value,
                  }))
                }
                className="h-11 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={isSavingStatus}
            className="mt-6 inline-flex rounded-full bg-amber-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {isSavingStatus ? "Updating state..." : "Update Today Activity"}
          </button>

          <div className="mt-6 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700">
            <p className="font-medium text-stone-950">Reset lifecycle</p>
            <p className="mt-2">
              Mode: {profile.resetMode === "DAILY" ? "Daily reset" : "Manual reset"}
            </p>
            <p className="mt-1">
              Next allowed reset: {initialStatus.nextAllowedResetAt ?? "Not scheduled"}
            </p>
            <p className="mt-1">
              Last reset: {initialStatus.lastResetAt ?? "Not reset yet"}
            </p>
            {profile.resetMode === "MANUAL" ? (
              <button
                type="button"
                onClick={handleManualReset}
                disabled={isResettingGuardian}
                className="mt-4 inline-flex rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-900 transition hover:border-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isResettingGuardian ? "Resetting Guardian..." : "Run Manual Reset"}
              </button>
            ) : (
              <p className="mt-4 text-stone-600">
                Manual reset is blocked while Guardian is using daily reset mode.
              </p>
            )}
          </div>
        </form>

        {(feedback || error) && (
          <div
            className={`rounded-[1.5rem] border px-4 py-4 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {error ?? feedback}
          </div>
        )}
      </div>
    </div>
  );
}
