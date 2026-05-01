"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartSessionButton({ className }: { className: string }) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setIsStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian/start-session", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Unable to start session.");
      setStarted(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start session.");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleStart}
        disabled={isStarting || started}
        className={className}
      >
        {started ? "Session started" : isStarting ? "Starting..." : "Start session"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
