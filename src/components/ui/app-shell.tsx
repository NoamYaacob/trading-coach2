import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";
import { TopNav } from "./top-nav";

type AppShellProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  note?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  heroPreview?: ReactNode;
  statusStrip?: ReactNode;
  compactHero?: boolean;
};

export async function AppShell({
  eyebrow,
  title,
  description,
  note,
  children,
  actions,
  heroPreview,
  statusStrip,
  compactHero = false,
}: AppShellProps) {
  const user = await getCurrentUser();

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 lg:px-10">
        <Link
          href="/"
          className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80"
        >
          Guardrail
        </Link>
        <TopNav authenticated={Boolean(user)} />
      </header>

      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-10 overflow-x-hidden px-4 pb-0 sm:px-6 lg:px-10">
        {statusStrip ? <div className="-mt-4">{statusStrip}</div> : null}

        <section className={`rounded-[2rem] border border-stone-200/80 bg-white/85 shadow-[0_30px_80px_-45px_rgba(41,37,36,0.45)] backdrop-blur ${compactHero ? "p-3 sm:p-4 lg:p-5" : "p-3 sm:p-6 lg:p-8"}`}>
          <div className={`grid ${compactHero ? "gap-4 lg:gap-6" : "gap-6 lg:gap-10"} ${heroPreview ? "lg:grid-cols-[1fr_auto] lg:items-end" : ""}`}>
            <div>
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
                  {eyebrow}
                </p>
                <h1 className={`mt-3 font-semibold leading-tight tracking-[-0.04em] text-stone-950 ${compactHero ? "text-xl sm:text-2xl lg:text-3xl" : "text-2xl sm:text-3xl lg:text-4xl"}`}>
                  {title}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">
                  {description}
                </p>
                {note && (
                  <p className="mt-3 text-xs leading-5 text-stone-500">{note}</p>
                )}
              </div>
              {actions && (
                <div className="mt-4 flex flex-row flex-wrap gap-3 sm:mt-5">
                  {actions}
                </div>
              )}
              {heroPreview && (
                <div className="mt-4 lg:hidden">
                  {heroPreview}
                </div>
              )}
            </div>
            {heroPreview && (
              <div className="hidden shrink-0 lg:block">
                {heroPreview}
              </div>
            )}
          </div>
        </section>

        {children}

        <footer className="mt-6 border-t border-stone-200/70 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-md text-xs leading-5 text-stone-400">
              Guardrail is a discipline and risk-management tool. It does not provide financial advice or guarantee trading results. Trading involves substantial risk of loss.
            </p>
            <nav className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
              <Link href="/terms" className="transition hover:text-stone-600">Terms</Link>
              <Link href="/privacy" className="transition hover:text-stone-600">Privacy</Link>
              <Link href="/risk-disclaimer" className="transition hover:text-stone-600">Risk Disclaimer</Link>
              <a href="mailto:support@guardrail.trade" className="transition hover:text-stone-600">Contact Support</a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}
