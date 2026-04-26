import type { Metadata } from "next";
import { AppShell } from "@/components/ui/app-shell";

export const metadata: Metadata = { title: "Privacy Policy — Guardrail" };

export default function PrivacyPage() {
  return (
    <AppShell
      eyebrow="Legal"
      title="Privacy Policy"
      description="Last updated: April 2026"
    >
      <div className="rounded-[1.75rem] border border-stone-200 bg-white/90 px-8 py-8 text-sm leading-7 text-stone-700 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.18)]">
        <p className="text-stone-500">Full privacy policy is being drafted. Please check back shortly.</p>
        <p className="mt-4 text-stone-500">
          For questions, contact{" "}
          <a href="mailto:support@guardrail.trade" className="font-medium text-stone-950 underline-offset-2 hover:underline">
            support@guardrail.trade
          </a>
          .
        </p>
      </div>
    </AppShell>
  );
}
