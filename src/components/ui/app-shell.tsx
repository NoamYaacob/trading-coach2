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
    /* Phase I structural: edge-to-edge workspace — no max-width container,
     * no gradient marketing bg, no footer chrome. The workspace IS the page.
     * Top nav stays for cross-page navigation but uses an integrated warm
     * surface (no visual separation from the workspace below). */
    return (
      <div
        className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#f3ece0] text-[color:var(--gr-ink)]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 70% 50% at 15% 0%, rgba(180,160,120,0.08), transparent 60%), radial-gradient(ellipse 50% 40% at 85% 100%, rgba(180,160,120,0.07), transparent 60%)",
        }}
      >
        <header className="flex w-full shrink-0 items-center justify-between gap-3 border-b border-[color:var(--gr-border)] bg-[color:var(--gr-bg-elev)] px-4 py-2.5 sm:gap-4 sm:px-6 lg:px-8">
          <Link href="/" className="shrink-0 text-[11px] font-bold uppercase tracking-[0.32em] text-[color:var(--gr-ink)] transition-opacity hover:opacity-80">
            Guardrail
          </Link>
          <TopNav authenticated={Boolean(user)} />
        </header>
        <main className="flex w-full min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        {/* Workspace mode: no marketing footer — the workspace IS the page. */}
      </div>
    );
  }

  return (
    <div
      className="relative w-full min-h-screen overflow-x-hidden text-[color:var(--gr-ink)]"
      style={{
        background: "var(--gr-bg)",
        backgroundImage:
          "radial-gradient(ellipse 70% 50% at 15% 0%, rgba(180,160,120,0.08), transparent 60%), radial-gradient(ellipse 50% 40% at 85% 100%, rgba(180,160,120,0.07), transparent 60%)",
      }}
    >
      {/* Sticky marketing header */}
      <header
        className="sticky top-0 z-20 border-b border-[color:var(--gr-border)]"
        style={{ background: "rgba(243,236,224,0.85)", backdropFilter: "blur(14px)" }}
      >
        <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center px-6 lg:px-8">
          <Link
            href="/"
            className="shrink-0 text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--gr-ink)] transition-opacity hover:opacity-70"
          >
            Guardrail
          </Link>
          <div className="flex-1" />
          <TopNav authenticated={Boolean(user)} />
        </div>
      </header>

      <main className={`flex flex-col ${denseHero ? "gap-5" : "gap-10"}`}>
        {statusStrip ? <div>{statusStrip}</div> : null}

        {/* Hero section */}
        <section className="px-6 pb-6 pt-10 lg:px-8">
          <div className="mx-auto max-w-[1240px]">
            <div
              className={`rounded-[14px] border border-[color:var(--gr-border)] bg-white ${
                denseHero ? "p-2.5 sm:p-3 lg:p-4" : compactHero ? "p-5 sm:p-8 lg:p-10" : "p-8 sm:p-12 lg:p-16"
              }`}
              style={{ maxWidth: 1080 }}
            >
              {heroPreview ? (
                <div
                  className="grid items-end gap-8 lg:grid-cols-[1fr_auto]"
                  style={{ gridTemplateColumns: heroPreview ? undefined : "1fr" }}
                >
                  <div>
                    <HeroContent
                      eyebrow={eyebrow}
                      title={title}
                      description={description}
                      note={note}
                      actions={actions}
                      denseHero={denseHero}
                      compactHero={compactHero}
                    />
                    <div className="mt-6 lg:hidden">{heroPreview}</div>
                  </div>
                  <div className="hidden lg:block">{heroPreview}</div>
                </div>
              ) : (
                <HeroContent
                  eyebrow={eyebrow}
                  title={title}
                  description={description}
                  note={note}
                  actions={actions}
                  denseHero={denseHero}
                  compactHero={compactHero}
                />
              )}
            </div>
          </div>
        </section>

        {/* Page sections */}
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-6 pb-0 lg:px-8">
          {children}
        </div>

        {/* Footer */}
        <footer
          className="mt-16 border-t border-[color:var(--gr-border)]"
          style={{ background: "var(--gr-bg)" }}
        >
          <div className="mx-auto max-w-[1240px] px-6 py-9 lg:px-8">
            <p
              className="mx-auto max-w-[920px] text-center text-[13px] leading-relaxed"
              style={{ color: "var(--gr-text-mute)" }}
            >
              Guardrail is a trading-discipline and risk-control tool, not financial advice.
              Guardrail starts in monitoring mode; broker-side enforcement applies only to Daily
              Loss, only on supported connections, and only when you explicitly enable it. Trading
              futures carries a substantial risk of loss.
            </p>
            <div
              className="mt-7 flex flex-col items-center justify-between gap-4 border-t pt-5 sm:flex-row"
              style={{ borderColor: "var(--gr-border-sub)" }}
            >
              <p className="max-w-sm text-[11.5px]" style={{ color: "var(--gr-text-mute)" }}>
                Guardrail is a discipline and risk-management tool. It does not provide financial
                advice or guarantee trading results.
              </p>
              <nav className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {[
                  { href: "/terms", label: "Terms" },
                  { href: "/privacy", label: "Privacy" },
                  { href: "/risk-disclaimer", label: "Risk Disclaimer" },
                  { href: "mailto:support@guardrail-trade.com", label: "Contact Support" },
                ].map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="text-[11.5px] transition-colors hover:text-[color:var(--gr-ink)]"
                    style={{ color: "var(--gr-text-mute)" }}
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ── Hero content block (shared) ────────────────────────────────────────────────

function HeroContent({
  eyebrow,
  title,
  description,
  note,
  actions,
  denseHero,
  compactHero,
}: {
  eyebrow: string;
  title: ReactNode;
  description: string;
  note?: ReactNode;
  actions?: ReactNode;
  denseHero?: boolean;
  compactHero?: boolean;
}) {
  return (
    <div className="max-w-3xl">
      <span
        className="block text-[12px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--gr-copper)" }}
      >
        {eyebrow}
      </span>
      <h1
        className={`font-semibold leading-tight tracking-[-0.025em] ${
          denseHero
            ? "mt-4 text-xl sm:text-2xl"
            : compactHero
            ? "mt-5 text-2xl sm:text-3xl"
            : "mt-6 text-4xl sm:text-5xl"
        }`}
        style={{ color: "var(--gr-ink)", maxWidth: 880, lineHeight: 1.1 }}
      >
        {title}
      </h1>
      <p
        className={`leading-[1.55] ${
          denseHero ? "mt-2 text-[13px]" : "mt-6 text-[17px]"
        }`}
        style={{ color: "var(--gr-text-mid)", maxWidth: 760 }}
      >
        {description}
      </p>
      {note && (
        <p className="mt-[22px] text-[13px]" style={{ color: "var(--gr-text-mute)" }}>
          {note}
        </p>
      )}
      {actions && (
        <div className="mt-9 flex flex-row flex-wrap gap-3">{actions}</div>
      )}
    </div>
  );
}
