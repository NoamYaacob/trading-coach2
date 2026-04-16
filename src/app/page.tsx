import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";

export const metadata: Metadata = {
  title: "Trading Coach",
};

const workflowSteps = [
  {
    title: "Prepare the day",
    detail:
      "Set the session up from the dashboard, confirm readiness, and make the day explicit before the first trade.",
  },
  {
    title: "Start the session",
    detail:
      "Open the trading day deliberately, with live limits, reset timing, and Guardian status already visible.",
  },
  {
    title: "Continue in Telegram",
    detail:
      "Use the coach in real time during the session for check-ins, pressure moments, resets, and day review.",
  },
  {
    title: "Guardian enforces boundaries",
    detail:
      "When limits are hit, the product moves from coaching into protection and closes the day cleanly.",
  },
  {
    title: "Review after close",
    detail:
      "Finish with activity context, post-session review, and the takeaway to carry into the next session.",
  },
];

const productPillars = [
  {
    title: "Session control",
    detail:
      "This product starts from the day itself: readiness, session start, active state, session end, and post-session review.",
  },
  {
    title: "Guardian protection",
    detail:
      "Guardian is the decision layer that determines whether trading is open, locked, or waiting for reset.",
  },
  {
    title: "Live coaching in Telegram",
    detail:
      "The Telegram coach stays aware of the real product state, not just isolated messages.",
  },
  {
    title: "Activity and review",
    detail:
      "Today Activity and Post-Session Review make the day readable without turning the product into a bulky journal.",
  },
  {
    title: "Future-ready platform integration",
    detail:
      "The current build runs on a mock/internal flow, with adapter contracts and integration planning already prepared for future live platform work.",
  },
];

const differencePoints = [
  "Not just a journal after the fact. The product controls the live session state while the day is happening.",
  "Not just an alert bot. Telegram coaching is tied to Guardian, Today Session, and the real website workflow.",
  "Not pretending to be broker-connected yet. The current build is demo-ready, with a mock/internal flow and future integration boundaries already in place.",
];

export default function Home() {
  return (
    <AppShell
      eyebrow="Trading Discipline System"
      title="A session-first trading guardian with live coaching and real daily control."
      description="Trading Coach combines dashboard operations, Guardian protection, and Telegram coaching into one daily discipline loop. It is built for traders who need clearer boundaries, better state control, and a cleaner close to the day."
      actions={
        <>
          <Link
            href="/signup"
            className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Sign up
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
          >
            Log in
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
          >
            View product flow
          </Link>
        </>
      }
    >
      <div className="grid gap-6">
        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            title="What this product is"
            description="A trading discipline system for active traders who need the day managed as an operating process, not as a loose collection of notes and reminders."
          >
            <div className="grid gap-3 text-sm leading-6 text-stone-700">
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                The product is built around one practical question: is today open, protected,
                or already closed?
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                It combines website session control, Guardian enforcement, and Telegram
                coaching into one operating loop.
              </div>
              <div className="rounded-2xl bg-stone-50 px-4 py-4">
                The goal is not more trader content. The goal is cleaner decisions, better
                boundaries, and a more controlled trading day.
              </div>
            </div>
          </SectionCard>

          <section className="rounded-[1.75rem] border border-amber-200 bg-amber-50/90 p-6 shadow-[0_20px_60px_-40px_rgba(120,53,15,0.35)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              Demo-ready build
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-stone-950">
              Serious product flow today, live broker sync later.
            </h2>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              The current build is ready to demonstrate the real operating model: session
              readiness, Guardian lockout, Telegram coaching, day activity, and post-session
              review.
            </p>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              Platform integration is intentionally honest: the product currently runs on a
              mock/internal flow, while the adapter layer and integration plan are already
              prepared for future live connections.
            </p>
          </section>
        </section>

        <SectionCard
          title="How the daily loop works"
          description="The product is designed around the actual trading day, not around disconnected tools."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div
                key={step.title}
                className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Step {index + 1}
                </p>
                <h3 className="mt-2 text-base font-semibold text-stone-950">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-600">{step.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <SectionCard
            title="Why it is different"
            description="This is not a generic journal, and it is not just a coaching bot."
          >
            <ul className="grid gap-3 text-sm leading-6 text-stone-700">
              {differencePoints.map((point) => (
                <li key={point} className="rounded-2xl bg-stone-50 px-4 py-4">
                  {point}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            title="Core product pillars"
            description="The current build already shows the system working as one operational product."
          >
            <ul className="grid gap-3 text-sm leading-6 text-stone-700">
              {productPillars.map((pillar) => (
                <li
                  key={pillar.title}
                  className="rounded-2xl border border-stone-200 bg-white px-4 py-4"
                >
                  <p className="font-medium text-stone-950">{pillar.title}</p>
                  <p className="mt-2 text-stone-600">{pillar.detail}</p>
                </li>
              ))}
            </ul>
          </SectionCard>
        </section>

        <section className="rounded-[1.9rem] border border-stone-200 bg-white/90 p-8 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.35)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
                Next step
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950">
                Open the product flow and see the day as a controlled system.
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-600">
                Sign up to move through onboarding, Today Session, Guardian, Telegram handoff,
                and post-session review in the current demo-ready product.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/signup"
                className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Sign up
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Log in
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
