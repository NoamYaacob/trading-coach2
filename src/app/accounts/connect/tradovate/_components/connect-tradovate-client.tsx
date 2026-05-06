"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDefaultEnv,
  getDefaultEnvForPhase,
  isLiveAllowed,
  isEnvForced,
  getEnvHint,
  validateSourceEnv,
  PROP_FIRM_PHASES,
  DEFAULT_PROP_FIRM_PHASE,
  type AccountSource,
  type TradovateEnv,
  type PropFirmPhase,
} from "./connect-form-logic";

const PROP_FIRMS = [
  "Apex Trader Funding",
  "Topstep",
  "MyFundedFutures",
  "Lucid Trading",
  "Take Profit Trader",
  "Tradeify",
  "Other",
] as const;


const ACCOUNT_SOURCES: {
  value: AccountSource;
  label: string;
  hint: string;
}[] = [
  {
    value: "prop_firm",
    label: "Prop firm account",
    hint: "Evaluation, funded, challenge, combine, or prop firm sim",
  },
  {
    value: "personal",
    label: "Personal brokerage account",
    hint: "Your own Tradovate futures account",
  },
  {
    value: "demo",
    label: "Paper trading account",
    hint: "Personal demo/simulation account",
  },
  {
    value: "other",
    label: "Not sure / Other",
    hint: "I'm not sure which category this account belongs to",
  },
];

const ERROR_MESSAGES: Record<string, string> = {
  too_many_requests: "Too many connection attempts. Please wait a minute and try again.",
  oauth_not_configured: "Tradovate OAuth is not fully configured on this server.",
  live_oauth_not_configured: "Live Tradovate connection is not configured yet.",
  demo_oauth_not_configured:
    "Demo / Simulation connection is not configured yet. Prop firm evaluation and simulated funded accounts usually require Demo / Simulation.",
  token_exchange_failed:
    "Tradovate could not complete the connection. Please try again. If this repeats, contact support with error code: OAUTH_TOKEN_EXCHANGE_FAILED.",
  oauth_code_expired_or_reused:
    "The authorization code expired or was already used. Please start the connection again.",
  oauth_invalid_client:
    "Tradovate rejected Guardrail's OAuth configuration. Please contact support with code OAUTH_INVALID_CLIENT.",
  oauth_redirect_uri_mismatch: "The redirect URL did not match. Please contact support.",
  oauth_token_response_missing_access_token:
    "Tradovate returned an authorization response but no access token was found. Please try again. If this repeats, contact support with error code: OAUTH_TOKEN_RESPONSE_MISSING_ACCESS_TOKEN.",
  token_exchange_error: "Could not reach Tradovate during authorization. Please try again.",
  token_storage_failed:
    "OAuth completed but token storage failed. Please try again or contact support.",
  token_encryption_failed:
    "OAuth completed but token encryption failed (server configuration issue). Please contact support.",
  broker_connection_storage_failed:
    "OAuth completed but the connection could not be saved. Please try again.",
  setup_update_failed:
    "OAuth completed but setup could not be updated. Please start the connection again.",
  oauth_failed: "Authorization failed. Please try again.",
  csrf_mismatch:
    "Authorization session expired or was tampered with. Please try again.",
  session_mismatch:
    "Authorization session did not match. Please log in and start the connection again.",
  invalid_state: "Invalid authorization state. Please start the connection again.",
  missing_params: "Authorization response was incomplete. Please try again.",
  unauthenticated: "Your session expired during authorization. Please log in and try again.",
  access_denied: "You declined to authorize Guardrail.",
  invalid_setup: "Setup session is invalid. Please start again.",
  setup_not_found: "Setup session expired. Please start again.",
  setup_expired: "Setup session expired. Please start again.",
  no_accounts_found:
    "No accounts were found for this connection. Please check your Tradovate account and try again.",
};

export function ConnectTradovateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");

  const [accountSource, setAccountSource] = useState<AccountSource>("prop_firm");
  const [propFirm, setPropFirm] = useState<string>("Apex Trader Funding");
  const [customFirm, setCustomFirm] = useState("");
  const [propFirmPhase, setPropFirmPhase] = useState<PropFirmPhase>(DEFAULT_PROP_FIRM_PHASE);
  const [env, setEnv] = useState<TradovateEnv>("demo");
  // Once the user manually picks an environment, source-change auto-defaults stop running.
  const [userHasOverriddenEnv, setUserHasOverriddenEnv] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleSourceChange(source: AccountSource) {
    setAccountSource(source);
    if (source === "demo") {
      // Paper trading always uses Demo — override any prior user choice.
      setEnv("demo");
      setUserHasOverriddenEnv(false);
    } else if (!userHasOverriddenEnv) {
      setEnv(getDefaultEnv(source));
    }
  }

  function handlePhaseChange(phase: PropFirmPhase) {
    setPropFirmPhase(phase);
    // Live funded always forces Live; other phases default to Demo.
    // Neither counts as a user override — switching phase again should re-default.
    setEnv(getDefaultEnvForPhase(phase));
    setUserHasOverriddenEnv(false);
  }

  function handleEnvChange(newEnv: TradovateEnv) {
    if (!isLiveAllowed(accountSource) && newEnv === "live") return;
    setEnv(newEnv);
    setUserHasOverriddenEnv(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const envError = validateSourceEnv(accountSource, env);
    if (envError) {
      setFormError(envError);
      return;
    }

    if (accountSource === "prop_firm" && !propFirm) {
      setFormError("Please select a prop firm.");
      return;
    }

    setSubmitting(true);

    const resolvedFirmName =
      accountSource === "prop_firm"
        ? propFirm === "Other"
          ? customFirm.trim() || null
          : propFirm
        : null;

    try {
      const res = await fetch("/api/auth/tradovate/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          accountSource,
          propFirmName: resolvedFirmName,
          env,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(
          data.error === "too_many_requests"
            ? "Too many attempts. Please wait and try again."
            : "Could not start the connection. Please try again.",
        );
        setSubmitting(false);
        return;
      }

      const { redirectTo } = (await res.json()) as { redirectTo: string };
      router.push(redirectTo);
    } catch {
      setFormError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  const liveAllowed = isLiveAllowed(accountSource);
  const envForced = isEnvForced(accountSource);
  const envHint = getEnvHint(
    accountSource,
    env,
    accountSource === "prop_firm" ? propFirmPhase : undefined,
  );

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(113,63,18,0.12),_transparent_32%),linear-gradient(180deg,_#f8f5ef_0%,_#f4efe6_100%)] text-stone-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-6 sm:py-5 lg:px-10">
        <Link
          href="/"
          className="shrink-0 text-sm font-bold uppercase tracking-[0.32em] text-stone-900 transition-opacity hover:opacity-80"
        >
          Guardrail
        </Link>
        <Link href="/accounts" className="text-sm text-stone-600 transition hover:text-stone-950">
          Back to accounts
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 pb-20 pt-6 sm:px-6 lg:px-10">

        <div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">Broker Connections</p>
            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-stone-400">Step 1 of 3 · Connection setup</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-stone-950 sm:text-3xl">
            Connect Tradovate
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Guardrail connects read-only. It reads your account data to evaluate your rules — it cannot place trades or modify your account.
          </p>
        </div>

        {errorCode && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {ERROR_MESSAGES[errorCode] ?? "Authorization failed. Please try again."}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-5">

          {/* ── Step 1: What are you connecting? ────────────────────────── */}
          <div role="group" aria-labelledby="label-account-source">
            <p id="label-account-source" className="mb-2 text-sm font-semibold text-stone-950">
              What are you connecting?
            </p>
            <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {ACCOUNT_SOURCES.map(({ value, label, hint }) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-950 has-[:focus-visible]:ring-offset-1 ${
                      accountSource === value
                        ? "border-stone-950 bg-stone-950/5"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="accountSource"
                      value={value}
                      checked={accountSource === value}
                      onChange={() => handleSourceChange(value)}
                      className="mt-0.5 shrink-0 accent-stone-950"
                    />
                    <span>
                      <span className="block text-sm font-medium text-stone-950">{label}</span>
                      <span className="text-xs text-stone-500">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* ── Step 2a: Prop firm ───────────────────────────────────────── */}
          {accountSource === "prop_firm" && (
            <div role="group" aria-labelledby="label-prop-firm">
              <p id="label-prop-firm" className="mb-2 text-sm font-semibold text-stone-950">
                Which prop firm?
              </p>
              <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROP_FIRMS.map((firm) => (
                    <label
                      key={firm}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-950 has-[:focus-visible]:ring-offset-1 ${
                        propFirm === firm
                          ? "border-stone-950 bg-stone-950/5 font-medium text-stone-950"
                          : "border-stone-200 text-stone-700 hover:border-stone-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="propFirm"
                        value={firm}
                        checked={propFirm === firm}
                        onChange={() => setPropFirm(firm)}
                        className="shrink-0 accent-stone-950"
                      />
                      {firm}
                    </label>
                  ))}
                </div>
                {propFirm === "Other" && (
                  <input
                    type="text"
                    placeholder="Firm name (optional)"
                    value={customFirm}
                    onChange={(e) => setCustomFirm(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-950 placeholder:text-stone-400 focus:border-stone-950 focus:outline-none"
                    maxLength={80}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Step 2b: Prop firm phase ─────────────────────────────────── */}
          {accountSource === "prop_firm" && (
            <div role="group" aria-labelledby="label-prop-firm-phase">
              <p id="label-prop-firm-phase" className="mb-2 text-sm font-semibold text-stone-950">
                Prop firm phase
              </p>
              <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROP_FIRM_PHASES.map(({ value, label }) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-950 has-[:focus-visible]:ring-offset-1 ${
                        propFirmPhase === value
                          ? "border-stone-950 bg-stone-950/5 font-medium text-stone-950"
                          : "border-stone-200 text-stone-700 hover:border-stone-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="propFirmPhase"
                        value={value}
                        checked={propFirmPhase === value}
                        onChange={() => handlePhaseChange(value)}
                        className="shrink-0 accent-stone-950"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-stone-500">
                  Most prop firm funded accounts are simulated. Choose Live funded only if your
                  prop firm specifically gave you a real-money Tradovate Live account.
                </p>
              </div>
            </div>
          )}

          {/* ── Step 3: Tradovate environment ────────────────────────────── */}
          <div role="group" aria-labelledby="label-env">
            <p id="label-env" className="mb-2 text-sm font-semibold text-stone-950">
              Tradovate environment
            </p>
            <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-950 has-[:focus-visible]:ring-offset-1 ${
                    env === "demo"
                      ? "border-stone-950 bg-stone-950/5"
                      : "border-stone-200 hover:border-stone-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="env"
                    value="demo"
                    checked={env === "demo"}
                    onChange={() => handleEnvChange("demo")}
                    className="mt-0.5 shrink-0 accent-stone-950"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-950">Demo / Simulation</span>
                    <span className="text-xs text-stone-500">Prop firms and sim accounts</span>
                  </span>
                </label>
                <label
                  className={`flex items-start gap-3 rounded-xl border p-3.5 transition ${
                    !liveAllowed
                      ? "cursor-not-allowed border-stone-100 bg-stone-50 opacity-50"
                      : "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-stone-950 has-[:focus-visible]:ring-offset-1 " +
                        (env === "live"
                          ? "border-stone-950 bg-stone-950/5"
                          : "border-stone-200 hover:border-stone-300")
                  }`}
                >
                  <input
                    type="radio"
                    name="env"
                    value="live"
                    checked={env === "live"}
                    onChange={() => handleEnvChange("live")}
                    disabled={!liveAllowed}
                    className="mt-0.5 shrink-0 accent-stone-950"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-950">Live</span>
                    <span className="text-xs text-stone-500">Personal brokerage accounts</span>
                  </span>
                </label>
              </div>
              {envHint && (
                <p
                  className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs leading-5 ${
                    envForced
                      ? "border-stone-200 bg-stone-50 text-stone-600"
                      : accountSource === "prop_firm" && env === "live"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  {envHint}
                </p>
              )}
            </div>
          </div>

          {/* ── Optional label ───────────────────────────────────────────── */}
          <div>
            <label htmlFor="displayName" className="mb-1.5 block text-xs font-medium text-stone-500">
              Connection label <span className="text-stone-400">(optional)</span>
            </label>
            <input
              id="displayName"
              type="text"
              placeholder="e.g. Apex Eval 1"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-950 placeholder:text-stone-400 focus:border-stone-950 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-stone-400">
              Used only to name this connection in Guardrail. You can rename accounts after adding them.
            </p>
          </div>

          {formError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="grid gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-full bg-stone-950 px-7 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:opacity-50"
              >
                {submitting ? "Redirecting…" : "Continue to Tradovate authorization →"}
              </button>
              <Link
                href="/accounts"
                className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
              >
                Cancel
              </Link>
            </div>
            <p className="text-xs text-stone-400">
              After authorization, you&rsquo;ll choose which Tradovate accounts to import into Guardrail.
            </p>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-500">
              <p className="font-semibold text-stone-700">Read-only connection</p>
              <p className="mt-0.5 leading-5">
                Guardrail requests read-only access. It cannot place, modify, or cancel orders, and it cannot withdraw funds. Broker-side enforcement is not active yet.
              </p>
            </div>
          </div>
        </form>

      </main>
    </div>
  );
}
