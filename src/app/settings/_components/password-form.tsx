"use client";

import { useState } from "react";

const INPUT =
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

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const rules = {
    length: newPassword.length >= 8,
    uppercase: /[A-Z]/.test(newPassword),
    lowercase: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[^A-Za-z0-9]/.test(newPassword),
  };
  const newPasswordValid = Object.values(rules).every(Boolean);
  const confirmMatch = confirmPassword !== "" && newPassword === confirmPassword;
  const formValid = (hasPassword ? currentPassword !== "" : true) && newPasswordValid && confirmMatch;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formValid) return;
    setIsSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/account/password", {
        method: hasPassword ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasPassword ? { currentPassword, newPassword } : { newPassword }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save password.");
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (!hasPassword) window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save password.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      {/* Current password — only needed when changing an existing password */}
      {hasPassword && (
      <label className="grid gap-2">
        <span className={LABEL}>Current password</span>
        <div className="relative">
          <input
            type={showCurrent ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={INPUT}
            placeholder="Enter current password"
            autoComplete="current-password"
          />
          <EyeToggle visible={showCurrent} onToggle={() => setShowCurrent((v) => !v)} label={showCurrent ? "Hide password" : "Show password"} />
        </div>
      </label>
      )}

      {/* New password */}
      <div className="grid gap-2">
        <span className={LABEL}>New password</span>
        <div className="relative">
          <input
            type={showNew ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={INPUT}
            placeholder="Create a strong password"
            autoComplete="new-password"
          />
          <EyeToggle visible={showNew} onToggle={() => setShowNew((v) => !v)} label={showNew ? "Hide password" : "Show password"} />
        </div>
        {newPassword.length > 0 && (
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
              <li key={key} className={`flex items-center gap-1.5 text-xs transition-colors ${rules[key] ? "text-emerald-600" : "text-stone-400"}`}>
                <span className="w-3 shrink-0 text-center">{rules[key] ? "✓" : "·"}</span>
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Confirm new password */}
      <div className="grid gap-2">
        <span className={LABEL}>Confirm new password</span>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={INPUT}
            placeholder="Re-enter new password"
            autoComplete="new-password"
          />
          <EyeToggle visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} label={showConfirm ? "Hide password" : "Show password"} />
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
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {hasPassword ? "Password updated successfully." : "Password set successfully."}
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={!formValid || isSaving}
          className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-6 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {isSaving ? "Saving…" : hasPassword ? "Update password" : "Set password"}
        </button>
      </div>
    </form>
  );
}
