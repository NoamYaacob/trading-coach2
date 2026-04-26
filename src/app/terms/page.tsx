import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";

export const metadata: Metadata = { title: "Terms of Service — Guardrail" };

export default function TermsPage() {
  return (
    <AppShell
      eyebrow="Legal"
      title="Terms of Service"
      description="Last updated: April 2026"
    >
      <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-8 py-8 text-sm leading-7 text-stone-700 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.18)]">
        <p>
          These Terms of Service govern your use of Guardrail (&ldquo;the Service&rdquo;). By creating an account or using the Service, you agree to these terms.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">1. What Guardrail is</h2>
        <p className="mt-2">
          Guardrail is a risk-management and discipline tool for active traders. It evaluates rules you configure against trades you log (Manual Mode) or, where supported, fills and balances read from your connected broker. It is not a trading advisory service, broker, or financial-services provider. It does not place, modify, or guarantee execution of any order.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">2. No financial advice; no guarantee of outcomes</h2>
        <p className="mt-2">
          Nothing in the Service constitutes financial, investment, legal, or tax advice. Trading involves substantial risk of loss, including the possibility of losing more than your initial capital. Guardrail does not predict market behaviour and does not guarantee any trading outcome. See the{" "}
          <Link href="/risk-disclaimer" className="font-medium text-stone-950 underline-offset-2 hover:underline">
            Risk Disclaimer
          </Link>{" "}
          for details.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">3. Manual Mode is in-app only</h2>
        <p className="mt-2">
          Manual Mode evaluates risk state from journal entries. When a rule is breached, Guardrail transitions to a Locked state inside the application and may emit alerts. Manual Mode does not place, cancel, or block orders at your broker. You retain full order-entry control at your broker at all times.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">4. Broker integrations</h2>
        <p className="mt-2">
          Where Guardrail integrates with a broker (e.g., Tradovate), it does so via the broker&rsquo;s API and only with scopes you explicitly authorize. Read-only capabilities require read scope; destructive capabilities (cancelling orders, flattening positions, broker-level lockout) require both broker API support and explicit per-capability user opt-in inside the Service. Until a capability has been verified end-to-end against the live broker and explicitly opted into, Guardrail will not invoke it.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">5. Your responsibilities</h2>
        <p className="mt-2">
          You are responsible for: (a) the accuracy of journal entries you submit, (b) the rules you configure, (c) the broker accounts you authorize, (d) following the rules you set, and (e) any trading decisions you take. Guardrail is a tool that helps you hold yourself to your stated rules; it is not a substitute for capital preservation or professional advice.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">6. Service availability</h2>
        <p className="mt-2">
          The Service is provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. We aim for high availability but do not guarantee uninterrupted operation. Network delays, API outages (ours or the broker&rsquo;s), browser issues, and infrastructure problems may delay or prevent rule evaluation. Guardrail is not liable for losses occurring during such interruptions.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">7. Account, billing, and cancellation</h2>
        <p className="mt-2">
          Subscription billing is handled by Stripe. You may cancel your subscription at any time from the Settings page. Refunds, where applicable, follow our refund policy described at signup.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">8. Termination</h2>
        <p className="mt-2">
          We may suspend or terminate access for misuse, abuse, security concerns, or violation of these terms. You may delete your account at any time from the Settings page.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">9. Changes to these terms</h2>
        <p className="mt-2">
          We may update these terms from time to time. Material changes will be communicated through the Service. Continued use after a change constitutes acceptance.
        </p>

        <h2 className="mt-6 text-base font-semibold text-stone-950">10. Contact</h2>
        <p className="mt-2">
          For questions, contact{" "}
          <a
            href="mailto:support@guardrail.trade"
            className="font-medium text-stone-950 underline-offset-2 hover:underline"
          >
            support@guardrail.trade
          </a>
          .
        </p>
      </div>
    </AppShell>
  );
}
