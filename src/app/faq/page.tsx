import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { FAQS } from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Common questions about Guardrail, enforcement scope, broker connections, and pricing.",
};

export default async function FaqPage() {
  const user = await getCurrentUser();

  const actions = user ? (
    <Link
      href="/dashboard"
      className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
      style={{ background: "var(--gr-ink)" }}
    >
      Open today&rsquo;s session
    </Link>
  ) : (
    <>
      <Link
        href="/signup"
        className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
        style={{ background: "var(--gr-ink)" }}
      >
        Start free week
      </Link>
      <Link
        href="/pricing"
        className="rounded-full border px-5 py-3 text-sm font-medium transition hover:opacity-80"
        style={{ borderColor: "var(--gr-border-hi)", color: "var(--gr-text-mid)" }}
      >
        See pricing
      </Link>
    </>
  );

  return (
    <AppShell
      eyebrow="FAQ"
      title="Common questions."
      description="Everything you need to know before getting started with Guardrail."
      actions={actions}
    >
      <div className="grid gap-8 sm:gap-12">
        <section>
          <div className="grid gap-3">
            {FAQS.map((faq) => (
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore – `name` on <details> is valid HTML (Chrome 120+, Firefox 130+, Safari 17.2+) but missing from older React types
              <details
                key={faq.q}
                name="faq"
                className="group rounded-[14px] border px-4 py-3 transition-colors sm:px-6 sm:py-4"
                style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold tracking-[-0.02em] sm:text-base" style={{ color: "var(--gr-ink)" }}>
                  {faq.q}
                  <span className="shrink-0 transition-transform group-open:rotate-45" style={{ color: "var(--gr-text-mute)" }}>
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section
          className="rounded-[14px] border p-5 sm:p-8"
          style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--gr-copper)" }}>
            Still have questions?
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em]" style={{ color: "var(--gr-ink)" }}>
            Reach out directly.
          </h2>
          <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
            If something isn&rsquo;t answered here, email the support team and you&rsquo;ll get a
            response from a real person.
          </p>
          <div className="mt-4">
            <a
              href="mailto:support@guardrail.trade"
              className="text-sm font-medium underline-offset-2 transition hover:underline"
              style={{ color: "var(--gr-text-mid)" }}
            >
              support@guardrail.trade
            </a>
          </div>
        </section>

        {!user && (
          <section
            className="rounded-[14px] border p-5 sm:p-8"
            style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em]" style={{ color: "var(--gr-ink)" }}>
                  Ready to try it?
                </h2>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>
                  First week free — no credit card required.
                </p>
              </div>
              <div className="flex flex-row flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="rounded-full px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ background: "var(--gr-ink)" }}
                >
                  Start free week
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-full border px-5 py-3 text-sm font-medium transition hover:opacity-80"
                  style={{ borderColor: "var(--gr-border-hi)", color: "var(--gr-text-mid)" }}
                >
                  See pricing
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
