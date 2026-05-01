import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { getTradovateConfig, isDemoOAuthConfigured, resolveRedirectUri, resolveAppBaseUrl } from "@/lib/brokers/tradovate-env";
import { TradovateAdapter } from "@/lib/brokers/tradovate-adapter";

export const metadata: Metadata = {
  title: "Connect Tradovate",
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Tradovate OAuth is not fully configured on this server.",
  token_exchange_failed: "Tradovate rejected the authorization code. Please try again.",
  token_exchange_error: "Could not reach Tradovate during authorization. Please try again.",
  token_storage_failed: "OAuth completed but token storage failed on this server. Please try again or contact support.",
  csrf_mismatch: "Authorization session expired or was tampered with. Please try again.",
  session_mismatch: "Authorization session did not match. Please log in and start the connection again.",
  invalid_state: "Invalid authorization state. Please start the connection again.",
  missing_params: "Authorization response was incomplete. Please try again.",
  unauthenticated: "Your session expired during authorization. Please log in and try again.",
  too_many_requests: "Too many authorization attempts. Please wait an hour and try again.",
  access_denied: "You declined to authorize Guardrail.",
};

export default async function ConnectTradovatePage({
  searchParams,
}: {
  searchParams: Promise<{
    oauth_error?: string;
    oauth?: string;
    account?: string;
  }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const params = await searchParams;
  const status = getTradovateConfig();
  const isConfigured = status.state === "ready";
  const missingKeys = status.state === "not_configured" ? status.missing : [];
  const demoConfigured = isConfigured && isDemoOAuthConfigured();
  // No request object available in the page; resolveRedirectUri returns the
  // best static answer from env vars (TRADOVATE_REDIRECT_URI → APP_URL → path only).
  const effectiveRedirectUri = isConfigured
    ? resolveRedirectUri(status.config)
    : null;
  // resolveAppBaseUrl reads env vars directly (no config object required).
  const effectiveAppBaseUrl = resolveAppBaseUrl();
  const effectiveErrorRedirectBase = effectiveAppBaseUrl
    ? `${effectiveAppBaseUrl}/accounts/connect/tradovate`
    : "(derived from request URL)";

  // Capability map for the "what this will / won't do" lists.
  const caps = new TradovateAdapter().getCapabilities();
  const willEventuallyDo = [
    caps.readAccount,
    caps.readPositions,
    caps.readOrders,
    caps.readPnL,
    caps.readExecutions,
  ];
  const willNotDoYet = [
    caps.cancelOrders,
    caps.flattenPositions,
    caps.brokerLevelLockout,
    caps.placeOrderBlock,
  ];

  return (
    <AppShell
      eyebrow="Broker Connections"
      title="Connect Tradovate"
      description="Connect Tradovate when ready. Guardrail starts with read-only account data, so your rules can be checked against live broker activity."
      note="Manual mode remains available. You can keep using Guardrail now and connect Tradovate later."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back to accounts
        </Link>
      }
    >
      <div className="grid gap-6 -mb-6 sm:mb-0">

        {/* OAuth error / verified banners */}
        {params.oauth_error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {OAUTH_ERROR_MESSAGES[params.oauth_error] ?? "Authorization failed. Please try again."}
          </div>
        )}
        {params.oauth === "verified" && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm">
            <p className="font-medium text-emerald-900">Tradovate connected (read-only)</p>
            <p className="mt-0.5 text-stone-700">
              Connection authorized. The Dashboard and Guardian continue to evaluate from your manual journal until broker reads activate.
            </p>
          </div>
        )}

        {/* What the connection will / will not do */}
        <SectionCard
          title="What Guardrail can read"
          description="After connection, Guardrail can use broker data to evaluate your rules more accurately."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Read-only data
              </p>
              <ul className="mt-2 grid gap-1.5 text-sm text-stone-700 sm:gap-2">
                {willEventuallyDo.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0">
                      <span className="block">{c.label}</span>
                      <span className="text-[11px] text-stone-400">{labelStatus(c.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Not enabled yet
              </p>
              <ul className="mt-2 grid gap-1.5 text-sm text-stone-700 sm:gap-2">
                {willNotDoYet.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                    <span className="min-w-0">
                      <span className="block">{c.label}</span>
                      <span className="text-[11px] text-stone-400">{labelStatus(c.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
            Broker-side actions require separate verification and explicit opt-in. They are not enabled by this connection.
          </p>
        </SectionCard>

        {/* Connection action */}
        {isConfigured ? (
          <SectionCard
            title="Authorize with Tradovate"
            description="You will be redirected to Tradovate to authorize Guardrail. We request read access only."
          >
            <div className="grid gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <a
                  href="/api/auth/tradovate/connect?env=live"
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Connect Tradovate (Live)
                </a>
                {demoConfigured ? (
                  <a
                    href="/api/auth/tradovate/connect?env=demo"
                    className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                  >
                    Connect Tradovate (Demo)
                  </a>
                ) : (
                  <span
                    aria-disabled="true"
                    className="inline-flex cursor-not-allowed items-center justify-center rounded-full border border-stone-200 px-6 py-3 text-sm font-medium text-stone-400"
                  >
                    Connect Tradovate (Demo)
                  </span>
                )}
              </div>
              {!demoConfigured && (
                <p className="text-xs text-stone-500">
                  Demo OAuth is waiting for Tradovate demo credentials. Most prop-firm accounts will use this connection.
                </p>
              )}
              <p className="text-xs text-stone-500">
                Your rules and journal entries remain active — the dashboard continues to evaluate
                from your manual journal until broker reads activate.
              </p>
              {process.env.NODE_ENV !== "production" && (
                <div className="grid gap-1 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">
                    Dev debug
                  </p>
                  <p className="text-xs text-stone-500">
                    APP_URL:{" "}
                    <code className="rounded bg-stone-100 px-1 py-0.5 text-stone-600">
                      {effectiveAppBaseUrl || "(not set — derived from request)"}
                    </code>
                  </p>
                  {effectiveRedirectUri && (
                    <p className="text-xs text-stone-500">
                      Redirect URI:{" "}
                      <code className="rounded bg-stone-100 px-1 py-0.5 text-stone-600">
                        {effectiveRedirectUri}
                      </code>
                    </p>
                  )}
                  <p className="text-xs text-stone-500">
                    Error redirect base:{" "}
                    <code className="rounded bg-stone-100 px-1 py-0.5 text-stone-600">
                      {effectiveErrorRedirectBase}
                    </code>
                  </p>
                </div>
              )}
            </div>
          </SectionCard>
        ) : (
          <SectionCard
            title="Server configuration incomplete"
            description="The following Railway environment variables must be set before the OAuth flow can start. Add them and redeploy."
          >
            <div className="grid gap-2">
              {missingKeys.map((key) => (
                <div
                  key={key}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 font-mono text-xs text-amber-900"
                >
                  {key}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-stone-500">
              Generate <code className="rounded bg-stone-100 px-1 py-0.5">TRADOVATE_TOKEN_ENCRYPTION_KEY</code> with:{" "}
              <code className="rounded bg-stone-100 px-1 py-0.5">openssl rand -base64 32</code>
            </p>
            <div className="mt-5">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Continue in manual mode
              </Link>
            </div>
          </SectionCard>
        )}

      </div>
    </AppShell>
  );
}

function labelStatus(status: string): string {
  switch (status) {
    case "available":      return "Available";
    case "requires_oauth": return "Available after connection";
    case "coming_soon":    return "Coming soon";
    case "unknown":        return "Not enabled";
    case "not_supported":  return "Not supported";
    default:               return status;
  }
}
