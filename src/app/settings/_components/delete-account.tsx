"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteAccount() {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = confirmText === "DELETE";

  async function handleDelete() {
    if (!confirmed) return;
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete account.");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-stone-600">
        This permanently deletes your account and all associated data — trading
        history, rules, coaching profile, and connected accounts. This action
        cannot be undone.
      </p>

      <div className="grid gap-2">
        <label htmlFor="delete-confirm" className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
          Type DELETE to confirm
        </label>
        <input
          id="delete-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="h-11 w-full max-w-xs rounded-xl border border-stone-200 bg-stone-50 px-3.5 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-100"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!confirmed || isDeleting}
          className="inline-flex h-10 items-center justify-center rounded-full bg-red-600 px-6 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isDeleting ? "Deleting account…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}
