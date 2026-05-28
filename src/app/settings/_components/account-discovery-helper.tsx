"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResult =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export function AccountDiscoveryHelper() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sync, setSync] = useState<SyncResult>({ kind: "idle" });

  async function runSync() {
    setSync({ kind: "syncing" });
    try {
      const res = await fetch("/api/accounts/sync-all", { method: "POST" });
      if (res.ok) {
        setSync({
          kind: "success",
          message:
            "Sync complete. If a new account was found, it will appear above as 'New — needs setup'.",
        });
        router.refresh();
      } else {
        setSync({ kind: "error", message: `Sync failed (HTTP ${res.status}). Try again.` });
      }
    } catch {
      setSync({ kind: "error", message: "Network error. Please try again." });
    }
  }

  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-semibold text-stone-600">
          Why don&apos;t I see my new account?
        </span>
        <span className="text-stone-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 grid gap-3">
          <ol className="grid gap-2 pl-4 text-stone-600" style={{ listStyleType: "decimal" }}>
            <li>
              <span className="font-medium text-stone-700">Wrong Tradovate user connected.</span>{" "}
              The live connection above shows a Tradovate user ID. If your new account belongs to a
              different Tradovate user, you&apos;ll need to reconnect with that user&apos;s
              credentials.
            </li>
            <li>
              <span className="font-medium text-stone-700">Connected Demo but new account is Live (or vice versa).</span>{" "}
              A demo connection can only discover demo accounts. If your new funded account is a
              live account, make sure you have an active <strong>live</strong> connection above.
            </li>
            <li>
              <span className="font-medium text-stone-700">OAuth token expired — reconnect needed.</span>{" "}
              If the connection shows &quot;Expired&quot; above, Guardrail cannot sync accounts
              until you reconnect. Use the &quot;Reconnect&quot; button on the expired connection.
            </li>
            <li>
              <span className="font-medium text-stone-700">Prop firm hasn&apos;t activated the new account yet.</span>{" "}
              Even if the account appears in your Tradovate dashboard, the prop firm may have
              set <code>active=false</code>. Guardrail will pick it up automatically once the
              firm activates it.
            </li>
            <li>
              <span className="font-medium text-stone-700">Account exists but is pending setup.</span>{" "}
              If Guardrail already found the account, it appears in the{" "}
              <em>New — needs setup</em> section above with a &quot;Set rules&quot; button.
              Check there first.
            </li>
          </ol>

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-3">
            <button
              type="button"
              onClick={runSync}
              disabled={sync.kind === "syncing"}
              className="inline-flex items-center rounded-full bg-stone-950 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              {sync.kind === "syncing" ? "Syncing…" : "Run sync now"}
            </button>

            {sync.kind !== "idle" && sync.kind !== "syncing" && (
              <span
                className={
                  sync.kind === "error" ? "text-red-600" : "text-stone-500"
                }
              >
                {sync.message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
