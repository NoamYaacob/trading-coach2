"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PRIMARY_BTN =
  "inline-flex h-9 items-center rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400";

type TelegramConnectionProps = {
  connected: boolean;
  username: string | null;
  botConfigured?: boolean;
};

export function TelegramConnection({ connected, username, botConfigured = true }: TelegramConnectionProps) {
  const router = useRouter();
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  async function handleConnect() {
    setIsCreatingLink(true);
    setError(null);

    try {
      const res = await fetch("/api/telegram/link-token", { method: "POST" });
      const result = (await res.json()) as { error?: string; telegramLink?: string | null };

      if (!res.ok) {
        throw new Error(
          result.error === "bot access is only available for active trial or subscription"
            ? "Telegram alerts are available during an active trial or subscription."
            : "Could not create a Telegram link. Please try again.",
        );
      }
      if (!result.telegramLink) {
        throw new Error("Telegram setup is not available yet — the bot is still being configured.");
      }
      setTelegramLink(result.telegramLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a Telegram link. Please try again.");
    } finally {
      setIsCreatingLink(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/telegram/disconnect", { method: "POST" });
      if (!res.ok) {
        throw new Error("Could not disconnect Telegram. Please try again.");
      }
      setConfirmingDisconnect(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Telegram. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (!botConfigured) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-stone-300" />
          <div className="text-sm">
            <p className="font-medium text-stone-700">Coming soon</p>
            <p className="text-stone-500">Telegram setup requires the bot to be configured. This will be available soon.</p>
          </div>
        </div>
        <p className="text-xs leading-5 text-stone-600">
          Once available, Telegram will send alerts for rule breaches (daily loss, loss
          streak) and behavioral patterns (revenge entry, rapid trading, size increase after a loss).
        </p>
        <p className="text-xs leading-5 text-stone-400">
          Planned: per-alert preferences and a daily digest summary.
        </p>
        <a href="/alerts" className="text-xs font-medium text-stone-700 underline-offset-2 hover:underline">
          See all alerts →
        </a>
      </div>
    );
  }

  if (connected) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <div className="text-sm">
              <p className="font-medium text-emerald-900">Connected</p>
              {username && <p className="text-emerald-700">@{username}</p>}
            </div>
          </div>
          {!confirmingDisconnect && (
            <button
              type="button"
              onClick={() => { setConfirmingDisconnect(true); setError(null); }}
              className="inline-flex h-8 shrink-0 items-center rounded-full border border-stone-200 bg-white px-3.5 text-xs font-medium text-stone-600 transition hover:border-red-300 hover:text-red-700"
            >
              Disconnect Telegram
            </button>
          )}
        </div>
        {confirmingDisconnect && (
          <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
            <p className="text-sm text-stone-700">
              Disconnect Telegram? You&apos;ll stop receiving alerts in your chat. Your rules,
              alert history, and broker connections are not affected.
            </p>
            {error && <p className="text-xs text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setConfirmingDisconnect(false); setError(null); }}
                disabled={disconnecting}
                className="inline-flex h-8 items-center rounded-full border border-stone-200 bg-white px-3.5 text-xs font-medium text-stone-600 transition hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="inline-flex h-8 items-center rounded-full bg-red-700 px-3.5 text-xs font-medium text-white transition hover:bg-red-800 disabled:opacity-70"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect Telegram"}
              </button>
            </div>
          </div>
        )}
        <p className="text-xs leading-5 text-stone-600">
          Telegram sends alerts for rule breaches (daily loss, loss streak) and
          behavioral patterns (revenge entry, rapid trading, size increase after a loss).
        </p>
        <p className="text-xs leading-5 text-stone-400">
          Planned: per-alert preferences and a daily digest summary.
        </p>
        <a href="/alerts" className="text-xs font-medium text-stone-700 underline-offset-2 hover:underline">
          See all alerts →
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-stone-300" />
        <div className="text-sm">
          <p className="font-medium text-stone-700">Not connected</p>
          <p className="text-stone-500">Connect Telegram to receive Guardrail alerts in your chat.</p>
        </div>
      </div>
      <p className="text-xs leading-5 text-stone-600">
        Once connected, Telegram sends alerts for rule breaches (daily loss, loss
        streak) and behavioral patterns (revenge entry, rapid trading, size increase after a loss).
      </p>
      <p className="text-xs leading-5 text-stone-400">
        Planned: per-alert preferences and a daily digest summary.
      </p>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {telegramLink ? (
          <a href={telegramLink} target="_blank" rel="noreferrer" className={PRIMARY_BTN}>
            Open Telegram bot
          </a>
        ) : (
          <button type="button" onClick={handleConnect} disabled={isCreatingLink} className={PRIMARY_BTN}>
            {isCreatingLink ? "Creating link…" : "Connect Telegram"}
          </button>
        )}
        <a href="/alerts" className="text-xs font-medium text-stone-500 underline-offset-2 hover:underline">
          See all alerts →
        </a>
      </div>
      {telegramLink && (
        <p className="text-xs text-stone-500">
          Opens the Guardrail bot in Telegram. Press <span className="font-medium">Start</span> there to finish linking.
        </p>
      )}
    </div>
  );
}
