import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";

import { CoachDebugForm } from "./_components/coach-debug-form";

export const metadata: Metadata = {
  title: "Coach Debug",
  robots: { index: false, follow: false },
};

export default async function CoachDebugPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || !isAdminEmail(currentUser.email)) {
    notFound();
  }

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
