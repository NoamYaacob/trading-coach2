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
  /** Ultra-compact hero for control-panel-style pages where the rules / settings
   *  body is the focus. Shrinks padding, type sizes, and the gap between hero
   *  and the page body so the editor reaches the top of the viewport faster. */
  denseHero?: boolean;
  /** Workspace mode: skips the white rounded hero card entirely and renders a
   *  flat warm-canvas shell (left panel + main workspace). Used by the Trading
   *  Plan page for the Claude Design terminal layout. */
  workspaceMode?: boolean;
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
  denseHero = false,
  workspaceMode = false,
}: AppShellProps) {
  const user = await getCurrentUser();

  if (workspaceMode) {
    return (
      <div className="flex min-h-screen flex-col overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 lg:px-10">
          <Link href="/" className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80">
            Guardrail
          </Link>
          <TopNav authenticated={Boolean(user)} />
        </header>
        <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col px-4 pb-0 sm:px-6 lg:px-10">
          {children}
        </main>
        <footer className="mx-auto mt-6 w-full max-w-6xl border-t border-stone-200/70 px-4 py-4 sm:px-6 lg:px-10">
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
      </div>
    );
  }

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

      <main className={`mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col overflow-x-hidden px-4 pb-0 sm:px-6 lg:px-10 ${denseHero ? "gap-5" : "gap-10"}`}>
        {statusStrip ? <div className="-mt-4">{statusStrip}</div> : null}

        <section className={`rounded-[2rem] border border-stone-200/80 bg-white/85 shadow-[0_30px_80px_-45px_rgba(41,37,36,0.45)] backdrop-blur ${denseHero ? "p-2.5 sm:p-3 lg:p-4" : compactHero ? "p-3 sm:p-4 lg:p-5" : "p-3 sm:p-6 lg:p-8"}`}>
          <div className={`grid ${denseHero ? "gap-2 lg:gap-3" : compactHero ? "gap-4 lg:gap-6" : "gap-6 lg:gap-10"} ${heroPreview ? "lg:grid-cols-[1fr_auto] lg:items-end" : ""}`}>
            <div>
              <div className="max-w-3xl">
                <p className={`font-semibold uppercase text-amber-700 ${denseHero ? "text-[10px] tracking-[0.24em]" : "text-xs tracking-[0.3em]"}`}>
                  {eyebrow}
                </p>
                <h1 className={`font-semibold leading-tight tracking-[-0.04em] text-stone-950 ${denseHero ? "mt-1 text-lg sm:text-xl lg:text-2xl" : compactHero ? "mt-3 text-xl sm:text-2xl lg:text-3xl" : "mt-3 text-2xl sm:text-3xl lg:text-4xl"}`}>
                  {title}
                </h1>
                <p className={`max-w-2xl text-stone-600 ${denseHero ? "mt-1 text-xs leading-5" : "mt-3 text-sm leading-6"}`}>
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
