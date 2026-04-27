import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/ui/logout-button";

export const metadata: Metadata = {
  title: "Get started — Guardrail",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, guardianProfile, brokerCount] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.guardianProfile.findUnique({
      where: { userId: user.id },
      select: { guardianEnabled: true },
    }),
    prisma.connectedAccount.count({ where: { userId: user.id, isActive: true } }),
  ]);

  const hasRules = riskRules !== null;
  const isProtectionActive = Boolean(guardianProfile?.guardianEnabled);
  const hasBroker = brokerCount > 0;
  const allDone = hasRules && isProtectionActive && hasBroker;

  let primaryHref: string;
  if (!hasRules) {
    primaryHref = "/rules";
  } else if (!isProtectionActive) {
    primaryHref = "/rules#guardian-toggle";
  } else if (!hasBroker) {
    primaryHref = "/accounts";
  } else {
    primaryHref = "/dashboard";
  }

  const steps: Array<{
    title: string;
    description: string;
    cta: string;
    href: string;
    done: boolean;
  }> = [
    {
      title: "Set your first rules",
      description: "Choose daily loss, max trades, and loss-streak limits.",
      cta: "Set rules",
      href: "/rules",
      done: hasRules,
    },
    {
      title: "Enable protection",
      description: "Start monitoring your session against your saved rules.",
      cta: "Enable protection",
      href: "/rules#guardian-toggle",
      done: isProtectionActive,
    },
    {
      title: "Connect Tradovate",
      description: "Verify your broker connection for live broker-based risk checks.",
      cta: "Connect broker",
      href: "/accounts",
      done: hasBroker,
    },
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-white px-4 sm:px-6">
        <Link
          href="/"
          className="text-[10px] font-bold uppercase tracking-[0.38em] text-stone-900 transition-opacity hover:opacity-70"
        >
          Guardrail
        </Link>
        <LogoutButton />
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-600">
            Getting started
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
            Set up your first trading session.
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-stone-500">
            Start with your rules. Then turn on protection and connect Tradovate when you&apos;re ready.
          </p>
        </div>

        <div className="grid gap-3">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="flex items-start gap-4 rounded-2xl border border-stone-200 bg-white px-5 py-4"
            >
              <div
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-stone-100 text-stone-500"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    step.done ? "text-stone-400 line-through" : "text-stone-950"
                  }`}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-stone-500">{step.description}</p>
              </div>
              {!step.done && (
                <Link
                  href={step.href}
                  className="shrink-0 self-center rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                >
                  {step.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            href={primaryHref}
            className="inline-flex h-11 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            {allDone ? "Go to dashboard" : "Get started"}
          </Link>
        </div>
      </main>
    </div>
  );
}
