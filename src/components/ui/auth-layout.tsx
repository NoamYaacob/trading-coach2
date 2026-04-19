import Link from "next/link";
import type { ReactNode } from "react";

const BULLETS = [
  "Build account-specific risk guardrails",
  "Catch tilt, overtrading, and impulsive behavior",
  "Turn your trading rules into daily structure",
  "Stay consistent across volatile sessions",
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* ── Form column ──────────────────────────────────────────── */}
      <div className="flex w-full flex-col bg-white lg:max-w-[480px] xl:max-w-[520px]">
        <div className="flex h-full flex-col px-8 py-10 sm:px-12">
          {/* Brand mark */}
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2.5 transition-opacity hover:opacity-70"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.38em] text-stone-900">
              Guardrail
            </span>
          </Link>

          {/* Form slot — vertically centered */}
          <div className="my-auto py-14">
            {children}
          </div>

          {/* Footer */}
          <p className="text-[11px] text-stone-400">
            © {new Date().getFullYear()} Guardrail. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Brand column (lg+) ───────────────────────────────────── */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-stone-950 lg:flex">
        {/* Subtle dot-grid background */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Content */}
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          {/* Top: nothing — keeps composition clean */}
          <div />

          {/* Middle: value proposition */}
          <div className="max-w-[360px]">
            <p className="mb-5 text-[10px] font-semibold uppercase tracking-[0.32em] text-stone-500">
              Trading Coach
            </p>
            <h2 className="text-4xl font-semibold leading-[1.1] tracking-[-0.04em] text-stone-50 xl:text-[2.75rem]">
              Build discipline.
              <br />
              Protect your edge.
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-stone-400">
              Personalized guardrails for traders who want better discipline, risk control, and consistency.
            </p>

            <ul className="mt-8 grid gap-3.5">
              {BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-3 text-sm text-stone-300">
                  <span className="mt-px shrink-0 text-amber-500">✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Bottom: equity-curve illustration */}
          <div className="relative h-[96px] w-full overflow-hidden">
            <svg
              viewBox="0 0 600 96"
              preserveAspectRatio="none"
              className="h-full w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="curve-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="white" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="white" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Gridlines */}
              <line x1="0" y1="24" x2="600" y2="24" stroke="white" strokeWidth="0.5" strokeOpacity="0.07" />
              <line x1="0" y1="48" x2="600" y2="48" stroke="white" strokeWidth="0.5" strokeOpacity="0.07" />
              <line x1="0" y1="72" x2="600" y2="72" stroke="white" strokeWidth="0.5" strokeOpacity="0.07" />
              {/* Area fill */}
              <path
                d="M0,82 C40,80 70,74 100,66 S145,56 165,62 S195,52 225,42 S268,30 298,24 S338,18 368,13 S415,8 455,6 S510,3 560,2 L600,1 L600,96 L0,96 Z"
                fill="url(#curve-area)"
              />
              {/* Equity curve */}
              <path
                d="M0,82 C40,80 70,74 100,66 S145,56 165,62 S195,52 225,42 S268,30 298,24 S338,18 368,13 S415,8 455,6 S510,3 560,2 L600,1"
                stroke="white"
                strokeWidth="1.5"
                strokeOpacity="0.5"
                fill="none"
              />
              {/* Highlight dot at recent high */}
              <circle cx="560" cy="2" r="3" fill="white" fillOpacity="0.6" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
