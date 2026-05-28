"use client";

import React from "react";
import { useRouter } from "next/navigation";

import { GrIcon } from "./gr/gr-icon";

/**
 * Client-only "Sync accounts" item for the GrShell quick-nav dropdown.
 * Calls POST /api/accounts/sync-all and refreshes the route on success.
 */
export function GrShellSyncButton({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "syncing" | "ok" | "err">("idle");

  async function handleClick() {
    if (state === "syncing") return;
    setState("syncing");
    try {
      const res = await fetch("/api/accounts/sync-all", { method: "POST" });
      if (!res.ok) throw new Error(`sync-all ${res.status}`);
      setState("ok");
      router.refresh();
      window.setTimeout(() => setState("idle"), 1200);
    } catch {
      setState("err");
      window.setTimeout(() => setState("idle"), 2000);
    } finally {
      onDone?.();
    }
  }

  const label =
    state === "syncing" ? "Syncing…" :
    state === "ok" ? "Synced ✓" :
    state === "err" ? "Sync failed" :
    "Sync accounts";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "syncing"}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", fontSize: "13.5px",
        color: "var(--gr-text-mid)", textDecoration: "none",
        background: "transparent", border: "none",
        width: "100%", textAlign: "left",
        cursor: state === "syncing" ? "default" : "pointer",
        opacity: state === "syncing" ? 0.65 : 1,
      }}
    >
      <GrIcon name="refresh" size="sm" />
      {label}
    </button>
  );
}
