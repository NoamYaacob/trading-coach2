"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const PROP_FIRMS = [
  "Apex Trader Funding",
  "Topstep",
  "MyFundedFutures",
  "Lucid Trading",
  "Take Profit Trader",
  "Tradeify",
  "Other",
] as const;

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "Tradovate OAuth is not fully configured on this server.",
  token_exchange_failed: "Tradovate rejected the authorization code. Please try again.",
  token_exchange_error: "Could not reach Tradovate during authorization. Please try again.",
  token_storage_failed: "OAuth completed but token storage failed. Please try again or contact support.",
  csrf_mismatch: "Authorization session expired or was tampered with. Please try again.",
  session_mismatch: "Authorization session did not match. Please log in and start the connection again.",
  invalid_state: "Invalid authorization state. Please start the connection again.",
  missing_params: "Authorization response was incomplete. Please try again.",
  unauthenticated: "Your session expired during authorization. Please log in and try again.",
  too_many_requests: "Too many authorization attempts. Please wait an hour and try again.",
  access_denied: "You declined to authorize Guardrail.",
  setup_not_found: "Setup session expired. Please start again.",
  setup_expired: "Setup session expired. Please start again.",
};

type AccountSource = "prop_firm" | "personal" | "demo" | "other";

export function ConnectTradovateClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const oauthError = searchParams.get("oauth_error");

  const [accountSource, setAccountSource] = useState<AccountSource>("prop_firm");
  const [propFirm, setPropFirm] = useState<string>("Apex Trader Funding");
  const [customFirm, setCustomFirm] = useState("");
  const [env, setEnv] = useState<"demo" | "live">("demo");
  // Once the user manually picks an environment, source-change auto-defaults stop running.
  const [userHasOverriddenEnv, setUserHasOverriddenEnv] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function handleSourceChange(source: AccountSource) {
    setAccountSource(source);
    if (!userHasOverriddenEnv) {
      setEnv(source === "personal" ? "live" : "demo");
    }
  }

  function handleEnvChange(newEnv: "demo" | "live") {
    setEnv(newEnv);
    setUserHasOverriddenEnv(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

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

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 pb-20 pt-6 sm:px-6 lg:px-10">

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-700">Broker Connections</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.04em] text-stone-950 sm:text-3xl">
            Connect Tradovate
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Guardrail connects read-only. It reads your account data to evaluate your rules — it cannot place trades or modify your account.
          </p>
        </div>

        {oauthError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">
            {OAUTH_ERROR_MESSAGES[oauthError] ?? "Authorization failed. Please try again."}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid gap-7">

          {/* ── Step 1: Account kind ─────────────────────────────────────── */}
          <div role="group" aria-labelledby="label-account-source">
            <p id="label-account-source" className="mb-3 text-sm font-semibold text-stone-950">
              What kind of account are you connecting?
            </p>
            <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { value: "prop_firm", label: "Prop firm account", hint: "Apex, Topstep, MFF, etc." },
                    { value: "personal", label: "Personal account", hint: "Your own live futures account" },
                    { value: "demo", label: "Demo / sim account", hint: "Paper trading or simulation" },
                    { value: "other", label: "Other", hint: "Any other account type" },
                  ] as const
                ).map(({ value, label, hint }) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      accountSource === value
                        ? "border-stone-950 bg-stone-950/5"
                        : "border-stone-200 hover:border-stone-400"
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

          {/* ── Step 2: Prop firm ────────────────────────────────────────── */}
          {accountSource === "prop_firm" && (
            <div role="group" aria-labelledby="label-prop-firm">
              <p id="label-prop-firm" className="mb-3 text-sm font-semibold text-stone-950">
                Which prop firm?
              </p>
              <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROP_FIRMS.map((firm) => (
                    <label
                      key={firm}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition ${
                        propFirm === firm
                          ? "border-stone-950 bg-stone-950/5 font-medium text-stone-950"
                          : "border-stone-200 text-stone-700 hover:border-stone-400"
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

          {/* ── Step 3: Environment ──────────────────────────────────────── */}
          <div role="group" aria-labelledby="label-env">
            <p id="label-env" className="mb-1 text-sm font-semibold text-stone-950">
              Tradovate environment
            </p>
            <p className="mb-3 text-xs leading-5 text-stone-500">
              For prop firm accounts, choose Demo / Simulation if your account is an evaluation, challenge, combine, or simulated funded account. Choose Live only for a personal live Tradovate brokerage account unless your prop firm explicitly tells you otherwise.
            </p>
            <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                    env === "demo"
                      ? "border-stone-950 bg-stone-950/5"
                      : "border-stone-200 hover:border-stone-400"
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
                    <span className="text-xs text-stone-500">trader-d.tradovate.com · prop firms and sim accounts</span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                    env === "live"
                      ? "border-stone-950 bg-stone-950/5"
                      : "border-stone-200 hover:border-stone-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="env"
                    value="live"
                    checked={env === "live"}
                    onChange={() => handleEnvChange("live")}
                    className="mt-0.5 shrink-0 accent-stone-950"
                  />
                  <span>
                    <span className="block text-sm font-medium text-stone-950">Live</span>
                    <span className="text-xs text-stone-500">trader.tradovate.com · personal live accounts</span>
                  </span>
                </label>
              </div>
              {accountSource === "prop_firm" && env === "demo" && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-800">
                  Most prop firm evaluation and simulated funded accounts run through the Tradovate demo/simulation environment. Personal brokerage accounts usually use Live.
                </p>
              )}
              {accountSource === "prop_firm" && env === "live" && (
                <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-900">
                  <span className="font-semibold">Use Live only</span> if this is a real funded brokerage account or your prop firm instructed you to connect through Live.
                </p>
              )}
            </div>
          </div>

          {/* ── Optional label ───────────────────────────────────────────── */}
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm font-semibold text-stone-950">
              Connection label <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <p className="mb-3 text-xs text-stone-500">
              A short name shown in the dashboard. Leave blank to use account names from Tradovate.
            </p>
            <div className="rounded-2xl border border-stone-200 bg-white/90 p-4 shadow-sm sm:p-5">
              <input
                id="displayName"
                type="text"
                placeholder={accountSource === "prop_firm" ? "e.g. Apex Eval 1" : "e.g. My Live Account"}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm text-stone-950 placeholder:text-stone-400 focus:border-stone-950 focus:outline-none"
              />
            </div>
          </div>

          {formError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-full bg-stone-950 px-7 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:opacity-50"
            >
              {submitting ? "Starting…" : "Continue to Tradovate authorization →"}
            </button>
            <Link
              href="/accounts"
              className="inline-flex items-center justify-center rounded-full border border-stone-300 px-6 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
            >
              Cancel
            </Link>
          </div>
        </form>

        <div className="rounded-2xl border border-stone-100 bg-stone-50 px-5 py-4 text-xs text-stone-500">
          <p className="font-semibold text-stone-700">Read-only connection</p>
          <p className="mt-1 leading-5">
            Guardrail requests read-only access. It cannot place, modify, or cancel orders, and it cannot withdraw funds. Broker-side enforcement is not active yet.
          </p>
        </div>

      </main>
    </div>
  );
}
