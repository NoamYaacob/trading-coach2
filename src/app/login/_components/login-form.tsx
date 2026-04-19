"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const INPUT =
  "h-11 w-full rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-200";

const LABEL = "text-xs font-semibold uppercase tracking-[0.12em] text-stone-500";

export function LoginForm() {
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
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const result = (await response.json()) as { error?: string; redirectTo?: string };

      if (!response.ok) {
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

  return (
    <div>
      {/* Heading */}
      <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
        Welcome back
      </h1>
      <p className="mt-2.5 text-sm leading-6 text-stone-500">
        Log in to manage your accounts, rules, and protection status.
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
            placeholder="Your password"
            autoComplete="current-password"
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
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>

      {/* Switch link */}
      <p className="mt-6 text-center text-sm text-stone-500">
        No account yet?{" "}
        <Link
          href="/signup"
          className="font-medium text-stone-950 underline-offset-2 hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}
