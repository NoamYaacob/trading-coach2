import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { AccountForm } from "../../_components/account-form";

export const metadata: Metadata = {
  title: "Connect Tradovate",
};

// Show the OAuth connect button only when the required env vars are set.
// The button links to /api/auth/tradovate/connect which builds the real
// Tradovate authorization redirect. When env vars are absent, the page
// falls back to the manual webhook setup form.
function isOAuthConfigured(): boolean {
  return !!(process.env.TRADOVATE_CLIENT_ID && process.env.NEXT_PUBLIC_APP_URL);
}

export default async function ConnectTradovatePage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_error?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const { oauth_error } = await searchParams;
  const oauthReady = isOAuthConfigured();

  const OAUTH_ERROR_MESSAGES: Record<string, string> = {
    oauth_not_configured: "OAuth is not configured on this server.",
    token_exchange_failed: "Tradovate rejected the authorization code. Please try again.",
    token_exchange_error: "Could not reach Tradovate during authorization. Please try again.",
    csrf_mismatch: "Authorization session expired or was tampered with. Please try again.",
    invalid_state: "Invalid authorization state. Please start the connection again.",
    missing_params: "Authorization response was incomplete. Please try again.",
  };

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connect Tradovate"
      description="Authorize Guardrail to watch your live Tradovate account and intervene via Telegram when your limits are hit."
      actions={
        <Link
          href="/accounts/new"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back
        </Link>
      }
    >
      <div className="grid gap-6">
        {oauth_error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {OAUTH_ERROR_MESSAGES[oauth_error] ?? "Authorization failed. Please try again."}
          </div>
        )}

        {oauthReady ? (
          /* ── OAuth path (env vars present) ─────────────────────────────── */
          <SectionCard
            title="Authorize with Tradovate"
            description="Click below to open the Tradovate authorization page. You will be redirected back here once authorized."
          >
            <div className="grid gap-6">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { n: "1", label: "Authorize", detail: "Approve Guardrail in Tradovate" },
                  { n: "2", label: "Set rules", detail: "Daily loss, trade limits" },
                  { n: "3", label: "Go live", detail: "Guardian watches your account" },
                ].map((step) => (
                  <div
                    key={step.n}
                    className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                        {step.n}
                      </span>
                      <span className="text-xs font-semibold text-stone-700">{step.label}</span>
                    </div>
                    <p className="text-xs text-stone-500">{step.detail}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href="/api/auth/tradovate/connect?env=live"
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Connect live account
                </a>
                <a
                  href="/api/auth/tradovate/connect?env=demo"
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                >
                  Connect demo account
                </a>
              </div>

              <p className="text-xs text-stone-500">
                You will be redirected to Tradovate to authorize access. Guardrail only requests
                trading-scope permissions needed to receive account events.
              </p>
            </div>
          </SectionCard>
        ) : (
          /* ── Manual / webhook path (OAuth not configured) ──────────────── */
          <>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-700">
              OAuth is not configured on this server — using manual webhook setup instead. To
              enable OAuth, set{" "}
              <code className="font-mono">TRADOVATE_CLIENT_ID</code>,{" "}
              <code className="font-mono">TRADOVATE_CLIENT_SECRET</code>, and{" "}
              <code className="font-mono">NEXT_PUBLIC_APP_URL</code> in your environment.
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { n: "1", label: "Account ID", detail: "Your Tradovate numeric ID" },
                { n: "2", label: "Protection rules", detail: "Daily loss, trade limits" },
                { n: "3", label: "Webhook", detail: "Route live events to Guardrail" },
              ].map((step) => (
                <div
                  key={step.n}
                  className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600">
                      {step.n}
                    </span>
                    <span className="text-xs font-semibold text-stone-700">{step.label}</span>
                  </div>
                  <p className="text-xs text-stone-500">{step.detail}</p>
                </div>
              ))}
            </div>

            <SectionCard
              title="Account setup"
              description="Fill in your account details and protection rules. After saving, you will be taken to the connection readiness page."
            >
              <AccountForm mode="create" lockedPlatform="tradovate" />
            </SectionCard>
          </>
        )}
      </div>
    </AppShell>
  );
}
