"use client";

import Link from "next/link";
import { useState } from "react";

const INPUT_PW =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 pl-3.5 pr-10 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";
const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";

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

const RULES = [
  ["length", "At least 8 characters"],
  ["uppercase", "Uppercase letter"],
  ["lowercase", "Lowercase letter"],
  ["number", "Number"],
  ["special", "Special character"],
] as const;

type RuleKey = (typeof RULES)[number][0];

function checkRules(pw: string): Record<RuleKey, boolean> {
  return {
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules = checkRules(password);
  const passwordValid = Object.values(rules).every(Boolean);
  const confirmMatch = confirm !== "" && password === confirm;
  const formValid = passwordValid && confirmMatch;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword: confirm }),
      });

      const data = (await res.json()) as { message?: string; error?: string };

      if (!res.ok) {
        if (res.status === 429) {
          throw new Error("Too many attempts. Please wait an hour and try again.");
        }
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
          Password updated.
        </h1>
        <p className="mt-2.5 text-sm leading-6 text-stone-500">
          Your password has been changed. You can log in with your new password now.
        </p>
        <div className="mt-8">
          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-stone-950 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
        Set a new password.
      </h1>
      <p className="mt-2.5 text-sm leading-6 text-stone-500">
        Choose a strong password. You&apos;ll be logged in after updating.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-5">
        {/* New password */}
        <div className="grid gap-2">
          <span className={LABEL}>New password</span>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_PW}
              placeholder="Create a strong password"
              autoComplete="new-password"
            />
            <EyeToggle
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
              label={showPassword ? "Hide password" : "Show password"}
            />
          </div>
          {password.length > 0 && (
            <ul className="grid gap-1 pt-0.5">
              {RULES.map(([key, label]) => (
                <li
                  key={key}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    rules[key] ? "text-emerald-600" : "text-stone-400"
                  }`}
                >
                  <span className="w-3 shrink-0 text-center">{rules[key] ? "✓" : "·"}</span>
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Confirm password */}
        <div className="grid gap-2">
          <span className={LABEL}>Confirm new password</span>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={INPUT_PW}
              placeholder="Re-enter your password"
              autoComplete="new-password"
            />
            <EyeToggle
              visible={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
              label={showConfirm ? "Hide password" : "Show password"}
            />
          </div>
          {confirm.length > 0 && !confirmMatch && (
            <p className="text-xs text-red-600">Passwords do not match.</p>
          )}
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
          {isSubmitting ? "Updating…" : "Set new password"}
        </button>
      </form>
    </div>
  );
}
