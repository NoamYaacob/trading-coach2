"use client";

import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";
const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = email.trim() !== "";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (res.status === 429) {
        throw new Error("Too many requests. Please wait a few minutes and try again.");
      }

      if (!res.ok) {
        throw new Error("Something went wrong. Please try again.");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
          Check your email.
        </h1>
        <p className="mt-2.5 text-sm leading-6 text-stone-500">
          If an account exists for that email, we&apos;ll send a reset link.
        </p>
        <p className="mt-6 text-center text-sm text-stone-500">
          <a
            href="/login"
            className="font-medium text-stone-950 underline-offset-2 hover:underline"
          >
            Back to log in
          </a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
        Reset your password.
      </h1>
      <p className="mt-2.5 text-sm leading-6 text-stone-500">
        Enter your email and we&apos;ll send a reset link if an account exists.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-5">
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
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-stone-500">
        <a
          href="/login"
          className="font-medium text-stone-950 underline-offset-2 hover:underline"
        >
          Back to log in
        </a>
      </p>
    </div>
  );
}
