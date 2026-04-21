import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

type AppShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  actions?: ReactNode;
};

export async function AppShell({
  eyebrow,
  title,
  description,
  children,
  actions,
}: AppShellProps) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="text-sm font-bold uppercase tracking-[0.32em] text-stone-900">
          Guardrail
        </Link>
        <nav className="flex items-center gap-2 text-sm text-stone-600">
          {user ? (
            <>
              <Link href="/onboarding" className="rounded-full px-4 py-2 transition hover:text-stone-950">
                Onboarding
              </Link>
              <Link href="/guardian" className="rounded-full px-4 py-2 transition hover:text-stone-950">
                Guardian
              </Link>
              <Link href="/accounts" className="rounded-full px-4 py-2 transition hover:text-stone-950">
                Accounts
              </Link>
              <Link href="/settings" className="rounded-full px-4 py-2 transition hover:text-stone-950">
                Settings
              </Link>
              <Link href="/dashboard" className="rounded-full bg-stone-950 px-4 py-2 font-medium text-stone-50 transition hover:bg-stone-800">
                Dashboard
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-4 py-2 transition hover:text-stone-950">
                Log in
              </Link>
              <Link href="/signup" className="rounded-full bg-stone-950 px-4 py-2 font-medium text-stone-50 transition hover:bg-stone-800">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 pb-20 lg:px-10">
        <section className="rounded-[2rem] border border-stone-200/80 bg-white/85 p-6 shadow-[0_30px_80px_-45px_rgba(41,37,36,0.45)] backdrop-blur sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">
                {description}
              </p>
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </section>

        {children}
      </main>
    </div>
  );
}
