"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const MARKETS = ["Futures", "Forex", "Stocks", "Crypto"] as const;
const STYLES = ["Scalping", "Intraday", "Swing"] as const;
const EXPERIENCE_LEVELS = [
  { label: "Beginner", years: 1 },
  { label: "Intermediate", years: 3 },
  { label: "Advanced", years: 7 },
] as const;
const SESSIONS = [
  "NY Open",
  "London Open",
  "Morning",
  "Afternoon",
  "Full Day",
] as const;
const CHALLENGES = [
  "Overtrading",
  "Moving stops",
  "Revenge trading",
  "Breaking daily loss",
  "Oversizing",
  "Other",
] as const;

type Market = (typeof MARKETS)[number];
type Style = (typeof STYLES)[number];
type ExperienceLabel = (typeof EXPERIENCE_LEVELS)[number]["label"];
type Session = (typeof SESSIONS)[number];
type Challenge = (typeof CHALLENGES)[number];

const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";
const SELECT_CLS =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

function OptionGrid<T extends string>({
  options,
  value,
  onChange,
  cols = 2,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  cols?: 2 | 3 | 4;
}) {
  const gridCls =
    cols === 4
      ? "grid grid-cols-2 gap-2 sm:grid-cols-4"
      : cols === 3
        ? "grid grid-cols-3 gap-2"
        : "grid grid-cols-2 gap-2";
  return (
    <div className={gridCls}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "border-stone-950 bg-stone-950 text-stone-50"
                : "border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400 hover:bg-white"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function TradingProfileForm({
  initialMarket,
  initialStyle,
  initialExperienceYears,
  initialSession,
  initialChallenge,
  editMode,
}: {
  initialMarket?: string | null;
  initialStyle?: string | null;
  initialExperienceYears?: number | null;
  initialSession?: string | null;
  initialChallenge?: string | null;
  editMode?: boolean;
}) {
  const router = useRouter();

  function yearsToLabel(years: number | null | undefined): ExperienceLabel | null {
    if (years === 1) return "Beginner";
    if (years === 3) return "Intermediate";
    if (years === 7) return "Advanced";
    return null;
  }

  const [market, setMarket] = useState<Market | null>(
    MARKETS.includes(initialMarket as Market) ? (initialMarket as Market) : null,
  );
  const [style, setStyle] = useState<Style | null>(
    STYLES.includes(initialStyle as Style) ? (initialStyle as Style) : null,
  );
  const [experience, setExperience] = useState<ExperienceLabel | null>(
    yearsToLabel(initialExperienceYears),
  );
  const [session, setSession] = useState<Session | null>(
    SESSIONS.includes(initialSession as Session) ? (initialSession as Session) : null,
  );
  const [challenge, setChallenge] = useState<Challenge | null>(
    CHALLENGES.includes(initialChallenge as Challenge)
      ? (initialChallenge as Challenge)
      : null,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = Boolean(market && style && experience && session);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setIsSubmitting(true);
    setError(null);

    const expYears = EXPERIENCE_LEVELS.find((l) => l.label === experience)?.years ?? 1;

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traderProfile: {
            primaryMarket: market,
            tradingStyle: style,
            experienceYears: expYears,
            tradingSession: session,
          },
          ...(challenge
            ? { mentalProfile: { primaryChallenge: challenge } }
            : {}),
        }),
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save profile.");

      router.push(editMode ? "/settings" : "/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {/* Primary market */}
      <div className="grid gap-2">
        <span className={LABEL}>Primary market</span>
        <OptionGrid options={MARKETS} value={market} onChange={setMarket} cols={4} />
      </div>

      {/* Trading style */}
      <div className="grid gap-2">
        <span className={LABEL}>Trading style</span>
        <OptionGrid
          options={STYLES}
          value={style}
          onChange={setStyle}
          cols={3}
        />
      </div>

      {/* Experience level */}
      <div className="grid gap-2">
        <span className={LABEL}>Experience level</span>
        <OptionGrid
          options={EXPERIENCE_LEVELS.map((l) => l.label) as readonly ExperienceLabel[]}
          value={experience}
          onChange={setExperience}
          cols={3}
        />
      </div>

      {/* Trading session */}
      <div className="grid gap-2">
        <span className={LABEL}>Usual trading session</span>
        <select
          value={session ?? ""}
          onChange={(e) => setSession((e.target.value as Session) || null)}
          className={SELECT_CLS}
        >
          <option value="">Select a session…</option>
          {SESSIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Main discipline challenge */}
      <div className="grid gap-2">
        <span className={LABEL}>Main discipline challenge <span className="font-normal normal-case tracking-normal text-stone-400">(optional)</span></span>
        <select
          value={challenge ?? ""}
          onChange={(e) => setChallenge((e.target.value as Challenge) || null)}
          className={SELECT_CLS}
        >
          <option value="">Select if relevant…</option>
          {CHALLENGES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={!formValid || isSubmitting}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-950 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isSubmitting ? "Saving…" : "Save trading profile"}
        </button>
        <p className="text-center text-xs text-stone-400">
          You can edit this later from Settings.
        </p>
      </div>
    </form>
  );
}
