"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Inline editor for a broker account's personal display name. Rendered BELOW
 * the account row (not inside the cramped "More" menu popover) so the input and
 * its Cancel / Save controls always stay within the card bounds and wrap
 * cleanly on narrow widths. Lets the user set a personal name so accounts at the
 * same prop firm stay distinguishable (e.g. "Apex eval #2" instead of two
 * identical broker labels).
 *
 * Calls PATCH /api/accounts/:id with ONLY { displayName }. The endpoint trims
 * the value and clears it back to null when empty, so the friendly fallback
 * label applies again. No broker identifiers, protection status, rules, or any
 * safety data are touched — this is a pure label edit.
 */
export function EditAccountNameForm({
  accountId,
  currentName,
  placeholder,
  onClose,
}: {
  accountId: string;
  /** The account's existing displayName (null when never set). */
  currentName: string | null;
  /** The derived fallback label, shown as the input placeholder. */
  placeholder?: string;
  /** Called when the editor should close (Cancel, Escape, or a successful save). */
  onClose: () => void;
}) {
  const router = useRouter();
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
      setSaving(false);
      onClose();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      {error && <p className="text-xs text-red-700">{error}</p>}
      <input
        type="text"
        autoFocus
        value={value}
        maxLength={80}
        placeholder={placeholder ?? "Account name"}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !saving) handleSave();
          else if (e.key === "Escape") onClose();
        }}
        disabled={saving}
        className="w-full max-w-xs rounded-md border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-stone-500 disabled:opacity-50"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onClose}
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
