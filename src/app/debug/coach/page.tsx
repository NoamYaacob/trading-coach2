import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";

import { CoachDebugForm } from "./_components/coach-debug-form";

export const metadata: Metadata = {
  title: "Coach Debug",
};

export default function CoachDebugPage() {
  return (
    <AppShell
      eyebrow="Debug"
      title="Local coach response sandbox."
      description="Pick a user by email, send a test message, and inspect the exact intent and reply produced by the same coach engine used in the Telegram webhook."
    >
      <div className="mx-auto w-full max-w-3xl">
        <CoachDebugForm />
      </div>
    </AppShell>
  );
}
