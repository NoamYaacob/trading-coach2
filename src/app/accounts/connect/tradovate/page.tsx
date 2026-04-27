import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import {
  getTradovateConfig,
  TRADOVATE_REQUIRED_ENV_KEYS,
} from "@/lib/brokers/tradovate-env";
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

  // Capability map for the "what this will / won't do" lists.
  const caps = new TradovateAdapter().getCapabilities();
  const willEventuallyDo = [
    caps.readAccount,
    caps.readBalance,
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
      description="Read-only first. Guardrail will read your account data so risk rules evaluate against live broker numbers instead of manual journal entries. Broker-side actions stay disabled until separately verified."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back to accounts
        </Link>
      }
    >
      <div className="grid gap-6">

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
              OAuth completed and tokens are encrypted in storage. The read pipeline (account / positions / orders / executions) is not yet implemented — Dashboard and Guardian continue to evaluate from your Manual Mode journal until it ships.
            </p>
          </div>
        )}

        {/* What the connection will / will not do */}
        <SectionCard
          title="What this connection will do"
          description="Read-only foundation. Listed capabilities become available as each integration phase lands."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Will eventually allow
              </p>
              <ul className="mt-2 grid gap-2 text-sm text-stone-700">
                {willEventuallyDo.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>
                      {c.label}
                      <span className="ml-1 text-xs text-stone-400">— {labelStatus(c.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Will NOT do yet
              </p>
              <ul className="mt-2 grid gap-2 text-sm text-stone-700">
                {willNotDoYet.map((c) => (
                  <li key={c.key} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                    <span>
                      {c.label}
                      <span className="ml-1 text-xs text-stone-400">— {labelStatus(c.status)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600">
            Broker-side enforcement actions (cancel orders, flatten positions, broker-level lockout) require separate verification against the live API and explicit user opt-in. They will not be enabled by connecting today.
          </p>
        </SectionCard>

        {/* Connection action */}
        <SectionCard
          title={isConfigured ? "Authorize with Tradovate" : "Tradovate OAuth is not configured yet"}
          description={
            isConfigured
              ? "You will be redirected to Tradovate to authorize Guardrail. We request the read scope only."
              : "The server is missing one or more environment variables needed to complete OAuth securely."
          }
        >
          {isConfigured ? (
            <div className="grid gap-4">
              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href="/api/auth/tradovate/connect?env=live"
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-6 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
                >
                  Connect Tradovate (Live)
                </a>
                <a
                  href="/api/auth/tradovate/connect?env=demo"
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
                >
                  Connect Tradovate (Demo)
                </a>
              </div>
              <p className="text-xs text-stone-500">
                Manual Mode stays active in the background — your existing journal entries and rule
                evaluation continue to work after authorizing.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-700">
                <p className="font-medium text-amber-900">Setup needed on the server</p>
                <p className="mt-1">
                  Set the following environment variables before users can connect Tradovate:
                </p>
                <ul className="mt-2 grid gap-1 font-mono text-xs">
                  {TRADOVATE_REQUIRED_ENV_KEYS.map((key) => {
                    const missing = status.state === "not_configured" && status.missing.includes(key);
                    return (
                      <li
                        key={key}
                        className={missing ? "text-red-700" : "text-stone-500"}
                      >
                        {missing ? "✗" : "✓"} {key}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-xs text-stone-600">
                  See <code className="font-mono">.env.example</code> and{" "}
                  <code className="font-mono">docs/broker-integration-plan.md</code>.
                </p>
              </div>
              <button
                type="button"
                disabled
                className="inline-flex w-fit cursor-not-allowed items-center justify-center rounded-full bg-stone-200 px-6 py-3 text-sm font-medium text-stone-500"
                title="Tradovate OAuth is not configured yet"
              >
                Connect Tradovate when configured
              </button>
              <p className="text-xs text-stone-500">
                Manual Mode is fully functional today. Connect a broker later when the server is configured.
              </p>
            </div>
          )}
        </SectionCard>

      </div>
    </AppShell>
  );
}

function labelStatus(status: string): string {
  switch (status) {
    case "available":      return "Available";
    case "requires_oauth": return "After OAuth (read pipeline pending)";
    case "coming_soon":    return "Coming soon";
    case "unknown":        return "To be verified";
    case "not_supported":  return "Not supported";
    default:               return status;
  }
}
