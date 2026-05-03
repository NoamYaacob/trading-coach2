import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import {
  PAIN_SCENARIOS,
  STEPS,
  PROP_FIRM_CARDS,
  INCLUDED_FEATURES,
  FAQS,
} from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Guardrail — Trading rules that hold under pressure",
  description:
    "Set daily loss, max trades, and session rules before the market opens. Guardrail evaluates every trade in real time and locks the session when a rule breaks.",
};

const ACTIVE_RULE_NAMES = [
  "Daily Loss Limit",
  "Max Trades Per Day",
  "Stop After Consecutive Losses",
  "News Blackout",
  "Session Hours",
];

export default async function Home() {
  const user = await getCurrentUser();

  const heroActions = user ? (
    <Link
      href="/dashboard"
      className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
    >
      Open today&rsquo;s session
    </Link>
  ) : (
    <>
      <Link
        href="/signup"
        className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
      >
        Start free week
      </Link>
      <a
        href="#how-it-works"
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
      >
        See how it works ↓
      </a>
    </>
  );

  return (
    <AppShell
      eyebrow="FOR FUTURES & PROP FIRM TRADERS"
      title={
        <>
          You know your rules.
          <br />
          Guardrail makes them hold.
        </>
      }
      description="Set your daily loss, max trades, session hours, and loss-streak rules before the open. When pressure hits, Guardrail keeps the session inside those limits."
      note={
        <>
          <span className="hidden sm:inline">App-level locks today · Read-only broker connection first · Broker-side enforcement ships only after verified integration support</span>
          <span className="sm:hidden">App-level locks today. Broker-side enforcement after verified support.</span>
        </>
      }
      actions={heroActions}
      heroPreview={user ? undefined : <HeroStatusPreview />}
    >
      <div className="grid gap-8 sm:gap-12 lg:gap-16">

        {/* ── Pain ─────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-4 max-w-2xl sm:mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              The real problem
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              You know your rules.{" "}
              <span className="text-stone-400">You break them anyway.</span>
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              Every futures trader sets rules before the market opens. Then the session starts,
              pressure builds, and the rules you made when thinking clearly are the ones you break.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PAIN_SCENARIOS.map((s) => (
              <div
                key={s.title}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-4 py-4 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)] sm:px-6 sm:py-6"
              >
                <p className="text-sm font-semibold text-stone-950">{s.title}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how-it-works">
          <div className="mb-4 max-w-2xl sm:mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              How it works
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              Three steps. One operating loop.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-4 py-4 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)] sm:px-6 sm:py-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-2xl font-bold text-stone-200">{step.n}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${step.tagCls}`}
                  >
                    {step.tag}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-6 tracking-[-0.02em] text-stone-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link
              href="/how-it-works"
              className="text-sm font-medium text-stone-600 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              Session states, Manual Mode, and enforcement scope →
            </Link>
          </div>
        </section>

        {/* ── Features highlight ────────────────────────────────────────── */}
        <section>
          <div className="mb-4 max-w-2xl sm:mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Rule engine
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Five active rules. Nine more on the way.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Loss limits, trade caps, session windows, and news locks — evaluated in real time
              against every trade event.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ACTIVE_RULE_NAMES.map((name) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="text-sm font-medium text-stone-950">{name}</span>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Link
              href="/features"
              className="text-sm font-medium text-stone-600 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              View all 14 rules — Active, Partial, and Coming Soon →
            </Link>
          </div>
        </section>

        {/* ── Prop firm ─────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-amber-200/80 bg-amber-50/30 p-5 sm:p-8">
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              Prop firm pressure
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Prop firm rules do not forgive emotional trades.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              One rule break can cost the challenge, the funded account, or the payout.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PROP_FIRM_CARDS.map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-amber-100 bg-white/80 px-5 py-5"
              >
                <p className="text-sm font-semibold text-stone-950">{card.title}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{card.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Link
              href="/prop-firms"
              className="text-sm font-medium text-amber-800 underline-offset-2 transition hover:text-amber-950 hover:underline"
            >
              Built for prop firms: evaluation, funded, and payout protection →
            </Link>
          </div>
        </section>

        {/* ── Trust summary ─────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-800 bg-stone-950 p-5 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">
            Your data, your control
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-2xl">
            Read-only first. No trading credentials.
          </h2>
          <ul className="mt-5 grid gap-3">
            <li className="flex items-start gap-3 text-sm text-stone-300">
              <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
              Read-only connection — Guardrail receives trade events. It cannot place or cancel orders.
            </li>
            <li className="flex items-start gap-3 text-sm text-stone-300">
              <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
              No broker password stored — connections use broker authorization or scoped tokens.
            </li>
            <li className="flex items-start gap-3 text-sm text-stone-300">
              <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
              Disconnect any time from account settings. Rule configuration is kept, data is not.
            </li>
          </ul>
          <div className="mt-5">
            <Link
              href="/security"
              className="text-xs text-stone-400 underline-offset-2 transition hover:text-stone-200 hover:underline"
            >
              Security & read-only access details →
            </Link>
          </div>
        </section>

        {/* ── Pricing preview ───────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.22)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Pricing
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
                First week free.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Full access for 7 days — no credit card required. Then $25/month.
              </p>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-[-0.04em] text-stone-950">$25</span>
                <span className="text-base text-stone-500">/ month after trial</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <div className="mt-5 flex flex-row flex-wrap gap-3">
                {user ? (
                  <Link
                    href="/dashboard"
                    className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                  >
                    Open today&rsquo;s session
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                    >
                      Start free week
                    </Link>
                    <Link
                      href="/pricing"
                      className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
                    >
                      See pricing details
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold text-stone-950">Included:</p>
              <ul className="grid gap-2">
                {INCLUDED_FEATURES.slice(0, 4).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700 sm:px-4 sm:py-3"
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing"
                className="mt-3 block text-xs text-stone-400 underline-offset-2 transition hover:text-stone-700 hover:underline"
              >
                All included features & cost calculator →
              </Link>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section id="faq">
          <div className="mb-4 sm:mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              FAQ
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Common questions.
            </h2>
          </div>
          <div className="grid gap-3">
            {FAQS.slice(0, 4).map((faq) => (
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore – `name` on <details> is valid HTML (Chrome 120+, Firefox 130+, Safari 17.2+) but missing from older React types
              <details
                key={faq.q}
                name="faq"
                className="group rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 transition-colors hover:bg-stone-50/60 sm:px-6 sm:py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold tracking-[-0.02em] text-stone-950 sm:text-base">
                  {faq.q}
                  <span className="shrink-0 text-stone-500 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-4">
            <Link
              href="/faq"
              className="text-sm font-medium text-stone-600 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              Read all 9 questions →
            </Link>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl lg:text-3xl">
                Your rules, enforced. Starting now.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Configure your limits. Run today&rsquo;s session. Let Guardrail lock the moment a
                rule breaks.
              </p>
            </div>
            <div className="flex flex-row flex-wrap gap-3">
              {user ? (
                <Link
                  href="/dashboard"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Open today&rsquo;s session
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                  >
                    Start free week
                  </Link>
                  <Link
                    href="/login"
                    className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
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

// ─── Hero locked-state preview ─────────────────────────────────────────────────

function HeroStatusPreview() {
  return (
    <div className="w-full rounded-2xl border border-red-300/60 bg-white/95 p-3 shadow-[0_8px_28px_-8px_rgba(185,28,28,0.18)] lg:w-60 lg:p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
          Today&rsquo;s session
        </p>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
          Locked
        </span>
      </div>
      <p className="mb-1 text-sm font-semibold tracking-[-0.02em] text-stone-950">Session locked</p>
      <p className="mb-2 text-[11px] text-red-700">Daily loss limit reached</p>
      <div className="flex flex-col gap-2">
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-stone-500">
            <span>Loss used</span>
            <span className="font-semibold text-red-700">$500 / $500</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-red-100">
            <div className="h-full w-full rounded-full bg-red-500" />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-stone-500">
            <span>Trades</span>
            <span>5 / 5</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full w-full rounded-full bg-stone-400" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2">
        <p className="text-[10px] text-stone-400">Next reset: tomorrow</p>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-500">
          New entries disabled
        </span>
      </div>
    </div>
  );
}
