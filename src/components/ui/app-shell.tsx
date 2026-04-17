import Link from "next/link";
import type { ReactNode } from "react";

type AppShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  actions?: ReactNode;
};

export function AppShell({
  eyebrow,
  title,
  description,
  children,
  actions,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="text-sm font-bold uppercase tracking-[0.32em] text-stone-900">
          Guardrail
        </Link>
        <nav className="flex items-center gap-2 text-sm text-stone-600">
          <Link href="/onboarding" className="rounded-full px-4 py-2 transition hover:text-stone-950">
            Onboarding
          </Link>
          <Link href="/guardian" className="rounded-full px-4 py-2 transition hover:text-stone-950">
            Guardian
          </Link>
          <Link href="/dashboard" className="rounded-full bg-stone-950 px-4 py-2 font-medium text-stone-50 transition hover:bg-stone-800">
            Dashboard
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 pb-20 lg:px-10">
        <section className="rounded-[2rem] border border-stone-200/80 bg-white/85 p-8 shadow-[0_30px_80px_-45px_rgba(41,37,36,0.45)] backdrop-blur sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">
                {eyebrow}
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
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
