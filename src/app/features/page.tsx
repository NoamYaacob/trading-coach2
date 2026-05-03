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
      heroPreview={<RuleEngineMockup />}
    >
      <div className="grid gap-8 sm:gap-12">
        <section>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            {RULES.map((rule) => (
              <RuleCard key={rule.name} {...rule} />
            ))}
          </div>
          <RuleCardLegend />
        </section>

        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Status guide
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            Active, Partial, and Coming Soon explained.
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                <p className="text-sm font-semibold text-stone-950">Active</p>
              </div>
              <p className="text-sm leading-6 text-stone-600">
                Fully live — evaluated against every trade event in real time. Works in both Manual
                Mode and broker-connected mode.
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                <p className="text-sm font-semibold text-stone-950">Partial</p>
              </div>
              <p className="text-sm leading-6 text-stone-600">
                Available in Manual Mode today. Broker-connected evaluation for these rules is in
                progress and ships after live verification.
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-stone-300" aria-hidden />
                <p className="text-sm font-semibold text-stone-950">Coming soon</p>
              </div>
              <p className="text-sm leading-6 text-stone-600">
                On the roadmap. These rules are designed and scoped. The rule engine is built to add
                them without changing the core loop.
              </p>
            </div>
          </div>
        </section>

        {!user && (
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-stone-950">
                  Your rules, enforced. Starting now.
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

// ─── Rule engine mockup ────────────────────────────────────────────────────────

function RuleEngineMockup() {
  return (
    <div className="w-full rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-[0_8px_28px_-8px_rgba(28,25,23,0.12)] sm:w-64 lg:p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-stone-400">
          Rule engine
        </p>
        <span className="text-[9px] text-stone-400">14 rules</span>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100/80 bg-emerald-50/60 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-stone-950">Daily Loss Limit</p>
            <p className="text-[10px] text-stone-500">Evaluated on every fill</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
            Active
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-emerald-100/80 bg-emerald-50/60 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-stone-950">Max Trades Per Day</p>
            <p className="text-[10px] text-stone-500">Count resets at midnight</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700">
            Active
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-amber-100/80 bg-amber-50/60 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-stone-950">Daily Profit Target</p>
            <p className="text-[10px] text-stone-500">Manual Mode today</p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
            Partial
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-stone-100/80 bg-stone-50 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-stone-400">Weekly Loss Limit</p>
            <p className="text-[10px] text-stone-400">In development</p>
          </div>
          <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] font-semibold text-stone-400">
            Soon
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-stone-100/80 bg-stone-50 px-3 py-2 opacity-70">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium text-stone-400">Payout Protection</p>
            <p className="text-[10px] text-stone-400">In development</p>
          </div>
          <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] font-semibold text-stone-400">
            Soon
          </span>
        </div>
      </div>
      <p className="mt-3 border-t border-stone-100 pt-2 text-[9px] text-stone-400">
        5 active · 3 partial · 6 coming soon
      </p>
    </div>
  );
}
