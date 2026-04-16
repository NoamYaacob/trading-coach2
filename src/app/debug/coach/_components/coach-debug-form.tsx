"use client";

import { useState } from "react";

import {
  coachQuickActionGroups,
  getCoachQuickActionsByGroup,
} from "@/lib/coach-actions";

type DebugResult = {
  intent: string;
  mode: string;
  currentTraderState: string;
  cooldownActive: boolean;
  todaySessionSummary: {
    eventCount: number;
    distressCount: number;
    fomoCount: number;
    revengeCount: number;
    tiltCount: number;
    lossCount: number;
    twoLossCount: number;
    resetCount: number;
    calmCount: number;
  };
  recentSessionEvents: Array<{
    id: string;
    message: string;
    traderState: string;
    createdAt: string;
  }>;
  guardian: {
    guardianEnabled: boolean;
    currentLockoutActive: boolean;
    primaryReason: string;
    primaryReasonLabel: string;
    triggeredRules: string[];
    triggeredRuleLabels: string[];
    actionGuidance: string[];
    resetMode: string;
    resetTimezone: string;
    nextAllowedResetAt: string | null;
    lastResetAt: string | null;
    resetAllowedNow: boolean;
  };
  reply: string;
};

export function CoachDebugForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebugResult | null>(null);

  async function runCoachReply(nextMessage?: string) {
    setIsSubmitting(true);
    setError(null);

    try {
      const outgoingMessage = (nextMessage ?? message).trim();

      const response = await fetch("/api/debug/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, message: outgoingMessage }),
      });

      const payload = (await response.json()) as {
        error?: string;
        intent?: string;
        mode?: string;
        currentTraderState?: string;
        cooldownActive?: boolean;
        todaySessionSummary?: DebugResult["todaySessionSummary"];
        recentSessionEvents?: DebugResult["recentSessionEvents"];
        guardian?: DebugResult["guardian"];
        reply?: string;
      };

      if (
        !response.ok ||
        !payload.intent ||
        !payload.mode ||
        !payload.currentTraderState ||
        !payload.todaySessionSummary ||
        !payload.recentSessionEvents ||
        !payload.guardian ||
        !payload.reply
      ) {
        throw new Error(payload.error ?? "Unable to generate coach reply.");
      }

      setMessage(outgoingMessage);
      setResult({
        intent: payload.intent,
        mode: payload.mode,
        currentTraderState: payload.currentTraderState,
        cooldownActive: Boolean(payload.cooldownActive),
        todaySessionSummary: payload.todaySessionSummary,
        recentSessionEvents: payload.recentSessionEvents,
        guardian: payload.guardian,
        reply: payload.reply,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to generate coach reply.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    await runCoachReply();
  }

  async function handleQuickAction(nextMessage: string) {
    setResult(null);
    await runCoachReply(nextMessage);
  }

  function formatGuardianDate(value: string | null, timeZone: string) {
    if (!value) {
      return "Not scheduled";
    }

    return `${new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(value))} ${timeZone}`;
  }

  return (
    <div className="rounded-[2rem] border border-stone-200 bg-white/95 p-8 shadow-[0_25px_70px_-45px_rgba(28,25,23,0.45)]">
      <div className="mb-8 grid gap-4 border-b border-stone-200 pb-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Quick actions
          </p>
          <p className="mt-2 text-sm text-stone-600">
            Run the same high-frequency coach actions used in Telegram without typing.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(coachQuickActionGroups).map(([groupKey, group]) => {
            const actions = getCoachQuickActionsByGroup(groupKey as keyof typeof coachQuickActionGroups);

            return (
              <div key={groupKey} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
                <p className="text-sm font-semibold text-stone-950">{group.title}</p>
                <p className="mt-1 text-sm text-stone-600">{group.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => handleQuickAction(action.message)}
                      disabled={isSubmitting}
                      className="inline-flex rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-stone-800">Test user email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="trader@example.com"
            className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            required
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-stone-800">Message</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type a Telegram-style message to test the coach..."
            className="min-h-32 rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            required
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 items-center justify-center rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
        >
          {isSubmitting ? "Generating..." : "Run coach reply"}
        </button>
      </form>

      {result ? (
        <div className="mt-8 grid gap-4 border-t border-stone-200 pt-8">
          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Detected intent
            </p>
            <p className="mt-1 text-base font-medium text-stone-950">{result.intent}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Coach mode
              </p>
              <p className="mt-1 text-base font-medium text-stone-950">{result.mode}</p>
            </div>

            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Current trader state
              </p>
              <p className="mt-1 text-base font-medium text-stone-950">
                {result.currentTraderState}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Cooldown: {result.cooldownActive ? "active" : "not active"}
              </p>
            </div>
          </div>

          <div
            className={`rounded-2xl px-4 py-3 ${
              result.guardian.currentLockoutActive
                ? "bg-red-50 text-red-900"
                : "bg-stone-50 text-stone-800"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
              Guardian context
            </p>
            <p className="mt-1 text-base font-medium">
              Enabled: {result.guardian.guardianEnabled ? "yes" : "no"} · Lockout:{" "}
              {result.guardian.currentLockoutActive ? "active" : "inactive"}
            </p>
            <p className="mt-1 text-sm">
              Primary reason: {result.guardian.primaryReasonLabel}
            </p>
            {result.guardian.triggeredRuleLabels.length > 1 ? (
              <p className="mt-1 text-sm">
                Additional rules: {result.guardian.triggeredRuleLabels.slice(1).join(", ")}
              </p>
            ) : null}
            <p className="mt-1 text-sm">
              Reset mode: {result.guardian.resetMode} · Resettable now:{" "}
              {result.guardian.resetAllowedNow ? "yes" : "no"}
            </p>
            <p className="mt-1 text-sm">
              Next allowed reset:{" "}
              {formatGuardianDate(
                result.guardian.nextAllowedResetAt,
                result.guardian.resetTimezone,
              )}
            </p>
            <p className="mt-1 text-sm">
              Last reset:{" "}
              {result.guardian.lastResetAt
                ? formatGuardianDate(
                    result.guardian.lastResetAt,
                    result.guardian.resetTimezone,
                  )
                : "Not reset yet"}
            </p>
          </div>

          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Today&apos;s session summary
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-stone-700">
              <p>Events today: {result.todaySessionSummary.eventCount}</p>
              <p>Distress moments: {result.todaySessionSummary.distressCount}</p>
              <p>FOMO: {result.todaySessionSummary.fomoCount}</p>
              <p>Revenge: {result.todaySessionSummary.revengeCount}</p>
              <p>Tilt: {result.todaySessionSummary.tiltCount}</p>
              <p>Losses: {result.todaySessionSummary.lossCount}</p>
              <p>Two-loss stops: {result.todaySessionSummary.twoLossCount}</p>
              <p>Resets: {result.todaySessionSummary.resetCount}</p>
              <p>Calm recoveries: {result.todaySessionSummary.calmCount}</p>
            </div>
          </div>

          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Last 5 session events
            </p>
            <div className="mt-3 grid gap-3">
              {result.recentSessionEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-stone-700">
                  <p className="font-medium text-stone-950">{event.message}</p>
                  <p className="mt-1">
                    State: {event.traderState} · {new Date(event.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-stone-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Generated reply
            </p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-stone-900">
              {result.reply}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
