import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Guardrail — Trading rules that hold under pressure",
  description:
    "Set your rules before the session. Guardrail enforces them when discipline fades.",
};

// ─── Data ──────────────────────────────────────────────────────────────────────

const PAIN_SCENARIOS = [
  {
    title: "The revenge trade",
    body: "Down $180. Your daily limit is $200. You size up on the next entry to recover. It stops out. Now you're at $580 — nearly three times your limit.",
  },
  {
    title: "The one more trade",
    body: "You've hit your 5-trade cap. The market looks perfect. You take one more. Then another. The trade limit was a preference, not a stop.",
  },
  {
    title: "The oversized entry",
    body: "High conviction. You triple your normal size. It misses. One trade wipes out three days of discipline. Your daily loss limit is gone before lunch.",
  },
];

const STEPS = [
  {
    n: "01",
    tag: "Premarket",
    tagCls: "bg-stone-100 text-stone-600",
    title: "Set your trading plan",
    detail:
      "Daily loss limit, max trades, session hours, loss-streak stop. Set them once before the open. Guardrail holds them across every session.",
  },
  {
    n: "02",
    tag: "Live",
    tagCls: "bg-emerald-100 text-emerald-700",
    title: "Trade with live rule monitoring",
    detail:
      "Every trade event is evaluated against your rules. You see Allowed, Warning, or Locked — before the damage compounds.",
  },
  {
    n: "03",
    tag: "Locked",
    tagCls: "bg-red-100 text-red-700",
    title: "Session locks when a rule breaks",
    detail:
      "When a limit is hit, the session locks inside the app. You see which rule fired and when the reset window opens. App-level enforcement today.",
  },
];

type RuleBadge = "active" | "partial" | "coming-soon";

const RULES: Array<{ name: string; description: string; badge: RuleBadge }> = [
  {
    name: "Daily Loss Limit",
    description: "When today's P&L crosses your limit, the session locks immediately.",
    badge: "active",
  },
  {
    name: "Max Trades Per Day",
    description: "Hit your trade count and the session stops — regardless of what the market looks like.",
    badge: "active",
  },
  {
    name: "Stop After Consecutive Losses",
    description: "Three red trades in a row? Guardrail stops you before the fourth.",
    badge: "active",
  },
  {
    name: "News Blackout",
    description: "Block or warn before major economic events — FOMC, NFP, CPI.",
    badge: "active",
  },
  {
    name: "Session Hours",
    description: "Define your trading window. Rules are only evaluated during those hours.",
    badge: "active",
  },
  {
    name: "Daily Profit Target",
    description: "Lock in a good day. Session stops when you hit your target.",
    badge: "partial",
  },
  {
    name: "Risk Per Trade",
    description: "Flag entries that risk more than your per-trade limit.",
    badge: "partial",
  },
  {
    name: "Allowed Trading Days",
    description: "Set which days of the week you trade. Evaluation skips blocked days.",
    badge: "partial",
  },
  {
    name: "Max Contracts / Order Size",
    description: "Cap the position size per entry.",
    badge: "coming-soon",
  },
  {
    name: "Weekly Loss Limit",
    description: "Stop trading for the week once cumulative losses cross your limit.",
    badge: "coming-soon",
  },
  {
    name: "Weekly Profit Limit",
    description: "Protect a strong week by locking trading once you hit a weekly target.",
    badge: "coming-soon",
  },
  {
    name: "Cooldown Period",
    description: "Mandatory pause after a loss before the next entry is allowed.",
    badge: "coming-soon",
  },
  {
    name: "Entry Checklist",
    description: "Confirm your pre-trade conditions are met before each entry.",
    badge: "coming-soon",
  },
];

const ENFORCEMENT_NOW = [
  "App-level session lock when a rule breaks",
  "Rule evaluation against broker or manual trade data",
  "Telegram lockout alerts — optional, immediate",
  "Manual Mode — full rule engine without a broker connection",
  "Broker-connected read-only mode — live trade events from Tradovate",
];

const ENFORCEMENT_PLANNED = [
  "Cancel open orders on rule breach",
  "Flatten positions on rule breach",
  "Broker-side order blocking",
  "Additional broker integrations",
];

const BROKERS: Array<{ name: string; status: "live" | "planned"; description?: string }> = [
  {
    name: "Tradovate",
    status: "live",
    description:
      "First integration. Read-only webhook connection — trade events evaluated against your rules in real time.",
  },
  { name: "Rithmic", status: "planned", description: "Planned after Tradovate verification." },
  { name: "NinjaTrader", status: "planned", description: "Planned after Tradovate verification." },
  { name: "Interactive Brokers", status: "planned", description: "Planned after Tradovate verification." },
];

const INCLUDED_FEATURES = [
  "Live rule evaluation — Allowed, Warning, or Locked",
  "Daily loss limit, max trades, loss-streak stop, session hours",
  "Tradovate read-only connection — trade events vs. your rules",
  "Manual Mode — full rule engine before broker connection",
  "Telegram alerts when a limit triggers",
];

const FAQS = [
  {
    q: "Does Guardrail block my broker orders?",
    a: "Not yet. Today the session locks inside Guardrail — if Telegram is connected, you get an alert immediately. Nothing happens at the broker. Broker-side order cancellation and position flattening are planned and will only ship after live verification with each integration.",
  },
  {
    q: "What happens when a rule is hit?",
    a: "The session moves to Locked. A banner shows which rule fired and when the reset window opens — by default, the start of the next trading day. If Telegram is connected, you receive an alert immediately. Nothing happens at the broker level.",
  },
  {
    q: "Does it work for prop firm evaluation and funded accounts?",
    a: "Yes. Guardrail is built for futures traders on funded and evaluation accounts where a single bad day can end the account. It supports evaluation, funded, personal, and demo account types and is designed around typical prop firm daily loss and trade count constraints.",
  },
  {
    q: "What if I haven't connected a broker yet?",
    a: "Manual Mode lets you use Guardrail before a broker is connected. Log trades yourself and the same rule engine evaluates Allowed / Warning / Locked based on your entries. It's the best way to test your rule setup before going live.",
  },
  {
    q: "Which brokers are supported? Is the connection read-only?",
    a: "Tradovate is the first integration — read-only webhook connection. Guardrail receives trade events to evaluate your rules in real time. It cannot place, modify, or cancel orders. Rithmic, NinjaTrader, and Interactive Brokers are planned. Connect Tradovate from your account settings.",
  },
  {
    q: "Can I change my rules during a trading day?",
    a: "You can edit rules at any time — there's no automatic lock during active sessions today. We recommend setting your rules before the open and treating them as final until the day ends. Session-based rule locking is on the roadmap.",
  },
  {
    q: "How does Telegram fit in?",
    a: "Telegram is an optional alert channel. When connected, Guardrail sends lockout and warning alerts directly to your phone. Everything works without it — Telegram is an add-on for traders who want immediate mobile alerts.",
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

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
        Start free trial
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
          You know your limits.
          <br />
          Guardrail holds you to them.
        </>
      }
      description="Set your daily loss, max trades, and session rules before the market opens. When a rule breaks, Guardrail locks the session and alerts you immediately."
      note="App-level lock today · Broker-connected read-only mode · Broker-side enforcement planned after verification"
      actions={heroActions}
      heroPreview={user ? undefined : <HeroStatusPreview />}
    >
      <div className="grid gap-12 lg:gap-16">

        {/* ── Pain ─────────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-6 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              The real problem
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              You know your rules.{" "}
              <span className="text-stone-400">You break them anyway.</span>
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-600">
              Every futures trader sets rules before the market opens — daily loss limit, max trades, no revenge trading. Then the session starts. A losing trade creates pressure to recover. A strong setup creates temptation to size up. The rules you made when thinking clearly are the ones you break under pressure.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PAIN_SCENARIOS.map((s) => (
              <div
                key={s.title}
                className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-6 py-6 shadow-[0_8px_24px_-12px_rgba(28,25,23,0.10)]"
              >
                <p className="text-sm font-semibold text-stone-950">{s.title}</p>
                <p className="mt-2 text-sm leading-6 text-stone-600">{s.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-stone-600">
            Guardrail enforces the decisions you made before the session — when you were thinking clearly. Not as a reminder. As a hard stop.
          </p>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section id="how-it-works">
          <div className="mb-5 max-w-2xl sm:mb-8">
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
                <h3 className="mt-4 text-base font-semibold leading-6 tracking-[-0.02em] text-stone-950">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Live session preview ──────────────────────────────────────────── */}
        <section>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Live session preview
          </p>
          <div className="rounded-[2rem] border border-stone-200/80 bg-white/95 p-4 shadow-[0_40px_100px_-40px_rgba(28,25,23,0.18)] sm:p-6 lg:p-8">
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
            <div className="grid gap-3 sm:grid-cols-3">
              <Tile label="Trades" value="2 / 5" sub="3 remaining" />
              <Tile label="P&L today" value="−$120" sub="Limit −$500" tone="warning" />
              <Tile label="Loss streak" value="1" sub="Stop after 3" />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
              <StatusChip label="Allowed" tone="muted" />
              <span className="text-stone-300" aria-hidden>›</span>
              <StatusChip label="Warning" tone="active" />
              <span className="text-stone-300" aria-hidden>›</span>
              <StatusChip label="Locked" tone="muted" />
            </div>
            <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800">
              <span className="font-medium text-amber-900">Approaching daily loss limit.</span>{" "}
              Consider stopping early.
            </p>
          </div>
        </section>

        {/* ── Rule engine showcase ──────────────────────────────────────────── */}
        <section>
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Rule engine
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
              Every rule that matters, in one place.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
              Set them before the open. Guardrail evaluates every trade event against them.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {RULES.map((rule) => (
              <RuleCard key={rule.name} {...rule} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-stone-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              Active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
              Partial — manual mode today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-stone-300" aria-hidden />
              Coming soon
            </span>
          </div>
        </section>

        {/* ── Enforcement honesty panel ─────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8 lg:p-10">
          <div className="mb-6 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Enforcement scope
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              What Guardrail does today. What&rsquo;s coming.
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              We only ship broker-side enforcement after live verification with each integration. Until then, the lock is app-level.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                Enforced today
              </p>
              <ul className="grid gap-2">
                {ENFORCEMENT_NOW.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700"
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400">
                Planned after broker verification
              </p>
              <ul className="grid gap-2">
                {ENFORCEMENT_PLANNED.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-stone-100 bg-stone-50/50 px-4 py-3 text-sm text-stone-500"
                  >
                    <span className="mt-0.5 shrink-0 text-stone-400">→</span>
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-stone-400">
                Broker-side actions require write-level API permissions. Each integration is verified live before it ships.
              </p>
            </div>
          </div>
        </section>

        {/* ── Broker integrations ───────────────────────────────────────────── */}
        <section>
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              Broker integrations
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Connect your broker account.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BROKERS.map((broker) => (
              <BrokerCard key={broker.name} {...broker} />
            ))}
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.22)] sm:p-8 lg:p-10">
          <p className="mb-8 max-w-2xl text-base leading-7 text-stone-600">
            <span className="font-semibold text-stone-950">
              One stopped rule break can pay for the month.
            </span>{" "}
            For many day traders, one avoided revenge trade or oversized entry costs more than $49.
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
                Full access during your trial. Configure your rules, run your first session, and connect Telegram. No credit card required.
              </p>
              <div className="mt-6 flex items-baseline gap-2 sm:mt-8">
                <span className="text-4xl font-bold tracking-[-0.04em] text-stone-950 sm:text-5xl">
                  $49
                </span>
                <span className="text-base text-stone-500">/ month</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <div className="mt-6 flex flex-col items-start gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
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
                {INCLUDED_FEATURES.map((feature) => (
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

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
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
            {FAQS.map((faq) => (
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore – `name` on <details> is valid HTML (Chrome 120+, Firefox 130+, Safari 17.2+) but missing from older React types
              <details
                key={faq.q}
                name="faq"
                className="group rounded-2xl border border-stone-200 bg-white/90 px-6 py-4 transition-colors hover:bg-stone-50/60"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold tracking-[-0.02em] text-stone-950">
                  {faq.q}
                  <span className="shrink-0 text-stone-500 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-3xl">
                Your rules, enforced. Starting now.
              </h2>
              <p className="mt-3 text-base leading-7 text-stone-600">
                Configure your limits. Run today&rsquo;s session. The app locks the moment a rule breaks.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
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

// ─── Helper components ─────────────────────────────────────────────────────────

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

const RULE_BADGE_CONFIG: Record<
  RuleBadge,
  { label: string; dot: string; text: string; bg: string }
> = {
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
  },
  partial: {
    label: "Partial",
    dot: "bg-amber-400",
    text: "text-amber-700",
    bg: "bg-amber-50",
  },
  "coming-soon": {
    label: "Coming soon",
    dot: "bg-stone-300",
    text: "text-stone-500",
    bg: "bg-stone-50",
  },
};

function RuleCard({
  name,
  description,
  badge,
}: {
  name: string;
  description: string;
  badge: RuleBadge;
}) {
  const cfg = RULE_BADGE_CONFIG[badge];
  return (
    <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-5 py-5 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-5 text-stone-950">{name}</p>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${cfg.bg} ${cfg.text}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} aria-hidden />
          {cfg.label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-stone-500">{description}</p>
    </div>
  );
}

function HeroStatusPreview() {
  return (
    <div className="w-56 rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-400">
          Today&rsquo;s session
        </p>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Allowed
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-stone-500">
            <span>Daily loss</span>
            <span>$120 / $500</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full w-[24%] rounded-full bg-emerald-500" />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-stone-500">
            <span>Trades</span>
            <span>2 / 5</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
            <div className="h-full w-[40%] rounded-full bg-emerald-500" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-stone-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Allowed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
          Warning
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" aria-hidden />
          Locked
        </span>
      </div>
    </div>
  );
}

function BrokerCard({
  name,
  status,
  description,
}: {
  name: string;
  status: "live" | "planned";
  description?: string;
}) {
  const isLive = status === "live";
  return (
    <div
      className={`rounded-[1.75rem] border px-5 py-5 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)] ${
        isLive ? "border-stone-200 bg-white/90" : "border-stone-100 bg-stone-50/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm font-semibold ${isLive ? "text-stone-950" : "text-stone-500"}`}>
          {name}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
            isLive ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"
          }`}
        >
          {isLive ? "Read-only" : "Planned"}
        </span>
      </div>
      {description && (
        <p className="mt-2 text-xs leading-5 text-stone-500">{description}</p>
      )}
    </div>
  );
}
