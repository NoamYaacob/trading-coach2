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
      <div className="mx-auto max-w-2xl rounded-[1.75rem] border border-stone-200 bg-white/90 px-8 py-10 text-[15px] leading-[1.85] text-stone-700 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.18)] sm:px-10">
        <p>
          This Privacy Policy describes what information Guardrail collects, how we use it, and what we never do with it.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">What we collect</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>
            <strong>Account info:</strong> email address, password hash, and (optionally) Google OAuth identifiers used to sign you in.
          </li>
          <li>
            <strong>Risk profile:</strong> trading rules and preferences you enter during onboarding (max daily loss, max trades, session hours, etc.).
          </li>
          <li>
            <strong>Manual Mode entries:</strong> trades you log in the journal — symbols, sides, prices, P&L, notes you write.
          </li>
          <li>
            <strong>Broker connection metadata:</strong> when you connect a broker (e.g., Tradovate), we store the connection state, account label, and an encrypted copy of OAuth tokens. See &ldquo;How we protect tokens&rdquo; below.
          </li>
          <li>
            <strong>Telegram identifiers:</strong> if you opt in, we store your Telegram chat id so the bot can send you alerts.
          </li>
          <li>
            <strong>Operational logs:</strong> standard server logs for debugging and abuse prevention. Logs never include token values or full credit-card numbers.
          </li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">How we protect tokens</h2>
        <p className="mt-3">
          OAuth access and refresh tokens are encrypted at rest using AES-256-GCM with a 32-byte server-side key. Each encryption uses a fresh random IV; the GCM auth tag rejects any tampering. Tokens are decrypted only on the server, only inside server-side code paths that load them via an ownership-checked function. Tokens are never logged, never returned to the browser, and never sent to third parties.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">How we use the data</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>To authenticate you and keep your session active.</li>
          <li>To evaluate your rules against your journal entries (Manual Mode) or broker reads (when verified).</li>
          <li>To send you alerts you&rsquo;ve opted into (Telegram, email, in-app).</li>
          <li>To improve the product through aggregated, non-identifying analysis.</li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">What we don&rsquo;t do</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li>We don&rsquo;t sell your data.</li>
          <li>We don&rsquo;t use your trade entries to train external machine-learning models.</li>
          <li>We don&rsquo;t share your broker token values with anyone.</li>
          <li>
            We don&rsquo;t place, cancel, or modify orders at your broker on your behalf today. Future destructive capabilities (cancel orders, flatten positions, broker-level lockout) will require explicit per-capability opt-in and live-broker verification before they ship.
          </li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Third-party processors</h2>
        <p className="mt-3">
          We use Stripe for billing, Anthropic for AI-assisted features, and (optionally) Google for sign-in and Telegram for alerts. Each processor receives only the data necessary for that function, under their respective privacy terms.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Your rights</h2>
        <p className="mt-3">
          You can export your data, delete your account, and revoke broker connections at any time from the Settings page. Account deletion removes your stored profile, journal entries, and connection records.
        </p>

        <h2 className="mt-8 text-lg font-semibold tracking-[-0.02em] text-stone-950">Contact</h2>
        <p className="mt-3">
          Questions, requests, or concerns? Contact{" "}
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
