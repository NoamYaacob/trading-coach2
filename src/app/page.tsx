import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Guardrail — Trading rules that hold under pressure",
  description:
    "Build your rules before the session. Guardrail helps you stick to them during it.",
};

const steps = [
  {
    n: "01",
    title: "Set your rules",
    detail: "Daily loss, max trades, consecutive-loss stop, session hours.",
  },
  {
    n: "02",
    title: "Track the session",
    detail: "Allowed, Warning, or Locked — evaluated as trades land.",
  },
  {
    n: "03",
    title: "Stop when limits hit",
    detail: "The session locks the moment a rule is breached.",
  },
];

const includedFeatures = [
  "Pre-session rules — daily loss, trade count, loss-streak stop, session hours",
  "Live session status — Allowed, Warning, or Locked",
  "Manual trade journal — log trades and risk state updates instantly",
  "Optional Telegram alerts when a limit triggers",
  "Broker connection — verify your Tradovate account when ready",
];

const faqs = [
  {
    q: "Does Guardrail block my trades at the broker?",
    a: "Not today. The session locks inside the app — you see a lockout banner and (optionally) a Telegram alert. Cancelling orders or flattening positions at the broker requires verified broker support, which we ship per broker only after live verification.",
  },
  {
    q: "What if I haven't connected a broker yet?",
    a: "You can use Guardrail's manual fallback. Log each trade in the journal and the same engine evaluates Allowed / Warning / Locked. The lock applies inside the app — it does not prevent orders at your broker.",
  },
  {
    q: "Which brokers are supported?",
    a: "Tradovate is the first integration. Read-only connection is being prepared and will activate once verified against your account.",
  },
  {
    q: "How does Telegram fit in?",
    a: "Telegram is an optional alert channel. When connected, Guardrail sends session state changes and lockout messages to your Telegram. Everything works without it.",
  },
  {
    q: "What happens during a lockout?",
    a: "The session moves to Locked, a banner explains which rule fired, and the reset window opens at the start of the next trading day.",
  },
  {
    q: "Who is this for?",
    a: "Active intraday traders — primarily futures traders on funded or evaluation accounts — who want a system that holds them to their own rules.",
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
        Start free trial
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
      eyebrow="Guardrail"
      title="Build your rules before the session. Follow them during it."
      description="Guardrail turns your trading rules into live session status — Allowed, Warning, or Locked — so one bad trade doesn't become a bad day."
      actions={heroActions}
    >
      <div className="grid gap-16">

        {/* ── How it works — 3 simple steps ─────────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Three steps. One operating loop.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.n}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-6 py-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)]"
              >
                <p className="font-mono text-2xl font-bold text-stone-200">{step.n}</p>
                <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Product preview — control center ───────────────────────────── */}
        <section>
          <div className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Product
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              One view of your trading day.
            </h2>
            <p className="mt-3 text-base leading-7 text-stone-600">
              Trading permission, today&rsquo;s P&amp;L, trades remaining, and risk budget — at a glance.
            </p>
          </div>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-8 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.2)]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Today
                </p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-stone-950">
                  Trading is open.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                Allowed
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Tile label="Trades today" value="2" sub="of 5" />
              <Tile label="P&L today" value="−$120" sub="Limit: −$500" tone="loss" />
              <Tile label="Loss streak" value="1" sub="Stop after 3" />
              <Tile label="Status" value="Allowed" sub="All limits clear" tone="ok" />
            </div>

            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                Warning
              </p>
              <p className="mt-1 text-sm font-medium text-stone-900">
                Approaching the daily loss limit. Consider stopping early.
              </p>
            </div>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────────── */}
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
                Full access during your trial. Configure your rules, run your first session, and link Telegram. No credit card required.
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
                      Start free trial
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
              <p className="mb-4 text-sm font-semibold text-stone-950">Included:</p>
              <ul className="grid gap-2.5">
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

        {/* ── FAQ ────────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              FAQ
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
              Common questions.
            </h2>
          </div>
          <div className="grid gap-3">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-2xl border border-stone-200 bg-white/90 px-6 py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold tracking-[-0.02em] text-stone-950">
                  {faq.q}
                  <span className="shrink-0 text-stone-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-8 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                Your next session, under real protection.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Configure your rules. Run today&rsquo;s session. Stay within your limits.
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
                    Start free trial
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

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "ok" | "loss";
}) {
  const valueCls =
    tone === "loss" ? "text-red-700" : tone === "ok" ? "text-stone-950" : "text-stone-950";
  return (
    <div className="rounded-2xl bg-stone-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${valueCls}`}>{value}</p>
      <p className="mt-1 text-xs text-stone-500">{sub}</p>
    </div>
  );
}
