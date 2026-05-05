import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/ui/logout-button";

export const metadata: Metadata = {
  title: "Get started — Guardrail",
};

type StepStatus = "done" | "next" | "pending";

const STATUS_PILL: Record<StepStatus, { pill: string; label: string }> = {
  done: { pill: "bg-emerald-100 text-emerald-700", label: "Done" },
  next: { pill: "bg-stone-950 text-stone-50", label: "Next" },
  pending: { pill: "bg-stone-100 text-stone-400", label: "Pending" },
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [traderProfile, riskRules, guardianProfile, brokerCount] = await Promise.all([
    prisma.traderProfile.findUnique({ where: { userId: user.id }, select: { id: true } }),
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.guardianProfile.findUnique({
      where: { userId: user.id },
      select: { guardianEnabled: true },
    }),
    prisma.connectedAccount.count({ where: { userId: user.id, isActive: true } }),
  ]);

  const hasProfile = traderProfile !== null;
  const hasRules = riskRules !== null;
  const isProtectionActive = Boolean(guardianProfile?.guardianEnabled);
  const hasBroker = brokerCount > 0;

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
      title: "Turn on Guardian",
      description: "Activate monitoring so Guardrail checks each session against your saved rules.",
      cta: "Turn on Guardian",
      href: "/rules#guardian-toggle",
      done: isProtectionActive,
    },
    {
      title: "Broker connection",
      description: "Connect Tradovate to enable live broker trade monitoring and rule enforcement.",
      cta: "Connect Tradovate",
      href: "/accounts/connect/tradovate",
      done: hasBroker,
    },
  ];

  const nextIndex = steps.findIndex((s) => !s.done);

  function getStatus(i: number): StepStatus {
    if (steps[i].done) return "done";
    if (i === nextIndex) return "next";
    return "pending";
  }

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
            Finish your Guardrail setup.
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-stone-500">
            Your trading profile is saved. Set your first rules, turn on protection, and connect Tradovate later when ready.
          </p>
        </div>

        <div className="grid gap-3">
          {steps.map((step, i) => {
            const status = getStatus(i);
            const { pill, label } = STATUS_PILL[status];
            const isDone = status === "done";
            const isOptional = i === 2 && !isDone;
            const isNext = status === "next" && !isOptional;

            return (
              <Link
                key={step.title}
                href={step.href}
                className={`flex items-start gap-4 rounded-2xl px-5 py-4 ${
                  isNext
                    ? "border-2 border-stone-950 bg-white"
                    : isDone
                      ? "border border-stone-200 bg-white opacity-60"
                      : isOptional
                        ? "border border-dashed border-stone-200 bg-stone-50/60"
                        : "border border-stone-200 bg-stone-50"
                }`}
              >
                {/* Step indicator */}
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isDone
                      ? "bg-emerald-100 text-emerald-700"
                      : isNext
                        ? "bg-stone-950 text-stone-50"
                        : "bg-stone-100 text-stone-400"
                  }`}
                >
                  {isDone ? "✓" : i + 1}
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      isDone
                        ? "text-stone-400 line-through"
                        : isNext
                          ? "text-stone-950"
                          : "text-stone-400"
                    }`}
                  >
                    {step.title}
                  </p>
                  <p
                    className={`mt-0.5 text-xs leading-5 ${
                      isNext ? "text-stone-500" : "text-stone-400"
                    }`}
                  >
                    {step.description}
                  </p>
                </div>

                {/* Status pill */}
                {isOptional ? (
                  <span className="shrink-0 self-start rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                    Optional
                  </span>
                ) : (
                  <span
                    className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${pill}`}
                  >
                    {label}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={
              !hasProfile
                ? "/onboarding/profile"
                : !hasRules
                  ? "/rules"
                  : !isProtectionActive
                    ? "/rules#guardian-toggle"
                    : "/dashboard"
            }
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-950 text-sm font-medium text-stone-50 transition hover:bg-stone-800 sm:w-auto sm:px-8"
          >
            {!hasProfile
              ? "Complete your trading profile"
              : !hasRules
                ? "Set your first rules"
                : !isProtectionActive
                  ? "Turn on Guardian"
                  : "Continue to dashboard"}
          </Link>
          {!hasBroker && (
            <Link
              href="/accounts/connect/tradovate"
              className="text-sm text-stone-500 underline-offset-2 hover:text-stone-950 hover:underline"
            >
              Connect Tradovate
            </Link>
          )}
          <p className="text-xs text-stone-400">
            Connect Tradovate to activate Guardrail.
          </p>
        </div>
      </main>
    </div>
  );
}
