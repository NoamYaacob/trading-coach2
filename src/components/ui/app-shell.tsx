import Link from "next/link";
import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth";
import { TopNav } from "./top-nav";

type AppShellProps = {
  eyebrow: string;
  title: ReactNode;
  description: string;
  note?: string;
  children?: ReactNode;
  actions?: ReactNode;
};

export async function AppShell({
  eyebrow,
  title,
  description,
  note,
  children,
  actions,
}: AppShellProps) {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
        <Link
          href="/"
          className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80"
        >
          Guardrail
        </Link>
        <TopNav authenticated={Boolean(user)} />
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 pb-0 lg:px-10">
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
              {note && (
                <p className="mt-3 text-xs leading-5 text-stone-500">{note}</p>
              )}
            </div>
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </section>

        {children}

        <footer className="mt-6 border-t border-stone-200/70 py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-md text-xs leading-5 text-stone-400">
              Guardrail is a discipline and risk-management tool. It does not provide financial advice or guarantee trading results. Trading involves substantial risk of loss.
            </p>
            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-400">
              <Link href="/terms" className="transition hover:text-stone-700">Terms</Link>
              <Link href="/privacy" className="transition hover:text-stone-700">Privacy</Link>
              <Link href="/risk-disclaimer" className="transition hover:text-stone-700">Risk Disclaimer</Link>
              <a href="mailto:support@guardrail.trade" className="transition hover:text-stone-700">Contact Support</a>
            </nav>
          </div>
        </footer>
      </main>
    </div>
  );
}

