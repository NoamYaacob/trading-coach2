import type { Metadata } from "next";
import { AppShell } from "@/components/ui/app-shell";

export const metadata: Metadata = { title: "Risk Disclaimer — Guardrail" };

export default function RiskDisclaimerPage() {
  return (
    <AppShell
      eyebrow="Legal"
      title="Risk Disclaimer"
      description="Please read carefully before using Guardrail."
    >
      <div className="mx-auto max-w-2xl rounded-[1.75rem] border border-stone-200 bg-white/90 px-8 py-10 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.18)] sm:px-10">
        <div className="prose prose-stone max-w-none text-[15px] leading-[1.85]">
          <p className="text-stone-700">
            <strong className="text-stone-950">Guardrail is a risk-management and discipline tool, not a trading advisory service.</strong>{" "}
            It does not provide financial advice, recommend trades, or guarantee any particular outcome.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Trading involves substantial risk</h2>
          <p className="mt-2 text-stone-700">
            Trading financial instruments — including futures, equities, forex, and derivatives — involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results. You may lose some or all of your invested capital.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Guardrail does not guarantee prevention of losses</h2>
          <p className="mt-2 text-stone-700">
            Guardrail enforces the rules you configure. It does not predict market behavior, recommend entries or exits, or prevent you from taking losses. It is your responsibility to define rules that match your risk tolerance and to follow them.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Manual Mode does not block trades at the broker</h2>
          <p className="mt-2 text-stone-700">
            Manual Mode evaluates risk state from the trades you log in your journal. When a rule is breached, Guardrail transitions to a Locked state inside the application — it shows a lockout banner and (if configured) sends a Telegram alert. Manual Mode <strong>does not</strong> place, cancel, modify, or block orders at your broker. You retain full control of order entry at all times.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Broker-level enforcement depends on broker API support</h2>
          <p className="mt-2 text-stone-700">
            Direct broker integrations (read-only and, in the future, action endpoints) depend on the broker&rsquo;s API exposing those capabilities, the user authorizing them, and Guardrail verifying each capability against a live account before enabling it. Where broker APIs do not support a capability — for example, true server-side order blocking — Guardrail does not pretend otherwise. The product status panel in your Accounts page reflects the current state.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Destructive actions require explicit consent</h2>
          <p className="mt-2 text-stone-700">
            Cancelling open orders, flattening positions, and broker-level lockout (collectively, &ldquo;destructive actions&rdquo;) are not enabled today. When and if such actions ship, they will require all of the following:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-stone-700">
            <li>Explicit user opt-in per capability inside Rules → On-breach actions.</li>
            <li>End-to-end verification against the live broker before activation.</li>
            <li>An audit log entry written before each invocation.</li>
            <li>A confirmation step naming the exact action being taken.</li>
          </ol>
          <p className="mt-2 text-stone-700">
            Until those conditions are met for a given capability, Guardrail will not call the corresponding broker endpoint, and the user-facing copy will continue to mark the capability as &ldquo;Coming soon&rdquo;, &ldquo;Disabled&rdquo;, or &ldquo;Unverified&rdquo;.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Connection reliability</h2>
          <p className="mt-2 text-stone-700">
            Rule evaluation depends on timely data — from your journal entries (Manual Mode) or from your broker (when connected and verified). Network delays, API outages, browser issues, and broker-side problems may affect evaluation timing. Guardrail is not liable for losses occurring during such interruptions.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">User responsibility</h2>
          <p className="mt-2 text-stone-700">
            You remain solely responsible for your trading decisions and their outcomes. You are responsible for the accuracy of trades you log manually, for the rules you configure, and for following them. Guardrail is a tool that helps you hold yourself to your stated rules; it is not a substitute for risk management, capital preservation, or professional financial advice.
          </p>

          <p className="mt-8 text-xs text-stone-400">
            By using Guardrail, you acknowledge that you have read and understood this disclaimer and that you assume full responsibility for your trading activities.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
