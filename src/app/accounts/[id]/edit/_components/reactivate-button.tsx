"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { accountId: string };

export function ReactivateButton({ accountId }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReactivate() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: true }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to reactivate account.");
        setSaving(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={handleReactivate}
        disabled={saving}
        className="inline-flex w-fit rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Reactivating…" : "Reactivate account"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
