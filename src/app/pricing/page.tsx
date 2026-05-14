import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { INCLUDED_FEATURES } from "@/lib/marketing-data";
import { RoiCalculator } from "@/components/roi-calculator";

export const metadata: Metadata = {
  title: "Pricing",
  description: "First week free, then $25/month. No credit card required to start.",
};

export default async function PricingPage() {
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
        href="/login"
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
      >
        Log in
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="PRICING"
      title="First week free."
      description="Full access for 7 days — no credit card required. Configure your rules, run your first session, and connect Telegram. Then $25/month."
      actions={actions}
    >
      <div className="grid gap-8 sm:gap-12">

        {/* ── Price card ──────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.22)] sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                What you pay
              </p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-[-0.04em] text-stone-950">$25</span>
                <span className="text-base text-stone-500">/ month after trial</span>
              </div>
              <p className="mt-2 text-sm text-stone-500">Billed monthly. Cancel any time.</p>
              <p className="mt-1 text-xs text-stone-400">
                Less than the cost of one avoidable mistake.
              </p>
              <div className="mt-6 rounded-2xl border border-amber-200/70 bg-amber-50/50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">First week free</p>
                <p className="mt-1 text-xs leading-5 text-amber-800">
                  7 days of full access. No credit card required. Cancel at any time before the trial
                  ends and you will not be charged.
                </p>
              </div>
              {!user && (
                <div className="mt-5 flex flex-row flex-wrap gap-3">
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
                </div>
              )}
            </div>
            <div>
              <p className="mb-4 text-sm font-semibold text-stone-950">Included:</p>
              <ul className="grid gap-2 sm:gap-2.5">
                {INCLUDED_FEATURES.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-3 rounded-2xl bg-stone-50 px-3 py-2 text-sm text-stone-700 sm:px-4 sm:py-3"
                  >
                    <span className="mt-0.5 shrink-0 font-bold text-emerald-600">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── ROI calculator ──────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8 lg:p-10">
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
              The math
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              What are your broken rules costing you?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              A broken rule is not always one big loss. The damage is the pattern.
            </p>
          </div>
          <RoiCalculator />
        </section>

        {/* ── FAQ teaser ──────────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Questions about pricing
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950">
            Everything is in the FAQ.
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Questions about what&rsquo;s included, broker connections, enforcement scope, and prop
            firm support are all answered there.
          </p>
          <div className="mt-4">
            <Link
              href="/faq"
              className="text-sm font-medium text-stone-700 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              Read the full FAQ →
            </Link>
          </div>
        </section>

      </div>
    </AppShell>
  );
}
