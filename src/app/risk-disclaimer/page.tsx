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
            When a configured rule is breached, Guardrail locks the account inside the app — it sets the account to a Stopped state and (if Telegram is connected) sends an alert. This app-level lock does <strong>not</strong> place, cancel, or block orders at your broker; your broker&rsquo;s native order-entry interface remains available regardless of Guardrail&rsquo;s state.
          </p>
          <p className="mt-2 text-stone-700">
            Guardrail starts in monitoring mode, and broker-side enforcement is off by default. Only the Daily Loss limit is eligible for broker-side enforcement, applied through Tradovate&rsquo;s own account risk settings, and only on a supported connection where you have granted full API permissions and the capability has been explicitly enabled. Profit target, max trades, loss streak, position size, and session cutoff are evaluated at the app level only. Order cancellation and position flattening are not active and are planned for a future release.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Broker-level enforcement depends on broker API support</h2>
          <p className="mt-2 text-stone-700">
            Direct broker integrations (read-only and, in the future, action endpoints) depend on the broker&rsquo;s API exposing those capabilities, the user authorizing them, and Guardrail verifying each capability against a live account before enabling it. Enforcement availability varies by broker, prop firm, account type, connection type, and the permissions granted at connection time. A read-only connection can monitor account activity and trigger in-app alerts but cannot block, cancel, or modify orders at the broker. Where broker APIs do not support a capability — for example, true server-side order blocking — Guardrail does not pretend otherwise. The product status panel in your Accounts page reflects the current state. Guardrail is an independent product and is not endorsed by, affiliated with, or sponsored by Tradovate or any broker.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Enforcement may fail or be unavailable</h2>
          <p className="mt-2 text-stone-700">
            Even where broker enforcement is configured, it may be unavailable, delayed, rejected, or fail at the time of execution due to network issues, broker API outages, account status changes, permission revocations, or prop firm policy changes. Guardrail logs enforcement attempts but cannot guarantee the outcome of any broker-side action. You remain responsible for monitoring your account and taking manual action if automated enforcement does not complete as expected.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Broker-side enforcement scope</h2>
          <p className="mt-2 text-stone-700">
            Broker-side enforcement is limited to the Daily Loss limit and, where available, is applied through Tradovate&rsquo;s own account risk settings. It is not active by default. It requires a supported Tradovate connection, full API permissions granted by you, explicit enablement, and our internal safeguards, and it may be limited to specific accounts. Until all of those conditions are met, Guardrail sends no writes to your broker and operates in monitoring mode only.
          </p>
          <p className="mt-2 text-stone-700">
            Profit target, max trades, loss streak, position size, and session cutoff are evaluated at the app level only — they are never enforced at your broker. Order cancellation and position flattening are not active today; they are planned capabilities and will only ship after live-broker verification and explicit, per-capability opt-in.
          </p>
          <p className="mt-2 text-stone-700">
            Where broker-side enforcement is enabled, every attempt is recorded in a per-account audit log with the trigger and the broker&rsquo;s response. These actions depend on broker API availability, your account&rsquo;s permission grants, and network conditions — Guardrail records attempts but cannot guarantee completion. You remain responsible for monitoring your account and taking manual action if automated enforcement does not complete as expected.
          </p>

          <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Connection reliability and limitations</h2>
          <p className="mt-2 text-stone-700">
            Rule evaluation depends on a connected broker account and timely data from it. You must keep your broker account connected for monitoring to continue; if the connection expires or is removed, evaluation pauses until you reconnect. Network delays, API outages (ours or the broker&rsquo;s), browser issues, and broker-side problems may delay alerts or state updates. Rules apply to activity received while monitoring is active and are not applied retroactively to trades that occurred while the account was disconnected. Broker-side controls may behave differently depending on your broker, account type, and the permissions granted. Guardrail is not liable for losses occurring during such interruptions.
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
