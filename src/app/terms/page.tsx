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
      <div
        className="mx-auto max-w-2xl rounded-[14px] border px-8 py-10 text-[15px] leading-[1.85] sm:px-10"
        style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)", color: "var(--gr-text-mid)" }}
      >
        <p>
          These Terms of Service govern your use of Guardrail (&ldquo;the Service&rdquo;). By creating an account or using the Service, you agree to these terms.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>1. What Guardrail is</h2>
        <p className="mt-3">
          Guardrail is a risk-management and discipline tool for active traders. It evaluates rules you configure against fills and balances read from your connected broker. It is not a trading advisory service, broker, or financial-services provider. It does not place, modify, or guarantee execution of any order.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>2. No financial advice; no guarantee of outcomes</h2>
        <p className="mt-3">
          Nothing in the Service constitutes financial, investment, legal, or tax advice. Trading involves substantial risk of loss, including the possibility of losing more than your initial capital. Guardrail does not predict market behaviour and does not guarantee any trading outcome. See the{" "}
          <Link href="/risk-disclaimer" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--gr-ink)" }}>
            Risk Disclaimer
          </Link>{" "}
          for details.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>3. Broker integrations</h2>
        <p className="mt-3">
          Where Guardrail integrates with a broker (e.g., Tradovate), it does so via the broker&rsquo;s API and only with the scopes you explicitly authorize. Guardrail starts in monitoring mode: it reads fills and balances to evaluate your rules and sends in-app and optional Telegram alerts. It does not place, cancel, or modify orders.
        </p>
        <p className="mt-3">
          Broker-side enforcement is not active by default. Among your rules, only the Daily Loss limit is eligible for broker-side enforcement, applied through Tradovate&rsquo;s own account risk settings. Profit target, max trades, loss streak, position size, and session cutoff are evaluated at the app level only and are never written to your broker. Any broker-side action requires a supported connection, full API permissions you grant, explicit enablement, and our internal safeguards, and may be limited to specific accounts; until those conditions are met, no writes are sent to your broker. Where it is enabled, broker-side action depends on broker API availability, your permission grants, and network conditions — Guardrail records attempts in a per-account audit trail, cannot guarantee completion, and is not liable for failures. Guardrail is an independent product and is not endorsed by, affiliated with, or sponsored by Tradovate or any broker.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>4. Your responsibilities</h2>
        <p className="mt-3">
          You are responsible for: (a) the accuracy of any data you submit to the Service, (b) the rules you configure, (c) the broker accounts you authorize, (d) following the rules you set, and (e) any trading decisions you take. Guardrail is a tool that helps you hold yourself to your stated rules; it is not a substitute for capital preservation or professional advice.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>5. Rule changes and audit records</h2>
        <p className="mt-3">
          You can edit your rules between sessions. Once a trading session is underway, some rule and account-protection changes may be limited — for example, reducing your protection level may take effect only from the next trading day rather than immediately. This is intended to keep the decisions you made before the session from being undone under pressure. Guardrail may keep audit records of rule changes, protection changes, and changes that were blocked or deferred, so that your account history stays accurate. These records are part of your account data and are removed when you delete your account.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>6. Service availability</h2>
        <p className="mt-3">
          The Service is provided on an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. We aim for high availability but do not guarantee uninterrupted operation. Network delays, API outages (ours or the broker&rsquo;s), browser issues, and infrastructure problems may delay or prevent rule evaluation. Guardrail is not liable for losses occurring during such interruptions.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>7. Account, billing, and cancellation</h2>
        <p className="mt-3">
          Subscription billing is handled by Stripe. You may cancel your subscription at any time from the Settings page. Refunds, where applicable, follow our refund policy described at signup.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>8. Termination</h2>
        <p className="mt-3">
          We may suspend or terminate access for misuse, abuse, security concerns, or violation of these terms. You may delete your account at any time from the Settings page.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>9. Changes to these terms</h2>
        <p className="mt-3">
          We may update these terms from time to time. Material changes will be communicated through the Service. Continued use after a change constitutes acceptance.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em]" style={{ color: "var(--gr-ink)" }}>10. Contact</h2>
        <p className="mt-3">
          For questions, contact{" "}
          <a
            href="mailto:support@guardrail.trade"
            className="font-medium underline-offset-2 hover:underline"
            style={{ color: "var(--gr-ink)" }}
          >
            support@guardrail.trade
          </a>
          .
        </p>
      </div>
    </AppShell>
  );
}
