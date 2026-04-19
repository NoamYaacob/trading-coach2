"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rules = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const passwordValid = Object.values(rules).every(Boolean);
  const confirmMatch = confirmPassword !== "" && password === confirmPassword;
  const formValid = email.trim() !== "" && passwordValid && confirmMatch;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formValid) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const result = (await response.json()) as { error?: string; redirectTo?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create account.");
      }

      router.push(result.redirectTo ?? "/onboarding");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create account.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      {/* Heading */}
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
        Create your account
      </h1>
      <p className="mt-2.5 text-sm leading-6 text-stone-500">
        Set up your trading protection in minutes.
      </p>

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-9 grid gap-5">
        {/* Email */}
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

        {/* Password */}
        <div className="grid gap-2">
          <span className={LABEL}>Password</span>
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

          {/* Checklist */}
          {password.length > 0 && (
            <ul className="grid gap-1 pt-0.5">
              {(
                [
                  ["length", "At least 8 characters"],
                  ["uppercase", "Uppercase letter"],
                  ["lowercase", "Lowercase letter"],
                  ["number", "Number"],
                  ["special", "Special character"],
                ] as [keyof typeof rules, string][]
              ).map(([key, label]) => (
                <li
                  key={key}
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    rules[key] ? "text-emerald-600" : "text-stone-400"
                  }`}
                >
                  <span className="w-3 shrink-0 text-center">
                    {rules[key] ? "✓" : "·"}
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Confirm password */}
        <div className="grid gap-2">
          <span className={LABEL}>Confirm password</span>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
          {confirmPassword.length > 0 && !confirmMatch && (
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
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      {/* Switch link */}
      <p className="mt-6 text-center text-sm text-stone-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-stone-950 underline-offset-2 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
