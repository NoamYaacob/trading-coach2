"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

const EVENT_TYPES = [
  { value: "trade_opened", label: "Trade opened", hint: "Log when you enter a trade." },
  { value: "trade_closed", label: "Trade closed", hint: "Log when you exit a trade." },
  { value: "win",          label: "Win",          hint: "Mark a profitable trade." },
  { value: "loss",         label: "Loss",         hint: "Mark a losing trade." },
  { value: "pnl_update",  label: "P&L update",   hint: "Record a P&L change without a specific win or loss." },
  { value: "rule_breach",  label: "Rule breach",  hint: "Flag if you broke a session rule." },
  { value: "manual_note",  label: "Note",         hint: "Log anything else worth remembering." },
] as const;

const PNL_RELEVANT = new Set(["win", "loss", "pnl_update"]);

export function ManualEventForm() {
  const router = useRouter();
  const [eventType, setEventType] = useState<string>("trade_opened");
  const [note, setNote] = useState("");
  const [pnlAmount, setPnlAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [loggedLabel, setLoggedLabel] = useState("");

  const selected = EVENT_TYPES.find((t) => t.value === eventType);
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

      setLoggedLabel(selected?.label ?? "Event");
      setStatus("success");
      setNote("");
      setPnlAmount("");
      startTransition(() => {
        router.refresh();
      });
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
        {selected ? (
          <p className="text-xs text-stone-400">{selected.hint}</p>
        ) : null}
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
            onChange={(e) => {
              setPnlAmount(e.target.value);
              setStatus("idle");
            }}
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
          onChange={(e) => {
            setNote(e.target.value);
            setStatus("idle");
          }}
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
          <p className="text-sm text-emerald-700">{loggedLabel} added to Today Activity.</p>
        ) : status === "error" ? (
          <p className="text-sm text-red-700">Failed to log event.</p>
        ) : null}
      </div>
    </form>
  );
}
