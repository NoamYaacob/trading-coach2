"use client";

import { useState } from "react";

import { COACHING_TONES } from "@/lib/coaching-tones";

const INPUT =
  "w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";
const TEXTAREA =
  "w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200 resize-none";
const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";
const SECTION_TITLE = "text-sm font-semibold text-stone-950";
const SECTION_DESC = "text-xs text-stone-500";
const FIELD_HINT = "text-xs text-stone-400 mt-1";

type Props = {
  initial: {
    tradingWhy: string;
    tradingGoal: string;
    groundingReminder: string;
    primaryChallenge: string;
    tiltTrigger: string;
    disciplineBreakPattern: string;
    whatHelpsRefocus: string;
    reminderAnchors: string[];
    coachingTone: string;
    wantsMidSessionCheckIns: boolean;
    wantsGoalReminders: boolean;
    wantsToughInterventionWhenTilting: boolean;
    premarketCheckinEnabled: boolean;
    postmarketReviewEnabled: boolean;
  };
};

export function CoachingProfileForm({ initial }: Props) {
  const [tradingWhy, setTradingWhy] = useState(initial.tradingWhy);
  const [tradingGoal, setTradingGoal] = useState(initial.tradingGoal);
  const [groundingReminder, setGroundingReminder] = useState(initial.groundingReminder);
  const [primaryChallenge, setPrimaryChallenge] = useState(initial.primaryChallenge);
  const [tiltTrigger, setTiltTrigger] = useState(initial.tiltTrigger);
  const [disciplineBreakPattern, setDisciplineBreakPattern] = useState(
    initial.disciplineBreakPattern,
  );
  const [whatHelpsRefocus, setWhatHelpsRefocus] = useState(initial.whatHelpsRefocus);
  const [reminderAnchorsRaw, setReminderAnchorsRaw] = useState(
    initial.reminderAnchors.join(", "),
  );
  const [coachingTone, setCoachingTone] = useState(initial.coachingTone);
  const [wantsMidSessionCheckIns, setWantsMidSessionCheckIns] = useState(
    initial.wantsMidSessionCheckIns,
  );
  const [wantsGoalReminders, setWantsGoalReminders] = useState(initial.wantsGoalReminders);
  const [wantsToughIntervention, setWantsToughIntervention] = useState(
    initial.wantsToughInterventionWhenTilting,
  );
  const [premarketCheckinEnabled, setPremarketCheckinEnabled] = useState(
    initial.premarketCheckinEnabled,
  );
  const [postmarketReviewEnabled, setPostmarketReviewEnabled] = useState(
    initial.postmarketReviewEnabled,
  );

  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const reminderAnchors = reminderAnchorsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/coaching/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradingWhy: tradingWhy || null,
          tradingGoal: tradingGoal || null,
          groundingReminder: groundingReminder || null,
          primaryChallenge: primaryChallenge || null,
          tiltTrigger: tiltTrigger || null,
          disciplineBreakPattern: disciplineBreakPattern || null,
          whatHelpsRefocus: whatHelpsRefocus || null,
          reminderAnchors,
          coachingTone: coachingTone || null,
          wantsMidSessionCheckIns,
          wantsGoalReminders,
          wantsToughInterventionWhenTilting: wantsToughIntervention,
          premarketCheckinEnabled,
          postmarketReviewEnabled,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Save failed.");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  }

  const selectedTone = COACHING_TONES.find((t) => t.id === coachingTone);

  return (
    <form onSubmit={handleSubmit} className="grid gap-8">

      {/* ── Goals ────────────────────────────────────────────────── */}
      <div className="grid gap-5 rounded-[1.35rem] border border-stone-200 bg-stone-50 p-5">
        <div>
          <p className={SECTION_TITLE}>Goals</p>
          <p className={SECTION_DESC}>What drives you and what you're building toward.</p>
        </div>

        <label className="grid gap-2">
          <span className={LABEL}>Why you trade</span>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={tradingWhy}
            onChange={(e) => setTradingWhy(e.target.value)}
            placeholder="The real reason — not the safe answer."
          />
          <p className={FIELD_HINT}>Used when you question purpose or feel lost.</p>
        </label>

        <label className="grid gap-2">
          <span className={LABEL}>What you're building toward</span>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={tradingGoal}
            onChange={(e) => setTradingGoal(e.target.value)}
            placeholder="Specific, honest. Not 'be a better trader'."
          />
          <p className={FIELD_HINT}>Surfaced after losses as a forward anchor.</p>
        </label>

        <label className="grid gap-2">
          <span className={LABEL}>What grounds you</span>
          <input
            type="text"
            className={INPUT}
            value={groundingReminder}
            onChange={(e) => setGroundingReminder(e.target.value)}
            placeholder="The thing that pulls you back when you spiral."
          />
          <p className={FIELD_HINT}>Used when tilted, in revenge state, or overwhelmed.</p>
        </label>
      </div>

      {/* ── Emotional profile ─────────────────────────────────────── */}
      <div className="grid gap-5 rounded-[1.35rem] border border-stone-200 bg-stone-50 p-5">
        <div>
          <p className={SECTION_TITLE}>Emotional profile</p>
          <p className={SECTION_DESC}>Your patterns — used to personalize bot alerts and breach messages.</p>
        </div>

        <label className="grid gap-2">
          <span className={LABEL}>Primary challenge</span>
          <input
            type="text"
            className={INPUT}
            value={primaryChallenge}
            onChange={(e) => setPrimaryChallenge(e.target.value)}
            placeholder="In your own words — what trips you up most."
          />
        </label>

        <label className="grid gap-2">
          <span className={LABEL}>What triggers your tilt</span>
          <input
            type="text"
            className={INPUT}
            value={tiltTrigger}
            onChange={(e) => setTiltTrigger(e.target.value)}
            placeholder="Missing a move, taking a loss, being stopped out early..."
          />
        </label>

        <label className="grid gap-2">
          <span className={LABEL}>How your discipline breaks</span>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={disciplineBreakPattern}
            onChange={(e) => setDisciplineBreakPattern(e.target.value)}
            placeholder="What does it look like when you're about to break your rules?"
          />
          <p className={FIELD_HINT}>
            Specific patterns: revenge entries, widening stops, adding to losers, overtrading...
          </p>
        </label>

        <label className="grid gap-2">
          <span className={LABEL}>What helps you refocus</span>
          <textarea
            className={TEXTAREA}
            rows={2}
            value={whatHelpsRefocus}
            onChange={(e) => setWhatHelpsRefocus(e.target.value)}
            placeholder="What actually works when you're in a bad state."
          />
          <p className={FIELD_HINT}>
            Walking away, breathing, reviewing your rules, calling someone...
          </p>
        </label>
      </div>

      {/* ── Coaching style ────────────────────────────────────────── */}
      <div className="grid gap-5 rounded-[1.35rem] border border-stone-200 bg-stone-50 p-5">
        <div>
          <p className={SECTION_TITLE}>Coaching style</p>
          <p className={SECTION_DESC}>How you want the bot to communicate with you.</p>
        </div>

        <div className="grid gap-2">
          <span className={LABEL}>Tone</span>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {COACHING_TONES.map((tone) => (
              <button
                key={tone.id}
                type="button"
                onClick={() => setCoachingTone(tone.id)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  coachingTone === tone.id
                    ? "border-stone-950 bg-stone-950 text-stone-50"
                    : "border-stone-200 bg-white text-stone-900 hover:border-stone-300"
                }`}
              >
                <p className="text-sm font-semibold">{tone.label}</p>
                <p className={`mt-0.5 text-xs ${coachingTone === tone.id ? "text-stone-300" : "text-stone-500"}`}>
                  {tone.description}
                </p>
              </button>
            ))}
          </div>
          {selectedTone && (
            <p className="text-xs text-stone-500 mt-1 italic">
              {selectedTone.examplePhrases[0]}
            </p>
          )}
        </div>
      </div>

      {/* ── Personal anchors ─────────────────────────────────────── */}
      <div className="grid gap-5 rounded-[1.35rem] border border-stone-200 bg-stone-50 p-5">
        <div>
          <p className={SECTION_TITLE}>Personal anchors</p>
          <p className={SECTION_DESC}>
            Short phrases the bot can include in alert messages.
          </p>
        </div>

        <label className="grid gap-2">
          <span className={LABEL}>Anchors</span>
          <input
            type="text"
            className={INPUT}
            value={reminderAnchorsRaw}
            onChange={(e) => setReminderAnchorsRaw(e.target.value)}
            placeholder="Slow is smooth, Stay in your lane, One trade at a time..."
          />
          <p className={FIELD_HINT}>Comma-separated. These can appear verbatim in bot messages.</p>
        </label>
      </div>

      {/* ── Check-in preferences ──────────────────────────────────── */}
      <div className="grid gap-5 rounded-[1.35rem] border border-stone-200 bg-stone-50 p-5">
        <div>
          <p className={SECTION_TITLE}>Check-in preferences</p>
          <p className={SECTION_DESC}>What the bot does proactively via Telegram.</p>
        </div>

        <div className="grid gap-3">
          {(
            [
              {
                label: "Pre-session check-in",
                hint: "A brief grounding message before the session starts.",
                value: premarketCheckinEnabled,
                onChange: setPremarketCheckinEnabled,
              },
              {
                label: "End-of-day review",
                hint: "A short reflection after the session ends.",
                value: postmarketReviewEnabled,
                onChange: setPostmarketReviewEnabled,
              },
              {
                label: "Mid-session goal reminders",
                hint: "Periodic reminders of your stated goal during the session.",
                value: wantsMidSessionCheckIns,
                onChange: setWantsMidSessionCheckIns,
              },
              {
                label: "Goal anchor reminders",
                hint: "Surface your trading goal after a loss or rule breach.",
                value: wantsGoalReminders,
                onChange: setWantsGoalReminders,
              },
              {
                label: "Tough intervention when tilting",
                hint: "Escalate to a firm, direct message when revenge signals are detected.",
                value: wantsToughIntervention,
                onChange: setWantsToughIntervention,
              },
            ] as { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }[]
          ).map(({ label, hint, value, onChange }) => (
            <label key={label} className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 transition hover:border-stone-300">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-stone-300 accent-stone-950"
              />
              <div>
                <p className="text-sm font-medium text-stone-950">{label}</p>
                <p className="text-xs text-stone-500">{hint}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* ── Actions ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isSaving ? "Saving…" : "Save bot profile"}
        </button>
        {saved && <p className="text-xs text-emerald-600">Saved.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </form>
  );
}
