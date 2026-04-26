"use client";

import { useState } from "react";

type DashboardActionsProps = {
  telegramConnected: boolean;
  onboardingComplete: boolean;
};

export function DashboardActions({
  telegramConnected,
  onboardingComplete,
}: DashboardActionsProps) {
  const [isCreatingTelegramLink, setIsCreatingTelegramLink] = useState(false);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  async function handleConnectTelegram() {
    setIsCreatingTelegramLink(true);
    setTelegramError(null);

    try {
      const response = await fetch("/api/telegram/link-token", {
        method: "POST",
      });

      const result = (await response.json()) as {
        error?: string;
        telegramLink?: string | null;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create Telegram link.");
      }

      if (!result.telegramLink) {
        throw new Error(
          "Telegram bot username is not configured yet. Set TELEGRAM_BOT_USERNAME and try again.",
        );
      }

      setTelegramLink(result.telegramLink);
    } catch (error) {
      setTelegramError(
        error instanceof Error
          ? error.message
          : "Unable to create Telegram link.",
      );
    } finally {
      setIsCreatingTelegramLink(false);
    }
  }

  if (!onboardingComplete) return null;
  if (telegramConnected) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {telegramLink ? (
        <a
          href={telegramLink}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-amber-500 bg-white px-5 py-3 text-sm font-medium text-amber-700 transition hover:bg-amber-50"
        >
          Open Telegram Bot
        </a>
      ) : (
        <button
          type="button"
          onClick={handleConnectTelegram}
          disabled={isCreatingTelegramLink}
          className="rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-medium text-stone-800 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400"
        >
          {isCreatingTelegramLink ? "Generating link..." : "Connect Telegram alerts"}
        </button>
      )}
      {telegramError ? (
        <p className="basis-full text-sm text-red-700">{telegramError}</p>
      ) : null}
    </div>
  );
}
