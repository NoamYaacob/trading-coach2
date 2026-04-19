"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create account.");
      }

      router.push("/onboarding");
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

        <label className="grid gap-2">
          <span className={LABEL}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
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
          disabled={isSubmitting}
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
