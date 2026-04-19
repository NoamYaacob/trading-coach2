import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";

export const metadata: Metadata = {
  title: "Guardrail — Broker-Connected Trading Guardian",
  description:
    "Guardrail connects to your broker account, watches fills and P&L in real time, and enforces your rules automatically — warning through Telegram and locking the account when limits are hit.",
};

const pillars = [
  {
    label: "Core system",
    title: "Guardian session control",
    detail:
      "Define your daily limits once — max trades, max loss, consecutive losses. Guardian enforces them automatically. When a limit is crossed, the session closes.",
  },
  {
    label: "Enforcement",
    title: "Real-time lockout",
    detail:
      "When Guardian triggers, trading is blocked for the day. There is no override. The decision was made before the pressure hit.",
  },
  {
    label: "Live coaching",
    title: "Telegram live coach",
    detail:
      "The bot reads your live session state, Guardian status, and loss streak before every reply. Coaching is grounded in where you actually are.",
  },
  {
    label: "Risk awareness",
    title: "News-aware protection",
    detail:
      "High-impact economic events are detected automatically. Depending on your policy, the system applies soft caution or a hard trading block before the window.",
  },
  {
    label: "Session record",
    title: "Today activity",
    detail:
      "Every meaningful session event is captured in a live timeline: state changes, Guardian triggers, manual trades, and session milestones — in order.",
  },
  {
    label: "Post-trade",
    title: "Post-session review",
    detail:
      "When the session closes, you get a structured review: the day's sequence, key moments, takeaways, and reset guidance for tomorrow.",
  },
];

const steps = [
  {
    n: "01",
    title: "Configure Guardian",
    detail: "Set your daily limits once: max loss, max trades, and consecutive loss stop.",
  },
  {
    n: "02",
    title: "Open the session",
    detail: "Confirm readiness, review today's limits, and start the day from the dashboard.",
  },
  {
    n: "03",
    title: "Trade with the bot",
    detail: "Check in, report states, and get replies that know your actual session position.",
  },
  {
    n: "04",
    title: "Let Guardian enforce",
    detail: "When limits are hit, the session closes automatically. No willpower required.",
  },
  {
    n: "05",
    title: "Close with a review",
    detail: "Get the day's sequence, key moments, and one takeaway to carry into tomorrow.",
  },
];

const telegramExchanges = [
  { from: "you", msg: "check in" },
  {
    from: "guardrail",
    msg: "Session active. 2 of 5 trades taken. P&L at −$120, limit is −$500. One loss in sequence — stay with the process. What's your setup for the next entry?",
  },
  { from: "you", msg: "Guardian locked me. what now?" },
  {
    from: "guardrail",
    msg: "Daily loss limit reached ($500). Session is closed for today. Reset window opens at 9:00 AM tomorrow. No more trades.",
  },
];

const activityPreview = [
  { dot: "bg-emerald-500", text: "Session started", time: "9:02 AM" },
  { dot: "bg-amber-500", text: "Loss reported", time: "9:47 AM" },
  { dot: "bg-blue-400", text: "Recovery noted", time: "10:12 AM" },
  { dot: "bg-stone-400", text: "Check-in logged", time: "10:30 AM" },
];

const includedFeatures = [
  "Guardian session control — max trades, max loss, consecutive loss stop",
  "Real-time Guardian lockout enforcement — no overrides",
  "Telegram live coach with session-state awareness",
  "Economic calendar with news-aware risk policies",
  "Today Activity live timeline",
  "Post-session review with structured takeaways",
  "Manual trade logging — wins, losses, P&L, rule breaches",
];

const faqs = [
  {
    q: "Is this a trading journal?",
    a: "No. A journal reviews what happened. Guardrail controls the session while it is happening — watching fills, enforcing rules, and locking the account automatically. Post-session review is one component. The live enforcement layer is the core.",
  },
  {
    q: "Which brokers are supported?",
    a: "Tradovate is the first supported broker. The architecture is built around direct broker connectivity — live fills, P&L updates, and order events flow in automatically. Additional broker connections are in progress. During the rollout, a manual entry path is also available.",
  },
  {
    q: "How does Telegram fit in?",
    a: "Telegram is the intervention surface, not the whole product. The guardian engine watches your account and makes enforcement decisions automatically. Telegram is where you receive warnings, lockout messages, and reset confirmations — grounded in your actual live session state.",
  },
  {
    q: "What happens during a Guardian lockout?",
    a: "The account is marked stopped the moment a limit is crossed — daily loss, max trades, or consecutive losses. You receive a Telegram message with the reason and reset timing. There is no override path. The decision was made before the session started.",
  },
  {
    q: "Who is this for?",
    a: "Active intraday traders — primarily futures traders on funded or evaluation accounts — who trade by defined rules and need those rules enforced in real time, not reviewed after the damage is done.",
  },
  {
    q: "Do I need to log trades manually?",
    a: "Not if your broker is connected. When live broker sync is active, Guardrail receives fills and P&L updates automatically — nothing to log. A manual entry path exists as a fallback during the broker rollout period.",
  },
];

export default function Home() {
  return (
    <AppShell
      eyebrow="Guardrail · Broker-Connected Trading Guardian"
      title="Your broker account, watched in real time."
      description="Guardrail connects to your trading account, reads every fill and P&L update live, and enforces your rules automatically. When a limit is hit, the account locks. When you're approaching the edge, it warns you through Telegram — before the damage is done."
      actions={
        <>
          <Link
            href="/signup"
            className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Connect your account
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
          >
            Log in
          </Link>
        </>
      }
    >
      <div className="grid gap-16">

        {/* ── Broker-connected flow ────────────────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Guardrail watches your live account.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              The system is built around direct broker connectivity. Connect your account, set your rules once, and Guardrail runs the protection loop automatically — no manual input required during the session.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.75rem] bg-stone-950 p-6 text-stone-50">
              <p className="font-mono text-2xl font-bold text-stone-700">01</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] leading-6">
                Connect your broker account
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                Link your Tradovate account once. Guardrail receives live fill data, P&L updates, and order events directly from your broker. No manual logging.
              </p>
              <p className="mt-3 text-xs font-medium text-amber-500">Tradovate-first · more brokers in progress</p>
            </div>
            <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)]">
              <p className="font-mono text-2xl font-bold text-stone-200">02</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Set your rules once
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Define your daily loss limit, max trades, consecutive loss stop, and allowed trading hours. Guardrail enforces them on every event — you don't touch the rules again.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-6">
              <p className="font-mono text-2xl font-bold text-amber-200">03</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Guardian watches every fill
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                Every trade close, P&L update, and loss streak is evaluated in real time. When you're approaching a limit, Guardian fires a warning through Telegram before the breach.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-red-200 bg-red-50 p-6">
              <p className="font-mono text-2xl font-bold text-red-200">04</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Hard lock when limits are hit
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                When a rule is crossed — daily loss, trade count, loss streak — the account is marked stopped. No override. You get a Telegram message with the reason and reset timing.
              </p>
            </div>
          </div>
        </section>

        {/* ── Real-life protection sequence ───────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              In practice
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              What a protected session actually looks like.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              This is a realistic sequence. Rules were set before the session. Nothing below required manual input.
            </p>
          </div>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-8 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.14)]">
            <div className="grid gap-0">

              {/* Event 1 */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
                    <div className="h-2.5 w-2.5 rounded-full bg-stone-400" />
                  </div>
                  <div className="w-px flex-1 bg-stone-100 my-1" />
                </div>
                <div className="pb-6 pt-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-xs text-stone-400 shrink-0">9:04 AM</p>
                    <p className="text-sm font-medium text-stone-950">Trade closed · −$180</p>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">First loss of the session. Consecutive loss count: 1 of 3. P&L: −$180 of −$500 limit.</p>
                </div>
              </div>

              {/* Event 2 */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100">
                    <div className="h-2.5 w-2.5 rounded-full bg-stone-400" />
                  </div>
                  <div className="w-px flex-1 bg-stone-100 my-1" />
                </div>
                <div className="pb-6 pt-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-xs text-stone-400 shrink-0">9:09 AM</p>
                    <p className="text-sm font-medium text-stone-950">New order opened · 2 contracts</p>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">Re-entry five minutes after a loss. Guardrail registers the open and begins tracking.</p>
                </div>
              </div>

              {/* Event 3 — warning */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  </div>
                  <div className="w-px flex-1 bg-amber-100 my-1" />
                </div>
                <div className="pb-6 pt-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-xs text-stone-400 shrink-0">9:13 AM</p>
                    <p className="text-sm font-medium text-amber-800">Trade closed · −$230 · Guardian warning sent</p>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">Second consecutive loss. P&L now −$410 against a −$500 limit. Guardian fires a Telegram warning.</p>
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800">
                    <p className="mb-1 text-xs font-semibold text-amber-700">Guardrail · Telegram</p>
                    Two consecutive losses. P&L at −$410, limit is −$500. You have $90 of room left. Consider stopping now.
                  </div>
                </div>
              </div>

              {/* Event 4 — limit breached */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                  <div className="w-px flex-1 bg-red-100 my-1" />
                </div>
                <div className="pb-6 pt-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-xs text-stone-400 shrink-0">9:28 AM</p>
                    <p className="text-sm font-medium text-red-800">Trade closed · −$110 · Daily loss limit reached</p>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">P&L crossed −$500. Guardian immediately marks the account stopped. No further trades process.</p>
                </div>
              </div>

              {/* Event 5 — lockout */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <div className="h-2.5 w-2.5 rounded-full bg-red-600" />
                  </div>
                </div>
                <div className="pb-2 pt-1 min-w-0">
                  <div className="flex items-baseline gap-3">
                    <p className="font-mono text-xs text-stone-400 shrink-0">9:28 AM</p>
                    <p className="text-sm font-medium text-red-800">Account locked · session closed</p>
                  </div>
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-stone-800">
                    <p className="mb-1 text-xs font-semibold text-red-700">Guardrail · Telegram</p>
                    Daily loss limit reached (−$520 / −$500). Session is closed for today. No more trades. Reset window opens tomorrow at market open.
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ── Problem ─────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              The problem
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Discipline breaks when it matters most.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              Most traders don't lose from bad strategy. They lose from psychology — in the
              moments after a loss, under FOMO pressure, or after a small winning streak turns
              them overconfident.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.75rem] bg-stone-950 p-7 text-stone-50">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                01
              </p>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] leading-7">
                You know the rules. Under pressure, they disappear.
              </h3>
              <p className="mt-3 text-sm leading-6 text-stone-400">
                Rules are easy when the session is clean. The first loss is where discipline is
                actually tested — and most traders face it without a hard stop.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                02
              </p>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] leading-7 text-stone-950">
                Journals review what happened. They don't stop it.
              </h3>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Post-trade journaling is valuable. But it's always too late. You need something
                watching the session live — not analyzing the damage after it's done.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-stone-200 bg-white p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                03
              </p>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.03em] leading-7 text-stone-950">
                One bad trade becomes a bad week.
              </h3>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                Without hard stops, a loss triggers revenge, revenge triggers overtrading, and
                overtrading closes the month in the red. The cascade is predictable — the stop
                needs to be automatic.
              </p>
            </div>
          </div>
        </section>

        {/* ── Product pillars ─────────────────────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              What Guardrail does
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Every layer of the discipline system, built in.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pillars.map((pillar) => (
              <div
                key={pillar.title}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.12)]"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                  {pillar.label}
                </p>
                <h3 className="mt-3 text-lg font-semibold tracking-[-0.03em] text-stone-950">
                  {pillar.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{pillar.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Product preview (mock dashboard) ────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Product
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              The control center for your trading day.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              One dashboard. Session status, Guardian state, rule notices, economic events, and
              today's activity — visible at a glance, before and during the session.
            </p>
          </div>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-8 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.2)]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Control Center
                </p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-stone-950">
                  Today's trading session.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Session active
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Trades today
                </p>
                <p className="mt-2 text-2xl font-bold text-stone-950">
                  2
                  <span className="text-base font-normal text-stone-400"> / 5</span>
                </p>
                <p className="mt-1 text-xs text-stone-500">3 remaining</p>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  P&L today
                </p>
                <p className="mt-2 text-2xl font-bold text-red-700">−$120</p>
                <p className="mt-1 text-xs text-stone-500">Limit: −$500</p>
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Loss streak
                </p>
                <p className="mt-2 text-2xl font-bold text-stone-950">1</p>
                <p className="mt-1 text-xs text-stone-500">Stop after 3</p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Guardian
                </p>
                <p className="mt-2 font-semibold text-stone-950">Active</p>
                <p className="mt-1 text-xs text-stone-600">All limits live</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                Guardian · Warning
              </p>
              <p className="mt-1 text-sm font-medium text-stone-900">
                Approaching the daily loss limit. P&L: −$120, limit: −$500.
              </p>
              <p className="mt-1 text-xs text-stone-600">
                Reduce size and consider stopping early.
              </p>
            </div>

            <div className="mt-5 grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Today activity
              </p>
              {activityPreview.map((item) => (
                <div
                  key={item.text}
                  className="flex items-center gap-3 rounded-xl bg-stone-50 px-4 py-2"
                >
                  <div className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                  <p className="min-w-0 flex-1 text-sm text-stone-700">{item.text}</p>
                  <p className="shrink-0 font-mono text-xs text-stone-400">{item.time}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Daily loop
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              One operating loop, every trading day.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              Guardrail runs as a daily discipline system — from premarket setup through session
              close and post-session review.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-5">
            {steps.map((step) => (
              <div
                key={step.n}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-5 py-6"
              >
                <p className="font-mono text-2xl font-bold text-stone-200">{step.n}</p>
                <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Telegram spotlight ───────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-amber-200/80 bg-gradient-to-br from-amber-50 to-[#fdf8f0] p-8 shadow-[0_30px_80px_-40px_rgba(180,83,9,0.18)] sm:p-10">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                Telegram coaching
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                A coach that knows where you actually are.
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                Not a generic chatbot. The Telegram coach reads your live Guardian status,
                session state, loss streak, and pre-news policy before every reply.
              </p>
              <ul className="mt-6 grid gap-3">
                {[
                  "When you're locked out, it confirms the close and gives reset timing.",
                  "When you're in a pre-news window, it flags the risk before you enter.",
                  "When you've reset, it confirms you're actually ready to resume.",
                  "Check-ins, loss reports, and day summary — all grounded in live state.",
                ].map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm leading-6 text-stone-700">
                    <span className="mt-1 shrink-0 font-bold text-amber-600">→</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[1.75rem] border border-amber-200 bg-white/80 p-6 shadow-[0_16px_40px_-16px_rgba(180,83,9,0.12)]">
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Telegram · Live session
              </p>
              <div className="grid gap-3">
                {telegramExchanges.map((item, i) => (
                  <div
                    key={i}
                    className={`flex ${item.from === "you" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                        item.from === "you"
                          ? "bg-stone-900 text-stone-50"
                          : "border border-amber-200 bg-amber-50/80 text-stone-800"
                      }`}
                    >
                      {item.from === "guardrail" && (
                        <p className="mb-1 text-xs font-semibold text-amber-700">Guardrail</p>
                      )}
                      {item.msg}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-8 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.22)] sm:p-10">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Pricing
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                Start your free trial.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Full access during your trial. Connect your account, configure your protection rules, link Telegram, and run your first protected session. No credit card required.
              </p>
              <div className="mt-8 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-[-0.04em] text-stone-950">$49</span>
                <span className="text-base text-stone-500">/ month</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Set up account protection
                </Link>
                <Link
                  href="/login"
                  className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                >
                  Log in
                </Link>
              </div>
            </div>
            <div>
              <p className="mb-4 text-sm font-semibold text-stone-950">Everything included:</p>
              <ul className="grid gap-3">
                {includedFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700"
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Common questions.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((faq) => (
              <div
                key={faq.q}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-6 py-6"
              >
                <h3 className="text-base font-semibold tracking-[-0.02em] text-stone-950">
                  {faq.q}
                </h3>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-8 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                Ready to start?
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                Your next session, under real protection.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Connect your broker account, set your daily rules, link Telegram, and let Guardrail watch the session. When limits are hit, the account locks — automatically, before you override yourself.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Connect your account
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Log in
              </Link>
            </div>
          </div>
        </section>

      </div>
    </AppShell>
  );
}
