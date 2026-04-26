import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Guardrail — Risk Enforcement for Serious Traders",
  description:
    "Guardrail turns your risk rules into a live session state: Allowed, Warning, or Locked. Manual Mode today; broker-connected enforcement as integrations are verified.",
};

const pillars = [
  {
    label: "Step 1",
    title: "Define your rules before the session",
    detail:
      "Max trades, max daily loss, consecutive-loss stop, allowed hours. You configure them when you're calm — Guardrail evaluates them when you're not.",
  },
  {
    label: "Step 2",
    title: "Monitor risk in real time",
    detail:
      "The dashboard shows trade count, loss budget, loss streak, and a Safe / Warning / Locked verdict from your active rules. Updates as your journal or broker data changes.",
  },
  {
    label: "Step 3",
    title: "Lock yourself out when rules are breached",
    detail:
      "When a rule is crossed, Guardian transitions to Locked at the app level. Manual Mode shows a clear lockout banner and surfaces the breach reason. No hidden state.",
  },
  {
    label: "Manual Mode",
    title: "Available today, no broker required",
    detail:
      "Log trades in the journal. Guardrail derives risk state from your entries and applies the same evaluation as the broker pipeline will. Manual Mode does not block trades at the broker.",
  },
  {
    label: "Read-only first",
    title: "Tradovate connection — read-only, in preparation",
    detail:
      "OAuth and AES-256-GCM token storage are built. The read pipeline is implemented and waiting on endpoint verification before risk state can switch to broker-driven evaluation.",
  },
  {
    label: "Honest about scope",
    title: "Enforcement actions only after verified support",
    detail:
      "Cancel orders, flatten positions, and broker-level lockout are not enabled. They ship per-broker only after live verification, explicit user opt-in, and an audit-log path.",
  },
];

const steps = [
  {
    n: "01",
    title: "Set your rules",
    detail: "Max loss, max trades, consecutive-loss stop, session hours. Configured once before the day starts.",
  },
  {
    n: "02",
    title: "Pick a source",
    detail: "Manual Mode is the current source. Tradovate read-only OAuth is being prepared and will become the source once verified.",
  },
  {
    n: "03",
    title: "Risk state, evaluated live",
    detail: "Each trade updates the Safe / Warning / Locked verdict against the rules you set.",
  },
  {
    n: "04",
    title: "Lock the session",
    detail: "Guardrail moves to Locked at the app level the moment a rule is breached. The dashboard shows the reason and reset window.",
  },
  {
    n: "05",
    title: "Close with a review",
    detail: "Daily summary of P&L, trade count, breaches, and the one takeaway to carry into tomorrow.",
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
  "Pre-session rules editor — max loss, max trades, consecutive-loss stop, session hours",
  "Risk state evaluated as trades land — Safe / Warning / Locked verdict",
  "App-level lockout the moment a rule is breached",
  "Manual Mode trade entry with auto-calc P&L, risk, and R-multiple",
  "Trading-day window with timezone and overnight session support",
  "Tradovate OAuth (read-only), AES-256-GCM encrypted token storage",
  "Connection verification page — every Tradovate read endpoint, pass / fail",
  "Optional Telegram alerts for Guardrail state changes",
];

const faqs = [
  {
    q: "Does Guardrail block my trades at the broker?",
    a: "Not today. Lockout is an in-app state — Guardrail transitions to Locked, surfaces the breach in Manual Mode, and (optionally) sends a Telegram alert. Cancelling orders or flattening positions at the broker is not implemented. We will only ship those after end-to-end verification against the live broker API and explicit user opt-in.",
  },
  {
    q: "What is Manual Mode?",
    a: "Manual Mode is the canonical risk-state engine: you log each trade in the journal, and Guardrail derives Safe / Warning / Locked from your rules and today's entries. It works without any broker connection. The lock applies inside Guardrail only — it does not prevent orders at your broker.",
  },
  {
    q: "Which brokers are supported?",
    a: "Tradovate is the first integration. OAuth, encrypted token storage, and the read-only client are built. The endpoint shapes are based on Tradovate's documented API but are pending verification against a real account. Risk evaluation continues to use Manual Mode until each Tradovate read endpoint is verified end-to-end.",
  },
  {
    q: "How does Telegram fit in?",
    a: "Telegram is an optional alert surface. When configured, Guardrail sends Guardian state changes and lockout messages to your Telegram. Manual Mode and the dashboard work fully without Telegram.",
  },
  {
    q: "What happens during a lockout?",
    a: "Guardrail transitions to a Locked verdict in the app, the dashboard banner explains which rule fired, and (if Telegram is connected) you receive a message. The reset window opens at the start of the next trading day according to your configured session. No broker-side action is taken.",
  },
  {
    q: "Who is this for?",
    a: "Active intraday traders — primarily futures traders on funded or evaluation accounts — who define their rules ahead of time and want a system that holds them to those rules in real time. Pre-API-access today, broker-driven once your broker connection is verified.",
  },
  {
    q: "When will broker-level enforcement ship?",
    a: "Cancel orders, flatten positions, and broker-level lockout will be enabled per-broker only after each capability is verified against the live API. Each will require explicit user opt-in in Rules → On-breach actions and an audit log entry per invocation. We don't promise a date — we promise we won't ship them until they actually work.",
  },
];

export default async function Home() {
  const user = await getCurrentUser();

  const heroActions = user ? (
    <>
      <Link
        href="/dashboard"
        className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
      >
        Go to dashboard
      </Link>
      <Link
        href="/rules"
        className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
      >
        Set rules
      </Link>
    </>
  ) : (
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
  );

  return (
    <AppShell
      eyebrow="Guardrail · Risk Enforcement"
      title="Protect your trading day from rule-breaking."
      description="Guardrail turns your risk rules into a live session state: Allowed, Warning, or Locked. Manual Mode is available now; broker-connected enforcement is being prepared and verified per broker."
      actions={heroActions}
    >
      <div className="grid gap-16">

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Rules defined before the session. Evaluated as trades land.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              Log trades in Manual Mode now, or connect a verified broker when it&rsquo;s ready. Either way, the same engine evaluates your rules and transitions the session to Safe, Warning, or Locked.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.75rem] bg-stone-950 p-6 text-stone-50">
              <p className="font-mono text-2xl font-bold text-stone-700">01</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] leading-6">
                Set your rules
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                Max daily loss, max trades, consecutive-loss stop, allowed session hours. Configured in the Rules editor when you&rsquo;re calm — locked in before the session opens.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)]">
              <p className="font-mono text-2xl font-bold text-stone-200">02</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Choose your source
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Manual Mode is the current source of truth — log each trade and the engine evaluates your rules against it. Tradovate read-only OAuth is being prepared and will become the source once verified.
              </p>
              <p className="mt-3 text-xs font-medium text-sky-700">Tradovate-first · read-only first</p>
            </div>
            <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-6">
              <p className="font-mono text-2xl font-bold text-amber-200">03</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Risk state, evaluated live
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                Each trade updates a Safe / Warning / Locked verdict against the rules you set. Approaching-limit warnings fire before a breach. Optional Telegram mirrors state changes.
              </p>
            </div>
            <div className="rounded-[1.75rem] border border-red-200 bg-red-50 p-6">
              <p className="font-mono text-2xl font-bold text-red-200">04</p>
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                Lock the session at the app
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                When a rule is breached, Guardrail moves to Locked and shows the reason and reset window. Designed to extend to broker-side cancel / flatten / lockout once each capability is verified per broker.
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
              How a protected session reads.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              An illustrative sequence. Rules are configured in advance. Once your broker connection is verified, the same sequence runs automatically; until then, trades are logged in Manual Mode and evaluated identically.
            </p>
          </div>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-8 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.14)]">
            <p className="mb-6 inline-flex rounded-full bg-stone-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              Illustrative — Manual Mode flow shown
            </p>
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
                    <p className="text-sm font-medium text-stone-950">Trade logged · −$180</p>
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
                  <p className="mt-1 text-sm text-stone-500">P&L crossed −$500. Guardrail transitions the session to Locked at the app level.</p>
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
                    <p className="text-sm font-medium text-red-800">App-level lockout · dashboard banner shown</p>
                  </div>
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-stone-800">
                    <p className="mb-1 text-xs font-semibold text-red-700">Guardrail · Telegram (optional)</p>
                    Daily loss limit reached (−$520 / −$500). Guardrail is Locked for the rest of the session. Reset opens tomorrow at the start of your trading day.
                  </div>
                  <p className="mt-2 text-xs text-stone-500">
                    App-level lockout only. Cancelling or flattening at the broker is not enabled — that requires verified broker support and explicit user opt-in.
                  </p>
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
              Most traders don&rsquo;t lose from bad strategy. They lose from psychology — in the
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
                Journals review what happened. They don&rsquo;t stop it.
              </h3>
              <p className="mt-3 text-sm leading-6 text-stone-700">
                Post-trade journaling is valuable. But it&rsquo;s always too late. You need something
                watching the session live — not analyzing the damage after it&rsquo;s done.
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
              today&rsquo;s activity — visible at a glance, before and during the session.
            </p>
          </div>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-8 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.2)]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Control Center
                </p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-stone-950">
                  Today&rsquo;s trading session.
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
                Optional · Telegram alerts
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                Enforcement alerts delivered to Telegram.
              </h2>
              <p className="mt-4 text-base leading-7 text-stone-700">
                Mirror Guardrail state changes to Telegram when you want them out of the dashboard and into your phone. Optional — Manual Mode and the dashboard work without it.
              </p>
              <ul className="mt-6 grid gap-3">
                {[
                  "App-level lockout confirmed the moment a rule is breached.",
                  "Pre-news window flagged before you enter, based on your news policy.",
                  "Reset confirmation when the next trading day opens.",
                  "Status questions answered with live rule state.",
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
                Full access during your trial. Configure your rules, run your first session in Manual Mode, optionally connect Tradovate read-only, and link Telegram. No credit card required.
              </p>
              <div className="mt-8 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-[-0.04em] text-stone-950">$49</span>
                <span className="text-base text-stone-500">/ month</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {user ? (
                  <Link
                    href="/dashboard"
                    className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                  >
                    Go to dashboard
                  </Link>
                ) : (
                  <>
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
                  </>
                )}
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
                Configure your rules. Run today&rsquo;s session in Manual Mode. When your Tradovate connection is verified, broker-driven evaluation comes online — designed to enforce your rules when broker connectivity is enabled.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {user ? (
                <Link
                  href="/dashboard"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Go to dashboard
                </Link>
              ) : (
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
              )}
            </div>
          </div>
        </section>

      </div>
    </AppShell>
  );
}
