import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Guardrail — Trading rules that hold under pressure",
  description:
    "Set your rules before the session. Guardrail enforces them when discipline fades.",
};

const steps = [
  {
    n: "01",
    tag: "Premarket",
    tagCls: "bg-stone-100 text-stone-600",
    title: "Set your rules",
    detail: "Daily loss, max trades, loss-streak stop, session hours.",
  },
  {
    n: "02",
    tag: "Live",
    tagCls: "bg-emerald-100 text-emerald-700",
    title: "Track live status",
    detail: "Allowed, Warning, or Locked — evaluated as trades land.",
  },
  {
    n: "03",
    tag: "Locked",
    tagCls: "bg-red-100 text-red-700",
    title: "Stop when limits hit",
    detail: "The session locks the moment a rule is breached.",
  },
];

const includedFeatures = [
  "Pre-session rules — daily loss, trade count, loss-streak stop, session hours",
  "Live session status — Allowed, Warning, or Locked",
  "Tradovate broker connection — live risk evaluation from real trades",
  "Manual journal — test Guardrail before your broker is connected",
  "Optional Telegram alerts when a limit triggers",
];

const faqs = [
  {
    q: "What if I haven't connected a broker yet?",
    a: "The manual journal lets you test Guardrail before your broker is connected — log trades and the same rule engine evaluates Allowed / Warning / Locked. Live enforcement against real trades requires a Tradovate connection, which is the core product path.",
  },
  {
    q: "Does Guardrail block my trades at the broker?",
    a: "Not today. The session locks inside the app — you see a lockout banner and (optionally) a Telegram alert. Broker order cancel/flatten requires verified broker support, which we ship per broker only after live verification.",
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
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
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
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
      >
        Log in
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="For futures & intraday traders"
      title={
        <>
          Set your rules.
          <br />
          Stop when they break.
        </>
      }
      description="Live session status for disciplined traders — Allowed, Warning, or Locked."
      actions={heroActions}
    >
      <div className="grid gap-10 lg:gap-16">

        {/* ── How it works — 3 steps with status tags ──────────────────── */}
        <section>
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              How it works
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              Three steps. One operating loop.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.n}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-6 py-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-2xl font-bold text-stone-200">{step.n}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${step.tagCls}`}
                  >
                    {step.tag}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-stone-950 leading-6">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Live session preview ──────────────────────────────────────── */}
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Live session preview
          </p>

          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-4 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.18)] sm:p-6 lg:p-8">
            {/* Top row — timestamp + status pill */}
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-stone-400">
                  Today · 11:42 AM
                </p>
                <p className="mt-2 text-xl font-semibold tracking-[-0.03em] text-stone-950">
                  Trading is open — limits are close.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                Warning
              </span>
            </div>

            {/* Tiles */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Trades" value="2 / 5" sub="3 remaining" />
              <Tile label="P&L today" value="−$120" sub="Limit −$500" tone="warning" />
              <Tile label="Loss streak" value="1" sub="Stop after 3" />
            </div>

            {/* Lifecycle indicator */}
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              <StatusChip label="Allowed" tone="muted" />
              <span className="text-stone-300" aria-hidden>›</span>
              <StatusChip label="Warning" tone="active" />
              <span className="text-stone-300" aria-hidden>›</span>
              <StatusChip label="Locked" tone="muted" />
            </div>

            {/* Inline note */}
            <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800">
              <span className="font-medium text-amber-900">Approaching daily loss limit.</span>{" "}
              Consider stopping early.
            </p>
          </div>
        </section>

        {/* ── Value sentence + Pricing ──────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.22)] sm:p-8 lg:p-10">
          <p className="mb-8 max-w-2xl text-base leading-7 text-stone-600">
            <span className="font-semibold text-stone-950">
              Built for active intraday traders
            </span>{" "}
            who need hard limits, not more willpower.
          </p>

          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Pricing
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
                Start your free trial.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Full access during your trial. Configure your rules, run your first session, and link Telegram. No credit card required.
              </p>
              <div className="mt-6 flex items-baseline gap-2 sm:mt-8">
                <span className="text-4xl font-bold tracking-[-0.04em] text-stone-950 sm:text-5xl">$49</span>
                <span className="text-base text-stone-500">/ month</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <div className="mt-6 flex flex-col items-start gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
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
                      className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
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
          <div className="mb-5 sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              FAQ
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              Common questions.
            </h2>
          </div>
          <div className="grid gap-3">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-2xl border border-stone-200 bg-white/90 px-6 py-4 transition-colors hover:bg-stone-50/60"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold tracking-[-0.02em] text-stone-950">
                  {faq.q}
                  <span className="shrink-0 text-stone-500 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final CTA ──────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
                Your next session, under real protection.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Configure your rules. Run today&rsquo;s session. Stay within your limits.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
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

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warning";
}) {
  const valueCls = tone === "warning" ? "text-amber-700" : "text-stone-950";
  return (
    <div className="rounded-2xl bg-stone-50 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueCls}`}>{value}</p>
      <p className="mt-1 text-xs text-stone-500">{sub}</p>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "muted" | "active" }) {
  const cls =
    tone === "active"
      ? "border-amber-300 bg-amber-100 text-amber-800"
      : "border-stone-200 bg-stone-50 text-stone-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${cls}`}
    >
      {tone === "active" && (
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
      )}
      {label}
    </span>
  );
}
