import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { RULES } from "@/lib/marketing-data";
import { RuleCard, RuleCardLegend } from "@/components/landing/rule-card";

export const metadata: Metadata = {
  title: "Features",
  description:
    "All fourteen risk rules available in Guardrail, from daily loss limits to payout protection.",
};

export default async function FeaturesPage() {
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
        href="/pricing"
        className="rounded-full border px-5 py-3 text-sm font-medium transition hover:opacity-80"
        style={{ borderColor: "var(--gr-border-hi)", color: "var(--gr-text-mid)" }}
      >
        See pricing
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="RULE ENGINE"
      title="Every rule that protects the account."
      description="Fourteen rules covering daily loss, trade caps, session windows, news locks, and payout protection — all evaluated by the same rule engine in real time."
      actions={actions}
    >
      <div className="-mt-4 sm:-mt-6 grid gap-8 sm:gap-12">
        <RuleEngineMockup />
        <section>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            {RULES.map((rule) => (
              <RuleCard key={rule.name} {...rule} />
            ))}
          </div>
          <RuleCardLegend />
        </section>

        <section
          className="rounded-[14px] border p-5 sm:p-8"
          style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
            Status guide
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] sm:text-2xl" style={{ color: "var(--gr-ink)" }}>
            Active, Partial, and Coming Soon explained.
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Active</p>
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
                Fully live — evaluated against every trade event from your connected broker account in real time.
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Partial</p>
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
                Guardrail evaluates these rules with app-level enforcement where available. No broker-side actions are active for these rules.
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--gr-surface-hi)" }} aria-hidden />
                <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Coming soon</p>
              </div>
              <p className="text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
                On the roadmap. These rules are designed and scoped. The rule engine is built to add
                them without changing the core loop.
              </p>
            </div>
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
                  Your rules, enforced. Starting now.
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

// ─── Rule engine mockup ────────────────────────────────────────────────────────

function RuleEngineMockup() {
  const rules = [
    { name: "Daily Loss Limit",    dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Active"  },
    { name: "Max Trades Per Day",  dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Active"  },
    { name: "Loss Streak Stop",    dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700", label: "Active"  },
    { name: "Daily Profit Target", dot: "bg-amber-400",   badge: "bg-amber-100 text-amber-700",     label: "Partial" },
    { name: "Weekly Loss Limit",   dot: "",               badge: "bg-stone-100 text-stone-400",     label: "Soon"    },
    { name: "Payout Protection",   dot: "",               badge: "bg-stone-100 text-stone-400",     label: "Soon"    },
  ];

  return (
    <div
      className="rounded-[14px] border p-4 sm:p-5"
      style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--gr-text-mute)" }}>
          Rule engine
        </p>
        <span className="text-[10px]" style={{ color: "var(--gr-text-mute)" }}>14 rules total</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rules.map((rule) => (
          <div
            key={rule.name}
            className="flex items-center gap-2 rounded-xl border px-2.5 py-2"
            style={{ borderColor: "var(--gr-border)", background: "var(--gr-bg-elev)" }}
          >
            {rule.dot ? (
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${rule.dot}`} aria-hidden />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--gr-surface-hi)" }} aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium sm:text-xs" style={{ color: "var(--gr-ink)" }}>
              {rule.name}
            </span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${rule.badge}`}>
              {rule.label}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t pt-2.5 text-[10px]" style={{ borderColor: "var(--gr-border)", color: "var(--gr-text-mute)" }}>
        4 active · 4 partial · 6 coming soon · evaluated in real time
      </p>
    </div>
  );
}
