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
      className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
    >
      Open today&rsquo;s session
    </Link>
  ) : (
    <>
      <Link
        href="/signup"
        className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
      >
        Start free week
      </Link>
      <Link
        href="/pricing"
        className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
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
                className="group rounded-2xl border border-stone-200 bg-white/90 px-4 py-3 transition-colors hover:bg-stone-50/60 sm:px-6 sm:py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold tracking-[-0.02em] text-stone-950 sm:text-base">
                  {faq.q}
                  <span className="shrink-0 text-stone-500 transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-stone-600">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.15)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">
            Still have questions?
          </p>
          <h2 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-stone-950">
            Reach out directly.
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            If something isn&rsquo;t answered here, email the support team and you&rsquo;ll get a
            response from a real person.
          </p>
          <div className="mt-4">
            <a
              href="mailto:support@guardrail.trade"
              className="text-sm font-medium text-stone-700 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              support@guardrail.trade
            </a>
          </div>
        </section>

        {!user && (
          <section className="rounded-[2rem] border border-stone-200 bg-white/90 p-5 shadow-[0_24px_70px_-45px_rgba(28,25,23,0.32)] sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-stone-950">
                  Ready to try it?
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  First week free — no credit card required.
                </p>
              </div>
              <div className="flex flex-row flex-wrap gap-3">
                <Link
                  href="/signup"
                  className="rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Start free week
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-full border border-stone-400 px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950"
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
