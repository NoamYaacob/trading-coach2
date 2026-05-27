import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { STEPS, ENFORCEMENT_NOW, ENFORCEMENT_PLANNED, BROKERS } from "@/lib/marketing-data";
import { BrokerCard } from "@/components/landing/broker-card";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "Learn how Guardrail evaluates your rules in real time and locks the session when a limit is hit.",
};

export default async function HowItWorksPage() {
  const user = await getCurrentUser();

  const actions = user ? (
    <Link
      href="/dashboard"
      className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
      style={{ background: "var(--gr-ink)" }}
    >
      Open today&rsquo;s session
    </Link>
  ) : (
    <>
      <Link
        href="/signup"
        className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: "var(--gr-ink)" }}
      >
        Start free week
      </Link>
      <Link
        href="/features"
        className="rounded-full border px-5 py-3 text-sm font-medium transition hover:opacity-80"
        style={{ borderColor: "var(--gr-border-hi)", color: "var(--gr-text-mid)" }}
      >
        View all features
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="HOW IT WORKS"
      title="Three steps. One operating loop."
      description="Set your rules before the open. Guardrail evaluates every trade in real time and locks the session when a limit is hit — so you don't have to."
      actions={actions}
    >
      <div className="grid gap-8 sm:gap-12">

        {/* ── Steps ──────────────────────────────────────────────────── */}
        <section>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="rounded-[14px] border px-4 py-4 sm:px-6 sm:py-6"
                style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-2xl font-bold" style={{ color: "var(--gr-border-hi)" }}>{step.n}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${step.tagCls}`}
                  >
                    {step.tag}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold leading-6 tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Session state explanation ───────────────────────────────── */}
        <section
          className="rounded-[14px] border p-5 sm:p-8"
          style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
            Session states
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] sm:text-2xl" style={{ color: "var(--gr-ink)" }}>
            Allowed. Warning. Locked.
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
            Every session moves through three states as trades accumulate against your rules.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch">

            {/* Allowed */}
            <div className="flex-1 rounded-2xl border border-emerald-200/70 bg-emerald-50/40 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                  <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Allowed</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  Active
                </span>
              </div>
              <div className="rounded-xl border border-emerald-100/80 bg-white/70 px-3 py-3">
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>Trades</span>
                  <span className="font-semibold" style={{ color: "var(--gr-ink)" }}>2 / 5</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--gr-border)" }}>
                  <div className="h-full w-2/5 rounded-full bg-emerald-400" />
                </div>
                <div className="mt-2 flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>P&amp;L today</span>
                  <span className="font-semibold text-emerald-700">+$80</span>
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-4" style={{ color: "var(--gr-text-mid)" }}>
                Rules within limits. Session continues normally.
              </p>
            </div>

            {/* Arrow — desktop only */}
            <div className="hidden sm:flex sm:items-center sm:px-1" aria-hidden>
              <span style={{ color: "var(--gr-border-hi)" }}>→</span>
            </div>

            {/* Warning */}
            <div className="flex-1 rounded-2xl border border-amber-200/70 bg-amber-50/40 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                  <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Warning</p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Alert sent
                </span>
              </div>
              <div className="rounded-xl border border-amber-100/80 bg-white/70 px-3 py-3">
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>Trades</span>
                  <span className="font-semibold" style={{ color: "var(--gr-ink)" }}>4 / 5</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--gr-border)" }}>
                  <div className="h-full w-4/5 rounded-full bg-amber-400" />
                </div>
                <div className="mt-2 flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>P&amp;L today</span>
                  <span className="font-semibold text-amber-700">−$380</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: "var(--gr-border)" }}>
                  <div className="h-full w-[76%] rounded-full bg-amber-400" />
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-amber-800">
                Approaching daily loss limit. Flagged before a breach.
              </p>
            </div>

            {/* Arrow — desktop only */}
            <div className="hidden sm:flex sm:items-center sm:px-1" aria-hidden>
              <span style={{ color: "var(--gr-border-hi)" }}>→</span>
            </div>

            {/* Locked */}
            <div className="flex-1 rounded-2xl border border-red-200/70 bg-red-50/40 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
                  <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Locked</p>
                </div>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  Locked
                </span>
              </div>
              <div className="rounded-xl border border-red-100/80 bg-white/70 px-3 py-3">
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>Trades</span>
                  <span className="font-semibold" style={{ color: "var(--gr-ink)" }}>5 / 5</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-red-100">
                  <div className="h-full w-full rounded-full bg-red-500" />
                </div>
                <div className="mt-2 flex justify-between text-[11px]">
                  <span style={{ color: "var(--gr-text-mute)" }}>P&amp;L today</span>
                  <span className="font-semibold text-red-700">−$500</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-red-100">
                  <div className="h-full w-full rounded-full bg-red-500" />
                </div>
              </div>
              <p className="mt-3 text-[11px] leading-4 text-red-800">
                Limit crossed. Session locked inside the app.
              </p>
            </div>

          </div>
        </section>

        {/* ── Live session preview ────────────────────────────────────── */}
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
            Live session preview
          </p>
          <div
            className="rounded-[14px] border p-4 sm:p-6 lg:p-8"
            style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.22em]" style={{ color: "var(--gr-text-mute)" }}>
                  Today · 11:42 AM
                </p>
                <p className="mt-2 text-xl font-semibold tracking-[-0.03em]" style={{ color: "var(--gr-ink)" }}>
                  Guardrail shows the session state before it turns into damage.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                Warning
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Trades" value="2 / 5" sub="3 remaining" />
              <Tile label="P&L today" value="−$120" sub="Limit −$500" tone="warning" />
              <Tile label="Loss streak" value="1" sub="Stop after 3" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              <StatusChip label="Allowed" tone="muted" />
              <span style={{ color: "var(--gr-border-hi)" }} aria-hidden>›</span>
              <StatusChip label="Warning" tone="active" />
              <span style={{ color: "var(--gr-border-hi)" }} aria-hidden>›</span>
              <StatusChip label="Locked" tone="muted" />
            </div>
            <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" style={{ color: "var(--gr-ink)" }}>
              <span className="font-medium text-amber-900">Approaching daily loss limit.</span>{" "}
              Consider stopping early.
            </p>
          </div>
        </section>

        {/* ── Enforcement scope ───────────────────────────────────────── */}
        <section
          className="rounded-[14px] border p-5 sm:p-8"
          style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
        >
          <div className="mb-5 sm:mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
              Enforcement scope
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] sm:text-2xl" style={{ color: "var(--gr-ink)" }}>
              What Guardrail does today. What&rsquo;s coming.
            </h2>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
              We only ship broker-side enforcement after live verification with each integration. Until
              then, the lock is app-level.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--gr-text-mid)" }}>
                Enforced today
              </p>
              <ul className="grid gap-2">
                {ENFORCEMENT_NOW.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl px-3 py-2 text-sm sm:px-4 sm:py-3"
                    style={{ background: "var(--gr-bg-elev)", color: "var(--gr-text-mid)" }}
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--gr-text-mute)" }}>
                Planned after broker verification
              </p>
              <ul className="grid gap-2">
                {ENFORCEMENT_PLANNED.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border px-3 py-2 text-sm sm:px-4 sm:py-3"
                    style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)" }}
                  >
                    <span className="mt-0.5 shrink-0" style={{ color: "var(--gr-text-mute)" }}>→</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5" style={{ color: "var(--gr-text-mute)" }}>
                Broker-side actions require verified write-level permissions. We only ship them after
                live integration testing.
              </p>
            </div>
          </div>
        </section>

        {/* ── Broker integrations ─────────────────────────────────────── */}
        <section>
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
              Broker integrations
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] sm:text-2xl" style={{ color: "var(--gr-ink)" }}>
              Connect your broker account.
            </h2>
            <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
              Start with Tradovate. Guardrail starts read-only, evaluates trade events against your
              rules, and only expands enforcement after verified broker support.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BROKERS.map((broker) => (
              <BrokerCard key={broker.name} {...broker} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-xs" style={{ color: "var(--gr-text-mute)" }}>Don&rsquo;t see your broker?</p>
            <a
              href="mailto:support@guardrail.trade"
              className="rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-80"
              style={{ borderColor: "var(--gr-border-hi)", color: "var(--gr-text-mid)" }}
            >
              Request a broker
            </a>
          </div>
        </section>

        {!user && (
          <section
            className="rounded-[14px] border p-5 sm:p-8"
            style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em]" style={{ color: "var(--gr-ink)" }}>
                  Ready to run your first session?
                </h2>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
                  First week free — no credit card required.
                </p>
              </div>
              <div className="flex flex-row flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ background: "var(--gr-ink)" }}
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

// ─── Local helpers ─────────────────────────────────────────────────────────────

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
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: "var(--gr-bg-elev)" }}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-text-mute)" }}>{label}</p>
      <p
        className="mt-2 text-2xl font-bold tabular-nums"
        style={{ color: tone === "warning" ? "var(--gr-warn)" : "var(--gr-ink)" }}
      >
        {value}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--gr-text-mute)" }}>{sub}</p>
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "muted" | "active" }) {
  if (tone === "active") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-800"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{ borderColor: "var(--gr-border)", background: "var(--gr-bg-elev)", color: "var(--gr-text-mute)" }}
    >
      {label}
    </span>
  );
}
