import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { PROP_FIRM_CARDS } from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Built for Prop Firms",
  description:
    "How Guardrail protects futures traders during prop firm evaluations and funded accounts.",
};

export default async function PropFirmsPage() {
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
        href="/features"
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
      >
        View all features
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="FOR PROP FIRM TRADERS"
      title="Prop firm rules do not forgive emotional trades."
      description="One rule break can cost more than the trade. It can cost the challenge, the funded account, or the payout."
      actions={actions}
    >
      <div className="grid gap-8 sm:gap-12">

        {/* ── Protection path ─────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-amber-200/60 bg-amber-50/20 p-5 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
            Protection path
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            Three stages. Same rules enforced throughout.
          </h2>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-stretch">

            <StageCard
              stage="Stage 1"
              title="Challenge"
              risk="One bad day ends the evaluation"
              rules={["Daily loss limit", "Max trades / day", "Session hours"]}
            />
            <div className="hidden sm:flex sm:items-center sm:px-2" aria-hidden>
              <span className="text-amber-300">→</span>
            </div>
            <StageCard
              stage="Stage 2"
              title="Funded Account"
              risk="Bad week = account pulled"
              rules={["Daily loss limit", "Loss streak stop", "News blackout"]}
            />
            <div className="hidden sm:flex sm:items-center sm:px-2" aria-hidden>
              <span className="text-amber-300">→</span>
            </div>
            <StageCard
              stage="Stage 3"
              title="Payout Day"
              risk="Giveback trade wipes the gain"
              rules={["Profit target lock*", "Payout protection*"]}
            />

          </div>
          <p className="mt-4 text-[11px] text-stone-400">
            * Partial or coming-soon rules. See{" "}
            <a href="/features" className="underline transition hover:text-stone-600">
              features
            </a>{" "}
            for current status.
          </p>
        </section>

        {/* ── Three protection cards ──────────────────────────────────── */}
        <section className="rounded-[2rem] border border-amber-200/80 bg-amber-50/30 p-5 sm:p-8">
          <div className="mb-5 max-w-2xl sm:mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              Prop firm pressure
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
              Three moments where Guardrail helps most.
            </h2>
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
        </section>

        {/* ── Why prop firm rules are different ──────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            The evaluation context
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            Why the same rules feel different when your account is on the line.
          </h2>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            In personal trading, a bad day costs money. In a funded evaluation, a bad day can cost the
            account. The daily drawdown limit is not a guideline — it is an absolute boundary. One
            impulsive trade at the wrong moment ends the evaluation.
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            Guardrail is built for this context. You set the same rules the prop firm uses — daily loss,
            max trades, session hours — and Guardrail evaluates every trade event against those rules in
            real time. When a limit is hit, the session locks.
          </p>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            Guardrail does not guarantee you pass an evaluation. It is not a signal tool and does not
            give trading advice. It holds the rules you set when you were thinking clearly, when the
            pressure of a live session would otherwise override them.
          </p>
        </section>

        {/* ── Account types ──────────────────────────────────────────── */}
        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Account types
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-2xl">
            Works across evaluation and funded stages.
          </h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              {
                label: "Evaluation accounts",
                text: "Track daily drawdown and trade count against prop firm evaluation rules. Lock the session before a disqualifying breach.",
              },
              {
                label: "Funded accounts",
                text: "Protect an active funded account the same way. The rules that protect the account during funding are the same ones Guardrail enforces.",
              },
              {
                label: "Personal accounts",
                text: "Use Guardrail for your own discipline outside of prop firm programs. Same rule engine, same lock behavior.",
              },
              {
                label: "Demo accounts",
                text: "Test your rule setup without risk using a connected demo or paper trading account.",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-5 sm:py-5"
              >
                <p className="text-sm font-semibold text-stone-950">{item.label}</p>
                <p className="mt-2 text-sm leading-5 text-stone-600">{item.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-5 text-stone-500">
            Multiple prop firms and broker connections are supported. Each Tradovate connection and trading account is tracked independently — rules and enforcement are account-specific.
          </p>
        </section>

        {!user && (
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-stone-950">
                  Set your prop firm rules before the open.
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

// ─── Stage card helper ─────────────────────────────────────────────────────────

function StageCard({
  stage,
  title,
  risk,
  rules,
}: {
  stage: string;
  title: string;
  risk: string;
  rules: string[];
}) {
  return (
    <div className="flex-1 rounded-2xl border border-amber-100 bg-white/80 px-4 py-4">
      <div className="mb-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
          {stage}
        </span>
      </div>
      <p className="text-sm font-semibold text-stone-950">{title}</p>
      <p className="mt-1 text-[11px] leading-4 text-stone-500">{risk}</p>
      <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5">
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          Rules applied
        </p>
        <ul className="grid gap-1">
          {rules.map((r) => (
            <li key={r} className="flex items-center gap-1.5 text-[10px] text-stone-700">
              <span className="h-1 w-1 shrink-0 rounded-full bg-amber-500" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
