import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { BROKERS } from "@/lib/marketing-data";
import { BrokerCard } from "@/components/landing/broker-card";

export const metadata: Metadata = {
  title: "Security & Data",
  description:
    "How Guardrail connects to your broker, what data it accesses, and what it never touches.",
};

export default async function SecurityPage() {
  const user = await getCurrentUser();

  const actions = user ? (
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
        href="/how-it-works"
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
      >
        How it works
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="SECURITY & DATA"
      title="Read-only first. No trading credentials. No surprises."
      description="Guardrail needs trade events to evaluate your rules. It does not need to place trades."
      actions={actions}
    >
      <div className="grid gap-8 sm:gap-12">

        {/* ── Data flow diagram ───────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Connection model
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            Trade events in. No credentials out. No orders placed.
          </h2>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">

            {/* Node 1: Broker */}
            <div className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                Your broker account
              </p>
              <ul className="mt-3 grid gap-1.5">
                <li className="flex items-start gap-1.5 text-[11px] text-stone-600">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                  Trade fill events
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-600">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                  P&amp;L summary
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-400">
                  <span className="mt-0.5 shrink-0">✗</span>
                  No password shared
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-400">
                  <span className="mt-0.5 shrink-0">✗</span>
                  No orders placed
                </li>
              </ul>
            </div>

            {/* Arrow 1 */}
            <div className="flex items-center justify-center sm:flex-col sm:justify-center sm:px-3">
              <div className="flex items-center gap-1.5 sm:flex-col sm:gap-0.5">
                <span className="text-[10px] text-stone-400">read-only</span>
                <span className="text-stone-300 sm:text-base">→</span>
              </div>
            </div>

            {/* Node 2: Guardrail engine */}
            <div className="flex-1 rounded-2xl border border-stone-800 bg-stone-950 px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                Guardrail rule engine
              </p>
              <ul className="mt-3 grid gap-1.5">
                <li className="flex items-start gap-1.5 text-[11px] text-stone-300">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
                  Evaluates your rules
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-300">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
                  Real-time session state
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-300">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-500">✓</span>
                  Disconnect any time
                </li>
              </ul>
            </div>

            {/* Arrow 2 */}
            <div className="flex items-center justify-center sm:flex-col sm:justify-center sm:px-3">
              <div className="flex items-center gap-1.5 sm:flex-col sm:gap-0.5">
                <span className="text-[10px] text-stone-400">when rule fires</span>
                <span className="text-stone-300 sm:text-base">→</span>
              </div>
            </div>

            {/* Node 3: Action */}
            <div className="flex-1 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone-400">
                Action
              </p>
              <ul className="mt-3 grid gap-1.5">
                <li className="flex items-start gap-1.5 text-[11px] text-stone-600">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                  Telegram alert
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-600">
                  <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                  Session locked (app)
                </li>
                <li className="flex items-start gap-1.5 text-[11px] text-stone-400">
                  <span className="mt-0.5 shrink-0">→</span>
                  Broker-side: planned
                </li>
              </ul>
            </div>

          </div>
        </section>

        {/* ── Trust cards ─────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-800 bg-stone-950 p-5 sm:p-8">
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-400">
              Your data, your control
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-2xl">
              Four principles that govern how Guardrail handles your account.
            </h2>
          </div>
          <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 px-4 py-4 sm:px-5 sm:py-5">
              <p className="text-sm font-semibold text-stone-50">Read-only broker connection</p>
              <p className="mt-1.5 text-sm leading-5 text-stone-400 sm:mt-2 sm:leading-6">
                Guardrail receives trade events to evaluate your rules. In read-only mode it cannot
                place, modify, or cancel orders at the broker.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 px-4 py-4 sm:px-5 sm:py-5">
              <p className="text-sm font-semibold text-stone-50">No broker password stored</p>
              <p className="mt-1.5 text-sm leading-5 text-stone-400 sm:mt-2 sm:leading-6">
                When supported, connections use broker authorization or scoped tokens instead of
                asking for your broker password.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 px-4 py-4 sm:px-5 sm:py-5">
              <p className="text-sm font-semibold text-stone-50">You control the connection</p>
              <p className="mt-1.5 text-sm leading-5 text-stone-400 sm:mt-2 sm:leading-6">
                Disconnect your broker integration from account settings at any time. Guardrail keeps
                your rule configuration but stops receiving trade data immediately.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 px-4 py-4 sm:px-5 sm:py-5">
              <p className="text-sm font-semibold text-stone-50">Broker connection required</p>
              <p className="mt-1.5 text-sm leading-5 text-stone-400 sm:mt-2 sm:leading-6">
                Guardrail evaluates your rules against live trade events from your connected broker.
                Connect Tradovate from your account settings to enable live account monitoring.
              </p>
            </div>
          </div>
        </section>

        {/* ── What Guardrail accesses ─────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Data access
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            What Guardrail reads. What it never touches.
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                What Guardrail reads
              </p>
              <ul className="grid gap-2">
                {[
                  "Trade fill events — symbol, side, quantity, fill price, time",
                  "Account P&L summary — to calculate daily loss against your limit",
                  "Position data — open positions for rule evaluation",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700 sm:px-4 sm:py-3"
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                What Guardrail never does (read-only mode)
              </p>
              <ul className="grid gap-2">
                {[
                  "Place, modify, or cancel orders at the broker",
                  "Access your broker login password",
                  "Transfer funds or change account settings",
                  "Share your data with third parties",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 px-3 py-2 text-sm text-stone-500 sm:px-4 sm:py-3"
                  >
                    <span className="mt-0.5 shrink-0 text-stone-400">✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-stone-400">
            Broker-side order actions (cancel, flatten, block) require verified write-level API
            permissions. These are planned features and will only ship after live integration testing
            with each broker.
          </p>
        </section>

        {/* ── Broker integrations ─────────────────────────────────────── */}
        <section>
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Broker integrations
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Connect your broker account.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Guardrail starts read-only with Tradovate and only expands enforcement after verified
              broker support. All future integrations follow the same read-first pattern.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BROKERS.map((broker) => (
              <BrokerCard key={broker.name} {...broker} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-xs text-stone-400">Don&rsquo;t see your broker?</p>
            <a
              href="mailto:support@guardrail.trade"
              className="rounded-full border border-stone-300 px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-stone-500 hover:text-stone-950"
            >
              Request a broker
            </a>
          </div>
        </section>

        {!user && (
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-stone-950">
                  Start with read-only. Expand when you&rsquo;re ready.
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  First week free — no credit card required.
                </p>
              </div>
              <div className="flex flex-row flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Start free week
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
