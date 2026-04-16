"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const EVENT_TYPES = [
  { value: "trade_opened", label: "Trade opened" },
  { value: "trade_closed", label: "Trade closed" },
  { value: "win", label: "Win" },
  { value: "loss", label: "Loss" },
  { value: "pnl_update", label: "P&L update" },
  { value: "rule_breach", label: "Rule breach" },
  { value: "manual_note", label: "Note" },
] as const;

const PNL_RELEVANT = new Set(["win", "loss", "pnl_update"]);

export function ManualEventForm() {
  const router = useRouter();
  const [eventType, setEventType] = useState("trade_opened");
  const [note, setNote] = useState("");
  const [pnlAmount, setPnlAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  const showPnl = PNL_RELEVANT.has(eventType);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");

    try {
      const body: Record<string, unknown> = { eventType };

      if (note.trim()) {
        body.note = note.trim();
      }

      if (showPnl && pnlAmount !== "") {
        const parsed = parseFloat(pnlAmount);
        if (!isNaN(parsed)) {
          body.pnlAmount = parsed;
        }
      }

      const res = await fetch("/api/session/manual-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      setStatus("success");
      setNote("");
      setPnlAmount("");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
          Event type
        </label>
        <select
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            setStatus("idle");
          }}
          disabled={status === "submitting"}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-50"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {showPnl ? (
        <div className="grid gap-2">
          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            P&amp;L amount (optional)
          </label>
          <input
            type="number"
            step="0.01"
            value={pnlAmount}
            onChange={(e) => setPnlAmount(e.target.value)}
            placeholder="e.g. 125.50 or -75.00"
            disabled={status === "submitting"}
            className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-50"
          />
        </div>
      ) : null}

      <div className="grid gap-2">
        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
          Note (optional)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Brief note about this event"
          disabled={status === "submitting"}
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-50"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-900 disabled:opacity-50"
        >
          {status === "submitting" ? "Logging..." : "Log event"}
        </button>
        {status === "success" ? (
          <p className="text-sm text-emerald-700">Logged.</p>
        ) : status === "error" ? (
          <p className="text-sm text-red-700">Failed to log event.</p>
        ) : null}
      </div>
    </form>
  );
}
