"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline "Edit name" affordance for a broker account. Lets the user set a
 * personal display name so accounts at the same prop firm stay distinguishable
 * (e.g. "Apex eval #2" instead of two identical "Apex Evaluation" rows).
 *
 * Calls PATCH /api/accounts/:id with ONLY { displayName }. The endpoint trims
 * the value and clears it back to null when empty, so the friendly fallback
 * label applies again. No broker identifiers, protection status, rules, or
 * any safety data are touched — this is a pure label edit.
 */
export function EditAccountNameButton({
  accountId,
  currentName,
  placeholder,
  variant = "pill",
}: {
  accountId: string;
  /** The account's existing displayName (null when never set). */
  currentName: string | null;
  /** The derived fallback label, shown as the input placeholder. */
  placeholder?: string;
  /** Visual style of the trigger only — "pill" (standalone) or "menuItem"
   *  (left-aligned row inside a dropdown menu). Does NOT affect the PATCH
   *  payload or behavior. */
  variant?: "pill" | "menuItem";
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Only displayName is sent — never label / externalAccountId / rules.
        body: JSON.stringify({ displayName: value.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(data.message ?? data.error ?? "Couldn't save the name. Please try again.");
        setSaving(false);
        return;
      }
      setEditing(false);
      setSaving(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  if (!editing) {
    const triggerClass =
      variant === "menuItem"
        ? "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50"
        : "inline-flex items-center justify-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-500 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950";
    return (
      <button
        type="button"
        onClick={() => {
          setValue(currentName ?? "");
          setError(null);
          setEditing(true);
        }}
        className={triggerClass}
      >
        {variant === "menuItem" ? "Rename account" : "Edit name"}
      </button>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${variant === "menuItem" ? "items-stretch px-1 py-0.5" : "items-end"}`}>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <input
        type="text"
        value={value}
        maxLength={80}
        placeholder={placeholder ?? "Account name"}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        className="w-48 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-500 disabled:opacity-50"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="inline-flex items-center rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800 disabled:opacity-70"
        >
          {saving ? "Saving…" : "Save name"}
        </button>
      </div>
    </div>
  );
}
