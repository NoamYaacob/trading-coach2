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
  "Session Hours",
];

// ── GR design tokens (inline style helpers) ────────────────────────────────────
const GR = {
  ink: "var(--gr-ink)",
  textMid: "var(--gr-text-mid)",
  textMute: "var(--gr-text-mute)",
  textFaint: "var(--gr-text-faint)",
  copper: "var(--gr-copper)",
  border: "var(--gr-border)",
  borderSub: "var(--gr-border-sub)",
  surface: "var(--gr-surface)",
  surface2: "var(--gr-surface-2)",
  surfaceWarm: "var(--gr-surface-warm)",
  bgElev: "var(--gr-bg-elev)",
  ok: "var(--gr-ok)",
  okBg: "var(--gr-ok-bg)",
  bad: "var(--gr-bad)",
  badBg: "var(--gr-bad-bg)",
};

// Shared card style
const cardStyle: React.CSSProperties = {
  background: GR.surface,
  border: `1px solid ${GR.border}`,
  borderRadius: 14,
};

// Label / eyebrow
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[12px] font-semibold uppercase tracking-[0.18em]"
      style={{ color: GR.copper }}
    >
      {children}
    </p>
  );
}

export default async function Home() {
  const user = await getCurrentUser();

  const heroActions = user ? (
    <Link
      href="/dashboard"
      className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
      style={{ background: GR.ink }}
    >
      Open today&rsquo;s session
    </Link>
  ) : (
    <>
      <Link
        href="/signup"
        className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: GR.ink }}
      >
        Start free week
      </Link>
      <a
        href="#how-it-works"
        className="rounded-full border px-5 py-3 text-[14px] font-medium transition-colors hover:border-opacity-80"
        style={{ borderColor: GR.border, color: GR.textMid }}
      >
        See how it works ↓
      </a>
    </>
  );

  return (
    <AppShell
      eyebrow="For futures & prop firm traders"
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
          <span className="hidden sm:inline">Account-level monitoring · Broker enforcement when supported and verified</span>
          <span className="sm:hidden">Account-level monitoring. Broker enforcement when supported and verified.</span>
        </>
      }
      actions={heroActions}
      heroPreview={user ? undefined : <HeroStatusPreview />}
    >
      <div className="grid gap-6 pb-16">

        {/* ── Pain ─────────────────────────────────────────────────────── */}
        <section className="pt-2">
          <div className="mb-5 max-w-2xl">
            <SectionLabel>The real problem</SectionLabel>
            <h2
              className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.02em] sm:text-4xl"
              style={{ color: GR.ink, lineHeight: 1.2 }}
            >
              You know your rules.{" "}
              <span style={{ color: GR.textFaint }}>You break them anyway.</span>
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-[1.6]" style={{ color: GR.textMid }}>
              Every futures trader sets rules before the market opens. Then the session starts,
              pressure builds, and the rules you made when thinking clearly are the ones you break.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PAIN_SCENARIOS.map((s) => (
              <div key={s.title} style={cardStyle} className="p-6 sm:p-7">
                <p className="text-[18px] font-semibold leading-snug tracking-[-0.01em]" style={{ color: GR.ink }}>
                  {s.title}
                </p>
                <p className="mt-3 text-[14px] leading-[1.55]" style={{ color: GR.textMid }}>
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how-it-works" className="pt-2">
          <div className="mb-5 max-w-2xl">
            <SectionLabel>How it works</SectionLabel>
            <h2
              className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
              style={{ color: GR.ink, lineHeight: 1.2 }}
            >
              Three steps. One operating loop.
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.n} style={cardStyle} className="p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p
                    className="font-mono text-3xl font-medium leading-none tracking-[-0.02em]"
                    style={{ color: GR.textFaint }}
                  >
                    {step.n}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${step.tagCls}`}
                  >
                    {step.tag}
                  </span>
                </div>
                <h3
                  className="mt-9 text-[18px] font-semibold leading-snug tracking-[-0.01em]"
                  style={{ color: GR.ink }}
                >
                  {step.title}
                </h3>
                <p className="mt-2.5 text-[14px] leading-[1.55]" style={{ color: GR.textMid }}>
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <Link
              href="/how-it-works"
              className="text-[14px] transition-colors hover:opacity-80"
              style={{ color: GR.textMid }}
            >
              Session states and enforcement scope →
            </Link>
          </div>
        </section>

        {/* ── Rule engine ──────────────────────────────────────────────── */}
        <section className="pt-2">
          <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr] lg:items-start">
            <div>
              <SectionLabel>Rule engine</SectionLabel>
              <h2
                className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
                style={{ color: GR.ink, lineHeight: 1.2 }}
              >
                Four active rules. Ten more on the way.
              </h2>
              <p className="mt-4 text-[15px] leading-[1.6]" style={{ color: GR.textMid, maxWidth: 580 }}>
                Loss limits, trade caps, session windows, and news locks — evaluated in real time
                against every trade event.
              </p>
              <div className="mt-8 grid gap-2 sm:grid-cols-2">
                {ACTIVE_RULE_NAMES.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      background: GR.surface,
                      border: `1px solid ${GR.border}`,
                      borderRadius: 14,
                    }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: GR.ok }}
                      aria-hidden
                    />
                    <span className="text-[14.5px] font-medium" style={{ color: GR.ink }}>
                      {name}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <Link
                  href="/features"
                  className="text-[14px] transition-opacity hover:opacity-70"
                  style={{ color: GR.textMid }}
                >
                  View all 14 rules — Active, Partial, and Coming Soon →
                </Link>
              </div>
            </div>

            {/* Trading plan card */}
            <div className="hidden lg:block">
              <RulesConfigCard />
            </div>
          </div>
        </section>

        {/* ── Prop firm ─────────────────────────────────────────────────── */}
        <section
          className="rounded-[14px] p-8 sm:p-10"
          style={{
            background: GR.surfaceWarm,
            border: `1px solid rgba(162,61,16,0.30)`,
          }}
        >
          <div className="mb-6 max-w-2xl">
            <SectionLabel>Prop firm pressure</SectionLabel>
            <h2
              className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
              style={{ color: GR.ink, lineHeight: 1.2 }}
            >
              Prop firm rules do not forgive emotional trades.
            </h2>
            <p className="mt-4 text-[15px] leading-[1.6]" style={{ color: GR.textMid }}>
              One rule break can cost the challenge, the funded account, or the payout.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PROP_FIRM_CARDS.map((card) => (
              <div
                key={card.title}
                className="p-6"
                style={{
                  background: GR.surface,
                  border: `1px solid ${GR.border}`,
                  borderRadius: 14,
                }}
              >
                <p className="text-[17px] font-semibold leading-snug" style={{ color: GR.ink }}>
                  {card.title}
                </p>
                <p className="mt-3 text-[14px] leading-[1.55]" style={{ color: GR.textMid }}>
                  {card.body}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <Link
              href="/prop-firms"
              className="text-[14px] font-medium transition-opacity hover:opacity-70"
              style={{ color: GR.copper }}
            >
              Built for prop firms: evaluation, funded, and payout protection →
            </Link>
          </div>
        </section>

        {/* ── Trust / security ──────────────────────────────────────────── */}
        <section
          className="rounded-[14px] p-8 sm:p-10"
          style={{ background: GR.ink, color: "var(--gr-bg)" }}
        >
          <SectionLabel>
            <span style={{ color: "rgba(255,255,255,0.55)" }}>Your data, your control</span>
          </SectionLabel>
          <h2
            className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
            style={{ color: "var(--gr-bg)", lineHeight: 1.2 }}
          >
            Read-only first. No trading credentials.
          </h2>
          <ul className="mt-8 grid gap-4 max-w-[920px]">
            {[
              "Read-only connection — Guardrail receives trade events. It cannot place or cancel orders.",
              "No broker password stored — connections use broker authorization or scoped tokens.",
              "Disconnect any time from account settings. Rule configuration is kept, data is not.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px]" style={{ color: "rgba(255,255,255,0.92)" }}>
                <span className="mt-0.5 shrink-0 text-lg font-bold leading-none" style={{ color: GR.ok }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-7">
            <Link
              href="/security"
              className="text-[14px] transition-opacity hover:opacity-80"
              style={{ color: "rgba(255,255,255,0.55)" }}
            >
              Security &amp; read-only access details →
            </Link>
          </div>
        </section>

        {/* ── Pricing preview ───────────────────────────────────────────── */}
        <section
          className="rounded-[14px] p-8 sm:p-10"
          style={{
            background: GR.surface,
            border: `1px solid ${GR.border}`,
          }}
        >
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <div>
              <SectionLabel>Pricing</SectionLabel>
              <h2
                className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
                style={{ color: GR.ink, lineHeight: 1.2 }}
              >
                First week free.
              </h2>
              <p className="mt-4 text-[15px] leading-[1.6]" style={{ color: GR.textMid }}>
                Full access for 7 days — no credit card required. Then $25/month.
              </p>
              <div className="mt-6 flex items-baseline gap-2.5">
                <span
                  className="font-mono text-5xl font-semibold leading-none tracking-[-0.03em]"
                  style={{ color: GR.ink }}
                >
                  $25
                </span>
                <span className="text-[14px]" style={{ color: GR.textMute }}>
                  / month after trial
                </span>
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: GR.textMute }}>
                Billed monthly. Cancel any time.
              </p>
              <div className="mt-7 flex flex-row flex-wrap gap-3">
                {user ? (
                  <Link
                    href="/dashboard"
                    className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                    style={{ background: GR.ink }}
                  >
                    Open today&rsquo;s session
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                      style={{ background: GR.ink }}
                    >
                      Start free week
                    </Link>
                    <Link
                      href="/pricing"
                      className="rounded-full border px-5 py-3 text-[14px] font-medium transition-colors"
                      style={{ borderColor: GR.border, color: GR.textMid }}
                    >
                      See pricing details
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: GR.ink }}>
                Included:
              </p>
              <ul className="mt-4 grid gap-2">
                {INCLUDED_FEATURES.slice(0, 4).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-[10px] px-3 py-3 text-[14px]"
                    style={{
                      background: GR.bgElev,
                      color: GR.ink,
                    }}
                  >
                    <span className="mt-0.5 shrink-0 font-bold leading-none" style={{ color: GR.ok }}>
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/pricing"
                className="mt-4 block text-[13.5px] transition-opacity hover:opacity-70"
                style={{ color: GR.textMute }}
              >
                All included features &amp; cost calculator →
              </Link>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section id="faq" className="pt-2">
          <div className="mb-5">
            <SectionLabel>FAQ</SectionLabel>
            <h2
              className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl"
              style={{ color: GR.ink, lineHeight: 1.2 }}
            >
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
                className="group cursor-pointer rounded-[14px] border px-6 py-4 transition-colors"
                style={{
                  background: GR.surface,
                  borderColor: GR.border,
                }}
              >
                <summary className="flex list-none items-center justify-between gap-4 text-[16px] font-medium leading-snug tracking-[-0.01em]" style={{ color: GR.ink }}>
                  {faq.q}
                  <span
                    className="shrink-0 text-xl font-light transition-transform group-open:rotate-45"
                    style={{ color: GR.textMute }}
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 text-[14px] leading-[1.6]" style={{ color: GR.textMid }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
          <div className="mt-5">
            <Link
              href="/faq"
              className="text-[14px] transition-opacity hover:opacity-70"
              style={{ color: GR.textMid }}
            >
              Read all {FAQS.length} questions →
            </Link>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────── */}
        <section
          className="rounded-[14px] p-8 sm:p-10"
          style={{
            background: GR.surface,
            border: `1px solid ${GR.border}`,
          }}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2
                className="text-3xl font-semibold leading-snug tracking-[-0.02em]"
                style={{ color: GR.ink, lineHeight: 1.15 }}
              >
                Your rules, enforced. Starting now.
              </h2>
              <p className="mt-3 text-[15px] leading-[1.6]" style={{ color: GR.textMid }}>
                Configure your limits. Run today&rsquo;s session. Let Guardrail lock the moment a
                rule breaks.
              </p>
            </div>
            <div className="flex flex-row flex-wrap gap-3">
              {user ? (
                <Link
                  href="/dashboard"
                  className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: GR.ink }}
                >
                  Open today&rsquo;s session
                </Link>
              ) : (
                <>
                  <Link
                    href="/signup"
                    className="rounded-full px-5 py-3 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
                    style={{ background: GR.ink }}
                  >
                    Start free week
                  </Link>
                  <Link
                    href="/login"
                    className="rounded-full border px-5 py-3 text-[14px] font-medium transition-colors"
                    style={{ borderColor: GR.border, color: GR.textMid }}
                  >
                    Log in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── Risk disclaimer ────────────────────────────────────────── */}
        <p className="pb-2 text-center text-[11.5px] leading-relaxed" style={{ color: "var(--gr-text-faint)" }}>
          Guardrail is a trading-discipline and risk-control tool, not financial advice. Guardrail
          starts in monitoring mode; broker-side enforcement applies only to Daily Loss, only on
          supported connections, and only when you explicitly enable it. Trading futures carries a
          substantial risk of loss.
        </p>

      </div>
    </AppShell>
  );
}

// ─── Rule engine config card ───────────────────────────────────────────────────

function RulesConfigCard() {
  return (
    <div
      className="rounded-[14px] border p-5"
      style={{
        background: "var(--gr-surface)",
        borderColor: "var(--gr-border)",
        width: 224,
      }}
    >
      <p
        className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em]"
        style={{ color: "var(--gr-text-mute)" }}
      >
        Trading plan
      </p>
      <div className="grid gap-0">
        {[
          { rule: "Daily loss limit", value: "$500" },
          { rule: "Max trades", value: "5 / day" },
          { rule: "Loss streak stop", value: "3 losses" },
          { rule: "Session hours", value: "9:30 – 12:00" },
        ].map(({ rule, value }, i, arr) => (
          <div
            key={rule}
            className="flex items-center justify-between gap-2 py-3"
            style={{
              borderBottom: i < arr.length - 1 ? `1px solid var(--gr-border-sub)` : undefined,
            }}
          >
            <span className="text-[13px]" style={{ color: "var(--gr-text-mid)" }}>
              {rule}
            </span>
            <span
              className="shrink-0 font-mono text-[13px] font-semibold"
              style={{ color: "var(--gr-ink)" }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex items-center gap-1.5 border-t pt-3"
        style={{ borderColor: "var(--gr-border-sub)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--gr-ok)" }}
          aria-hidden
        />
        <span className="text-[11.5px]" style={{ color: "var(--gr-text-mute)" }}>
          4 rules active · session live
        </span>
      </div>
    </div>
  );
}

// ─── Hero locked-state preview ─────────────────────────────────────────────────

function HeroStatusPreview() {
  return (
    <div
      className="w-full rounded-[14px] border p-4 lg:w-64"
      style={{
        background: "var(--gr-surface)",
        borderColor: "var(--gr-bad-bd, rgba(167,45,31,0.30))",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.2em]"
          style={{ color: "var(--gr-text-mute)" }}
        >
          Today&rsquo;s session
        </p>
        <span
          className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{
            background: "var(--gr-bad-bg)",
            color: "var(--gr-bad)",
            border: "1px solid var(--gr-bad-bd)",
          }}
        >
          Locked
        </span>
      </div>
      <p className="mb-1 text-[14px] font-semibold" style={{ color: "var(--gr-ink)" }}>
        Session locked
      </p>
      <p className="mb-3 text-[11.5px]" style={{ color: "var(--gr-bad)" }}>
        Daily loss limit reached
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 flex justify-between text-[11px]" style={{ color: "var(--gr-text-mute)" }}>
            <span>Loss used</span>
            <span className="font-semibold" style={{ color: "var(--gr-bad)" }}>$500 / $500</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--gr-bad-bg)" }}
          >
            <div className="h-full w-full rounded-full" style={{ background: "var(--gr-bad)" }} />
          </div>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-[11px]" style={{ color: "var(--gr-text-mute)" }}>
            <span>Trades</span>
            <span>5 / 5</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full"
            style={{ background: "var(--gr-surface-2)" }}
          >
            <div className="h-full w-full rounded-full" style={{ background: "var(--gr-text-mute)" }} />
          </div>
        </div>
      </div>
      <div
        className="mt-3 flex items-center justify-between border-t pt-3"
        style={{ borderColor: "var(--gr-border-sub)" }}
      >
        <p className="text-[10.5px]" style={{ color: "var(--gr-text-mute)" }}>
          Next reset: tomorrow
        </p>
        <span
          className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{
            background: "var(--gr-surface-2)",
            color: "var(--gr-text-mid)",
          }}
        >
          New entries disabled
        </span>
      </div>
    </div>
  );
}
