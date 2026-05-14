import { randomBytes } from "node:crypto";

import { requireEnv } from "@/lib/env";

export function generateTelegramLinkToken() {
  return randomBytes(24).toString("hex");
}

type TelegramReplyMarkup = {
  keyboard?: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  input_field_placeholder?: string;
};

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: {
    replyMarkup?: TelegramReplyMarkup;
  },
) {
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: options?.replyMarkup,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}
