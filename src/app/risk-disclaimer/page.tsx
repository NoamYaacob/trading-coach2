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
      <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-8 py-8 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.18)]">
        <div className="prose prose-stone max-w-none text-sm leading-7">
          <p className="text-stone-700">
            <strong className="text-stone-950">Guardrail is a risk-management and discipline tool, not a trading advisory service.</strong> It does not provide financial advice, recommend trades, or guarantee any particular outcome.
          </p>
          <p className="mt-4 text-stone-700">
            Trading financial instruments — including futures, equities, forex, and derivatives — involves substantial risk of loss and is not suitable for all investors. Past performance is not indicative of future results.
          </p>
          <p className="mt-4 text-stone-700">
            Guardrail enforces the rules you configure. It does not prevent you from taking losses; it helps you enforce pre-defined limits. You are solely responsible for your trading decisions and their outcomes.
          </p>
          <p className="mt-4 text-stone-700">
            Rule enforcement depends on timely data from your connected broker. Network delays, API outages, or broker-side issues may affect enforcement timing. Guardrail is not liable for losses that occur during such interruptions.
          </p>
          <p className="mt-6 text-xs text-stone-400">
            By using Guardrail, you acknowledge that you have read and understood this disclaimer and that you assume full responsibility for your trading activities.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
