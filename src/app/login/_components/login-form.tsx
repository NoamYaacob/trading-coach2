"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

const INPUT_PW =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 pl-3.5 pr-10 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function EyeToggle({
  visible,
  onToggle,
  label,
}: {
  visible: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 transition hover:text-stone-600"
    >
      {visible ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

export function LoginForm({ oauthError }: { oauthError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = email.trim() !== "" && password !== "";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const result = (await response.json()) as { error?: string; redirectTo?: string };

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many login attempts. Please wait a minute and try again.");
        }
        throw new Error(result.error ?? "Unable to log in.");
      }

      router.push(result.redirectTo ?? "/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to log in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const resolvedOauthError = oauthError
    ? oauthError === "google_not_configured"
      ? "Google sign-in is not configured yet."
      : "Google sign-in failed. Please try again or use email and password."
    : null;

  return (
    <div>
      {/* Heading */}
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
        Log in to Guardrail
      </h1>
      <p className="mt-2.5 text-sm leading-6 text-stone-500">
        Continue to your trading dashboard, rules, and broker connection.
      </p>

      {resolvedOauthError && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {resolvedOauthError}
        </div>
      )}

      {/* Google */}
      <div className="mt-6">
        <a
          href="/api/auth/google/connect?mode=auth"
          className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-full border border-stone-200 bg-white text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
        >
          <GoogleLogo />
          Continue with Google
        </a>
      </div>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-stone-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-white px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
            or
          </span>
        </div>
      </div>

      {/* Email / password form */}
      <form onSubmit={handleSubmit} className="grid gap-5">
        <label className="grid gap-2">
          <span className={LABEL}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
            placeholder="trader@example.com"
            autoComplete="email"
            required
          />
        </label>

        <div className="grid gap-2">
          <span className={LABEL}>Password</span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_PW}
              placeholder="Your password"
              autoComplete="current-password"
              required
            />
            <EyeToggle
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              label={showPassword ? "Hide password" : "Show password"}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!formValid || isSubmitting}
          className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-950 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>

        <p className="text-center text-xs text-stone-400">
          Your rules and broker connection stay tied to your account.
        </p>
      </form>

      {/* Switch link */}
      <p className="mt-6 text-center text-sm text-stone-500">
        New to Guardrail?{" "}
        <Link
          href="/signup"
          className="font-medium text-stone-950 underline-offset-2 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
