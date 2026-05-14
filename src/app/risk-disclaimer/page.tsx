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

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">What happens when a rule is breached</h2>
          <p className="mt-2 text-stone-700">
            When a configured rule is breached, Guardrail always locks the account internally — it sets the account to a Stopped state and (if configured) sends a Telegram alert. Additionally, for Tradovate accounts connected with full API permissions, Guardrail may attempt broker-side actions: applying a daily lockout via the broker&rsquo;s risk settings, and closing any open positions before or alongside the lockout, depending on the trigger and your configured cutoff behavior. Guardrail does <strong>not</strong> place new orders or block order entry at the exchange level. Your broker&rsquo;s native order-entry interface remains available regardless of Guardrail&rsquo;s state.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Broker-level enforcement depends on broker API support</h2>
          <p className="mt-2 text-stone-700">
            Direct broker integrations (read-only and, in the future, action endpoints) depend on the broker&rsquo;s API exposing those capabilities, the user authorizing them, and Guardrail verifying each capability against a live account before enabling it. Enforcement availability varies by broker, prop firm, account type, connection type, and the permissions granted at connection time. A read-only connection can monitor account activity and trigger in-app alerts but cannot block, cancel, or modify orders at the broker. Where broker APIs do not support a capability — for example, true server-side order blocking — Guardrail does not pretend otherwise. The product status panel in your Accounts page reflects the current state.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Enforcement may fail or be unavailable</h2>
          <p className="mt-2 text-stone-700">
            Even where broker enforcement is configured, it may be unavailable, delayed, rejected, or fail at the time of execution due to network issues, broker API outages, account status changes, permission revocations, or prop firm policy changes. Guardrail logs enforcement attempts but cannot guarantee the outcome of any broker-side action. You remain responsible for monitoring your account and taking manual action if automated enforcement does not complete as expected.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Automated account actions and position exit</h2>
          <p className="mt-2 text-stone-700">
            For Tradovate accounts connected with full API permissions, the following automated actions are active when your configured rules are breached:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-stone-700">
            <li><strong>Broker-side daily lockout</strong> — Guardrail applies the broker&rsquo;s own risk settings (auto-liquidation threshold) to lock the account for the trading day.</li>
            <li><strong>Position flatten</strong> — Guardrail attempts to close open positions before or alongside the lockout for daily loss, daily profit target, and configured session-end cutoff breaches.</li>
          </ul>
          <p className="mt-2 text-stone-700">
            These actions are authorized by configuring rules and connecting with full broker permissions. Every action is recorded in the audit log with the trigger, endpoint called, payload sent, and broker response received. These actions depend on broker API availability, your account&rsquo;s permission grants, and network conditions. Guardrail logs attempts but cannot guarantee completion. You remain responsible for monitoring your account and taking manual action if automated enforcement does not complete as expected.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Connection reliability</h2>
          <p className="mt-2 text-stone-700">
            Rule evaluation depends on timely data from your connected broker. Network delays, API outages, browser issues, and broker-side problems may affect evaluation timing. Guardrail is not liable for losses occurring during such interruptions.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">User responsibility</h2>
          <p className="mt-2 text-stone-700">
            You remain solely responsible for your trading decisions and their outcomes. You are responsible for the accuracy of any data submitted through the Service, the rules you configure, the broker accounts you authorize, and for following your stated rules. Guardrail is a tool that helps you hold yourself to your stated rules; it is not a substitute for risk management, capital preservation, or professional financial advice.
          </p>

          <p className="mt-8 text-xs text-stone-400">
            By using Guardrail, you acknowledge that you have read and understood this disclaimer and that you assume full responsibility for your trading activities.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
