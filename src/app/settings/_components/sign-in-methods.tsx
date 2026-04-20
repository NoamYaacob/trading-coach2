"use client";

import { useState } from "react";

import { PasswordForm } from "./password-form";

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px] shrink-0 text-stone-500"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.5 12.5 21 2" />
      <path d="M18 5l2 2" />
      <path d="M15 8l2 2" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

const PILL_BTN =
  "inline-flex h-8 items-center justify-center rounded-full border border-stone-200 px-3 text-xs font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900";

function MethodIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-stone-100 bg-stone-50">
      {children}
    </div>
  );
}

function PasswordRow({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-4 py-4">
        <MethodIcon><KeyIcon /></MethodIcon>
        <p className="flex-1 text-sm font-medium text-stone-900">Password</p>
        <span className={`text-xs ${hasPassword ? "text-stone-500" : "text-stone-400"}`}>
          {hasPassword ? "Enabled" : "Not set"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={PILL_BTN}
        >
          {open ? "Cancel" : hasPassword ? "Change password" : "Set password"}
        </button>
      </div>
      {open && (
        <div className="pb-5 pt-1">
          <PasswordForm hasPassword={hasPassword} />
        </div>
      )}
    </div>
  );
}

function GoogleRow({ connected, email }: { connected: boolean; email: string | null }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <MethodIcon><GoogleLogo /></MethodIcon>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-900">Google</p>
        {connected && email && (
          <p className="truncate text-xs text-stone-400">{email}</p>
        )}
      </div>
      <span className={`text-xs ${connected ? "text-stone-500" : "text-stone-400"}`}>
        {connected ? "Connected" : "Not connected"}
      </span>
      {!connected && (
        <a href="/api/auth/google/connect?mode=connect" className={PILL_BTN}>
          Connect Google
        </a>
      )}
    </div>
  );
}

type SignInMethodsProps = {
  hasPassword: boolean;
  googleConnected: boolean;
  googleEmail: string | null;
};

export function SignInMethods({ hasPassword, googleConnected, googleEmail }: SignInMethodsProps) {
  return (
    <div className="divide-y divide-stone-100">
      <PasswordRow hasPassword={hasPassword} />
      <GoogleRow connected={googleConnected} email={googleEmail} />
    </div>
  );
}
